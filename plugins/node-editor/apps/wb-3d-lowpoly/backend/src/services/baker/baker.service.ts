/**
 * Baker Service (v0.1) —— OCCT-WASM mesh 烘焙器，单例。
 *
 * 角色：
 *   把 Geometry DSL 里的 composite shape op（如 clevis_bracket / spur_gear）
 *   一次性 bake 成 ASCII OBJ，落到 library blob store，URDF / viewer 用
 *   content-addressed URL 引用。
 *
 * 关键设计：
 *   1. **进程单例 WASM**：opencascade.js WASM 大约 10MB，初始化 ~400ms，
 *      所以每个 Node 进程只 init 一次，所有 bake 调用复用。
 *   2. **懒加载 + warmup Promise**：第一次调 bake 触发 init；任何后续并发调用
 *      都 await 同一个 Promise，初始化只跑一次。
 *      main.ts 启动后可以主动调 warmUpBaker() 在后台预热，不阻塞 listen()。
 *   3. **内容寻址缓存**：cacheKey = sha256(canonicalize(op, args))；
 *      第一次 bake 落到 library blob `<sha>.obj`（zone="mesh_bake"）；
 *      后续相同参数先命中进程内 cache；重启后也会在 OCCT 前查 mesh_bake alias。
 *   4. **错误隔离**：op builder 抛任何异常 → 包成 BakerError 重抛；
 *      WASM 自己崩了（理论上不会发生）会冒泡到 bake() 调用者。
 *
 * 不做的事（v1 范围）：
 *   - worker thread / 进程隔离：用单线程同步 bake，缓存命中率高，
 *     真的卡了再上 worker（baker.worker.ts 形式）。
 *   - 持久化 in-memory cache：library blob 已经是磁盘持久化，只需要 bake 前短路。
 *   - 并发限流：bake 是 CPU 同步，事件循环阻塞由 V8 自己排队即可。
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { reachableSubgraphSource, type Arg, type Geometry, type Statement } from './shared-types.js';
import { logger } from '../../utils/logger.js';
import { BakerError } from './errors.js';
import { getOpBuilder, listBakeableOps } from './ops/index.js';
import { shapeToObj } from './obj_export.js';
import { bakeSha256 } from './canonical.js';
import { csgCut, csgFuse, csgIntersect } from './csg_helpers.js';
import { readBool, readNumber, readNumList, readString } from './arg_readers.js';
import {
  combineMeshes,
  isMeshGeometry,
  mirrorMesh,
  rotateMesh,
  samplePath,
  scaleMesh,
  sectionLoftMesh,
  sweepProfileMesh,
  translateMesh,
  tubeMeshFromPath,
  type Vec3,
} from './curves.js';
import {
  DEFAULT_TESSELLATION,
  type BakeResult,
  type BakeableShape,
  type MeshGeometry,
  type ReplicadShape,
  type BakerLibraryHandle,
  type OpContext,
  type ReplicadModule,
  type TessellationOptions,
} from './types.js';

const require_ = createRequire(import.meta.url);

// ── 防爆阈值（per-shape） ──────────────────────────────────────────────
// 这些是"硬上限"——超过就 throw BakerError，让 g_to_urdf 走 AABB box 兜底。
// 90% 的合理 part / gear（米尺度参数）远低于此。
const WARN_TRIANGLES = 50_000;
const MAX_TRIANGLES = 300_000;
const MAX_OBJ_BYTES = 12 * 1024 * 1024;  // 12MB；超过这个 viewer 必卡

// ── 模块级单例 ─────────────────────────────────────────────────────────

/** init 完成后的 (replicad, tessellation) bundle。null 表示尚未 init。 */
let occtState: { replicad: ReplicadModule; tessellation: TessellationOptions } | null = null;
/** in-flight init Promise。多次 init() 调用合流到这一个。 */
let initPromise: Promise<void> | null = null;

/**
 * OCCT WASM 在累积 bake 大量复杂 mesh 后会逐渐"堆裂"，出现 BRepMesh 抛 raw
 * pointer 异常（"OCCT error code <huge int>"）。原因是 OCCT 内部 BRep_TFace
 * 等长寿对象的内存碎片化，单纯靠 shape.delete() 清不干净。
 *
 * 对策：跟踪自上次 reinit 起累积 bake 的 OBJ 字节数。超阈值则在下次 bake 前
 * 把 WASM module 整个换掉（重新 import + setOC）。重 init ≈ 470ms。
 *
 * 实测 15-op gear smoke：阈值 6MB 时每 2-3 个重 op 触发一次 reinit，全套稳过；
 * 阈值 12MB（< 单 op 上限）保险够用，常态 bake 几乎不触发。
 */
const REINIT_THRESHOLD_BYTES = 3 * 1024 * 1024;
/** 单次 bake 产 > 此值的大 mesh 后，下次 bake 前强制 reinit。 */
const SINGLE_LARGE_BAKE_BYTES = 1.5 * 1024 * 1024;
let cumulativeBakeBytes = 0;
const MESH_BAKE_ZONE = 'mesh_bake';
type BakeProduct = BakeableShape | MeshGeometry;
const GEOMETRY_BAKE_ALGORITHM_VERSION = 'geometry-bake-v2-curve-winding';
interface BakeBuildMemo {
  readonly shapes: Map<string, BakeProduct>;
}

/** 单线程 bake 队列：避免并发 bake 在 OCCT 单 WASM 上抢资源。 */
let bakeQueue: Promise<unknown> = Promise.resolve();
function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = bakeQueue.then(task, task);
  bakeQueue = next.catch(() => undefined);
  return next;
}

/** 拆掉当前 OCCT/replicad 状态、强制下次 bake 重 init。 */
async function reinitOCCT(): Promise<void> {
  logger.info(
    `[Baker] reinit OCCT (cumulativeBakeBytes=${cumulativeBakeBytes} > ${REINIT_THRESHOLD_BYTES})`,
  );
  occtState = null;
  initPromise = null;
  cumulativeBakeBytes = 0;
  await initBakerService();
}

/**
 * 触发（或 await）OCCT WASM 初始化。可多次安全调用。
 *
 * 调用方：
 *   - main.ts listen() 后调一次做后台预热（不 await，不阻塞启动）
 *   - bake() 内部第一行无条件 await，保证调用前已 ready
 */
export function initBakerService(): Promise<void> {
  if (occtState) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const t0 = Date.now();
    // 0) __dirname shim：replicad_single.js 以 `export default` 结尾，但其包未声明
    //    `"type":"module"`。Node 22 会把这种 typeless 包按 ESM 重解析，导致工厂内
    //    Node 分支的 `scriptDirectory=__dirname+"/"` 因 ESM 无 __dirname 抛
    //    ReferenceError（serve/dist 纯 node 运行时炸，tsx dev 因注入 shim 不炸）。
    //    我们直接喂 wasmBinary 跳过 locateFile，scriptDirectory 实际用不到，只需
    //    保证 __dirname/__filename 全局存在即可。
    const g = globalThis as unknown as { __dirname?: string; __filename?: string };
    if (typeof g.__dirname === 'undefined') g.__dirname = dirname(fileURLToPath(import.meta.url));
    if (typeof g.__filename === 'undefined') g.__filename = fileURLToPath(import.meta.url);
    // 1) 加载 emscripten 工厂（ESM 形式 default export）
    const occtMod = await import('replicad-opencascadejs/src/replicad_single.js');
    const occtFactory = occtMod.default as (
      config?: { wasmBinary?: Uint8Array; INITIAL_MEMORY?: number },
    ) => Promise<unknown>;

    // 2) 直接喂 wasmBinary 跳过 locateFile/fetch —— Node 端最稳路径
    const wasmPath = require_.resolve('replicad-opencascadejs/src/replicad_single.wasm');
    const wasmBinary = readFileSync(wasmPath);
    // 默认 INITIAL_MEMORY=16MB 在连续 bake 多个复杂齿轮（herringbone/planetary）
    // 时会跑爆 OCCT 堆，触发 BRepMesh 抛 raw pointer 异常。开到 128MB（WASM
    // 仍按需 grow），bake 整套 15 个 gear smoke 都稳过。
    const oc = await occtFactory({
      wasmBinary,
      INITIAL_MEMORY: 128 * 1024 * 1024,
    });

    // 3) 注入 replicad 单例
    const replicad = await import('replicad');
    replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);

    occtState = { replicad, tessellation: DEFAULT_TESSELLATION };
    const dt = Date.now() - t0;
    logger.info(
      `[Baker] OCCT WASM ready in ${dt}ms (wasm ${wasmBinary.byteLength}B, ` +
      `bakeable ops: ${listBakeableOps().length})`,
    );
  })().catch((err) => {
    // init 失败必须重置 initPromise，否则后续调用会拿到已 reject 的 Promise 永远恢复不了
    initPromise = null;
    throw err;
  });

  return initPromise;
}

// ── 主入口 ─────────────────────────────────────────────────────────────

/**
 * 把一个 composite shape op + 它的 DSL args 烘焙成 OBJ blob，返回 URL/sha/计数。
 *
 * 调用方为 `g_to_urdf` 电池（也可直接被任何后端 route / 测试调用）。
 *
 * cache 命中判定：
 *   1. 算 sha = sha256(canonicalize(op, args))
 *   2. 把 OBJ alias 定为 `<sha>.obj`，zone="mesh_bake"
 *   3. 先进程内 cache；未命中时进队列 double-check，再查 library mesh_bake alias。
 *   4. 只有内存和磁盘都未命中时才初始化 OCCT、build、tessellate 并写入 library。
 */
export async function bakeShape(
  opName: string,
  args: Record<string, Arg>,
  library: BakerLibraryHandle,
): Promise<BakeResult> {
  const sha = bakeSha256(opName, args);
  // in-process cache：完全命中时省掉 OCCT build + tessellate + library write
  const cached = inprocCacheGet(sha);
  if (cached) {
    logger.debug(`[Baker] cache hit source=inproc op=${opName} sha=${sha.slice(0, 8)}`);
    return { ...cached, cacheHit: true };
  }

  // 真 bake 走序列化队列（OCCT 单 WASM，并发会污染内部状态）
  return runSerialized(() => bakeShapeInner(opName, args, library, sha));
}

/**
 * 烘焙需要解析上游 ref 的 shape 子图（CSG / profile-based ops）。
 * cache key 只使用 root 可达的 shape/profile 子图，避免无关 part/joint/material
 * 变更导致重复 bake。
 */
export async function bakeGeometryShape(
  rootId: string,
  geometry: Geometry,
  library: BakerLibraryHandle,
): Promise<BakeResult> {
  const sha = bakeSha256('__geometry_shape__', {
    algorithm: { kind: 'string', value: GEOMETRY_BAKE_ALGORITHM_VERSION },
    rootId: { kind: 'string', value: rootId },
    source: { kind: 'string', value: reachableSubgraphSource(rootId, geometry) },
  });
  const cached = inprocCacheGet(sha);
  if (cached) {
    logger.debug(`[Baker] cache hit source=inproc geometry root=${rootId} sha=${sha.slice(0, 8)}`);
    return { ...cached, cacheHit: true };
  }
  return runSerialized(() => bakeGeometryShapeInner(rootId, geometry, library, sha));
}

async function bakeShapeInner(
  opName: string,
  args: Record<string, Arg>,
  library: BakerLibraryHandle,
  sha: string,
): Promise<BakeResult> {
  // 进队列后再 double-check cache（前序任务可能已 bake 同 sha）
  const cached = inprocCacheGet(sha);
  if (cached) return { ...cached, cacheHit: true };

  const alias = `${sha}.obj`;
  const diskCached = tryReadDiskCachedBake(alias, sha, library, `op=${opName}`);
  if (diskCached) {
    inprocCacheSet(sha, { ...diskCached, cacheHit: false });
    return diskCached;
  }

  // 内存阈值触发：bake 前换掉 WASM
  if (cumulativeBakeBytes >= REINIT_THRESHOLD_BYTES) {
    await reinitOCCT();
  }
  await initBakerService();
  if (!occtState) throw new BakerError('baker not initialized (unreachable)');

  const builder = getOpBuilder(opName);
  if (!builder) {
    throw new BakerError(
      `op "${opName}" is not bake-able (not in OpBuilderRegistry). ` +
      `Available: ${listBakeableOps().join(', ')}`,
    );
  }

  const opCtx: OpContext = {
    replicad: occtState.replicad,
    tessellation: occtState.tessellation,
  };

  let shape;
  const totalT0 = Date.now();
  const buildT0 = Date.now();
  try {
    shape = builder(opCtx, args);
  } catch (e) {
    if (e instanceof BakerError) throw e;
    const err = e as Error;
    const detail = err?.message ?? (typeof e === 'string' ? e : JSON.stringify(e));
    throw new BakerError(
      `op "${opName}" builder failed: ${detail}${err?.stack ? `\n${err.stack}` : ''}`,
    );
  }
  const buildMs = Date.now() - buildT0;

  let exportResult;
  const exportT0 = Date.now();
  try {
    exportResult = shapeToObj(shape, opCtx.tessellation);
  } catch (e) {
    safeDelete(shape);
    const detail = e instanceof Error
      ? (e.message || e.toString() || 'Error with no message')
      : typeof e === 'string' ? e
        : typeof e === 'number' ? `OCCT error code ${e}`
          : JSON.stringify(e);
    throw new BakerError(`op "${opName}" tessellation failed: ${detail}`);
  }
  const exportMs = Date.now() - exportT0;

  // 释放 OCCT WASM 堆内存。tessellation 完成后 shape 不再需要。
  safeDelete(shape);

  // 防爆保护：超大 mesh 通常意味着 DSL 参数尺度跟 tessellation 容差不匹配
  // （比如把"米"约定的几何按"毫米"传 → 物体放大 1000 倍，0.1mm 弦差就细分爆炸）。
  // 与其把几 MB OBJ 推给 viewer 卡死，不如这里 fail 让 g_to_urdf 走 AABB box 兜底。
  if (
    exportResult.triangleCount > MAX_TRIANGLES ||
    exportResult.bytes.byteLength > MAX_OBJ_BYTES
  ) {
    throw new BakerError(
      `op "${opName}" produced an oversized mesh (V=${exportResult.vertexCount} ` +
      `T=${exportResult.triangleCount} OBJ=${exportResult.bytes.byteLength}B); ` +
      `check that DSL params are in meters (default tessellation deflection is 0.1mm). ` +
      `Limits: ≤${MAX_TRIANGLES} triangles, ≤${MAX_OBJ_BYTES}B.`,
    );
  }
  if (exportResult.triangleCount > WARN_TRIANGLES) {
    logger.warn(
      `[Baker] op=${opName} sha=${sha.slice(0, 8)} produced a large mesh ` +
      `(V=${exportResult.vertexCount} T=${exportResult.triangleCount} ` +
      `OBJ=${exportResult.bytes.byteLength}B); viewer may be sluggish. ` +
      `Consider smaller params (DSL is meter-scale).`,
    );
  }

  // 落 library。同 alias 已存在时 importFromBuffer 会复用 blob，sha256 由 buffer 内容决定。
  const writeT0 = Date.now();
  const record = await library.importFromBuffer(exportResult.bytes, alias, alias, {
    zone: MESH_BAKE_ZONE,
    source: 'pipeline',
    tags: ['mesh', 'baked', opName],
  });
  const writeMs = Date.now() - writeT0;

  const result: BakeResult = {
    url: `${record.blobId}.obj`,
    sha256: sha,
    blobSha256: record.blobId,
    vertexCount: exportResult.vertexCount,
    triangleCount: exportResult.triangleCount,
    byteSize: exportResult.bytes.byteLength,
    cacheHit: false,
    ...(exportResult.bboxMin ? { bboxMin: exportResult.bboxMin } : {}),
    ...(exportResult.bboxMax ? { bboxMax: exportResult.bboxMax } : {}),
  };

  inprocCacheSet(sha, result);
  // 单次大 mesh 多算一份"压力"，让下次 bake 前更可能触发 reinit
  cumulativeBakeBytes += exportResult.bytes.byteLength;
  if (exportResult.bytes.byteLength >= SINGLE_LARGE_BAKE_BYTES) {
    cumulativeBakeBytes += REINIT_THRESHOLD_BYTES; // 立即触发下次 reinit
  }

  logger.debug(
    `[Baker] baked op=${opName} sha=${sha.slice(0, 8)} V=${result.vertexCount} ` +
    `T=${result.triangleCount} OBJ=${result.byteSize}B blob=${record.blobId.slice(0, 8)} ` +
    `timing build=${buildMs}ms export=${exportMs}ms write=${writeMs}ms total=${Date.now() - totalT0}ms`,
  );

  return result;
}

async function bakeGeometryShapeInner(
  rootId: string,
  geometry: Geometry,
  library: BakerLibraryHandle,
  sha: string,
): Promise<BakeResult> {
  const cached = inprocCacheGet(sha);
  if (cached) return { ...cached, cacheHit: true };

  const alias = `${sha}.obj`;
  const diskCached = tryReadDiskCachedBake(alias, sha, library, `geometry root=${rootId}`);
  if (diskCached) {
    inprocCacheSet(sha, { ...diskCached, cacheHit: false });
    return diskCached;
  }

  if (cumulativeBakeBytes >= REINIT_THRESHOLD_BYTES) {
    await reinitOCCT();
  }
  await initBakerService();
  if (!occtState) throw new BakerError('baker not initialized (unreachable)');

  const byId = new Map(geometry.statements.map(s => [s.id, s]));
  const root = byId.get(rootId);
  if (!root) throw new BakerError(`root shape "${rootId}" not found in Geometry`);

  const opCtx: OpContext = {
    replicad: occtState.replicad,
    tessellation: occtState.tessellation,
  };

  let shape;
  const memo: BakeBuildMemo = { shapes: new Map() };
  const totalT0 = Date.now();
  const buildT0 = Date.now();
  try {
    shape = buildStatementShape(opCtx, memo, root, byId, new Set());
  } catch (e) {
    disposeMemo(memo);
    if (e instanceof BakerError) throw e;
    const err = e as Error;
    const detail = err?.message ?? (typeof e === 'string' ? e : JSON.stringify(e));
    throw new BakerError(
      `geometry shape "${rootId}" builder failed: ${detail}${err?.stack ? `\n${err.stack}` : ''}`,
    );
  }
  const buildMs = Date.now() - buildT0;

  let exportResult;
  const exportT0 = Date.now();
  try {
    exportResult = shapeToObj(shape, opCtx.tessellation);
  } catch (e) {
    safeDelete(shape);
    disposeMemo(memo);
    const detail = e instanceof Error
      ? (e.message || e.toString() || 'Error with no message')
      : typeof e === 'string' ? e
        : typeof e === 'number' ? `OCCT error code ${e}`
          : JSON.stringify(e);
    throw new BakerError(`geometry shape "${rootId}" tessellation failed: ${detail}`);
  }
  const exportMs = Date.now() - exportT0;

  safeDelete(shape);
  disposeMemo(memo);
  if (
    exportResult.triangleCount > MAX_TRIANGLES ||
    exportResult.bytes.byteLength > MAX_OBJ_BYTES
  ) {
    throw new BakerError(
      `geometry shape "${rootId}" produced an oversized mesh (V=${exportResult.vertexCount} ` +
      `T=${exportResult.triangleCount} OBJ=${exportResult.bytes.byteLength}B).`,
    );
  }
  if (exportResult.triangleCount > WARN_TRIANGLES) {
    logger.warn(
      `[Baker] geometry root=${rootId} sha=${sha.slice(0, 8)} produced a large mesh ` +
      `(V=${exportResult.vertexCount} T=${exportResult.triangleCount} OBJ=${exportResult.bytes.byteLength}B)`,
    );
  }

  const writeT0 = Date.now();
  const record = await library.importFromBuffer(exportResult.bytes, alias, alias, {
    zone: MESH_BAKE_ZONE,
    source: 'pipeline',
    tags: ['mesh', 'baked', root.op, 'geometry_subgraph'],
  });
  const writeMs = Date.now() - writeT0;

  const result: BakeResult = {
    url: `${record.blobId}.obj`,
    sha256: sha,
    blobSha256: record.blobId,
    vertexCount: exportResult.vertexCount,
    triangleCount: exportResult.triangleCount,
    byteSize: exportResult.bytes.byteLength,
    cacheHit: false,
    ...(exportResult.bboxMin ? { bboxMin: exportResult.bboxMin } : {}),
    ...(exportResult.bboxMax ? { bboxMax: exportResult.bboxMax } : {}),
  };
  inprocCacheSet(sha, result);
  cumulativeBakeBytes += exportResult.bytes.byteLength;
  if (exportResult.bytes.byteLength >= SINGLE_LARGE_BAKE_BYTES) {
    cumulativeBakeBytes += REINIT_THRESHOLD_BYTES;
  }

  logger.debug(
    `[Baker] baked geometry root=${rootId} op=${root.op} sha=${sha.slice(0, 8)} ` +
    `V=${result.vertexCount} T=${result.triangleCount} OBJ=${result.byteSize}B ` +
    `blob=${record.blobId.slice(0, 8)} timing build=${buildMs}ms export=${exportMs}ms ` +
    `write=${writeMs}ms total=${Date.now() - totalT0}ms`,
  );
  return result;
}

function tryReadDiskCachedBake(
  alias: string,
  cacheKey: string,
  library: BakerLibraryHandle,
  label: string,
): BakeResult | null {
  const lookupT0 = Date.now();
  const asset = library.getByAlias?.(alias, MESH_BAKE_ZONE);
  if (!asset) {
    logger.debug(`[Baker] cache miss source=disk ${label} sha=${cacheKey.slice(0, 8)} lookup=${Date.now() - lookupT0}ms`);
    return null;
  }

  const filePath = library.resolveBlobPath?.(alias, MESH_BAKE_ZONE);
  if (!filePath) {
    logger.warn(
      `[Baker] cache metadata exists but blob file is missing ${label} ` +
      `alias=${alias} blob=${asset.blobId.slice(0, 8)}`,
    );
    return null;
  }

  try {
    const bytes = readFileSync(filePath);
    const stats = countObjStats(bytes);
    const result: BakeResult = {
      url: `${asset.blobId}.obj`,
      sha256: cacheKey,
      blobSha256: asset.blobId,
      vertexCount: stats.vertexCount,
      triangleCount: stats.triangleCount,
      byteSize: bytes.byteLength,
      cacheHit: true,
      ...(stats.bboxMin ? { bboxMin: stats.bboxMin } : {}),
      ...(stats.bboxMax ? { bboxMax: stats.bboxMax } : {}),
    };
    logger.debug(
      `[Baker] cache hit source=disk ${label} sha=${cacheKey.slice(0, 8)} ` +
      `blob=${asset.blobId.slice(0, 8)} V=${result.vertexCount} T=${result.triangleCount} ` +
      `OBJ=${result.byteSize}B lookup=${Date.now() - lookupT0}ms`,
    );
    return result;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.warn(`[Baker] failed to read disk cache ${label} alias=${alias}: ${detail}`);
    return null;
  }
}

function countObjStats(bytes: Buffer): {
  vertexCount: number;
  triangleCount: number;
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
} {
  const text = bytes.toString('utf8');
  let vertexCount = 0;
  let triangleCount = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      vertexCount += 1;
      const parts = line.split(/\s+/);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        seen = true;
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
    } else if (line.startsWith('f ')) {
      triangleCount += 1;
    }
  }
  return {
    vertexCount,
    triangleCount,
    bboxMin: seen ? min : null,
    bboxMax: seen ? max : null,
  };
}

function buildStatementShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const cached = memo.shapes.get(stmt.id);
  if (cached) return cloneBakeProduct(cached);
  if (visiting.has(stmt.id)) throw new BakerError(`cycle detected while baking "${stmt.id}"`);
  visiting.add(stmt.id);
  try {
    const product = (() => {
      switch (stmt.op) {
      case 'box': {
        const size = readNumList(stmt.args.size, 3);
        if (!size) throw new BakerError('box: required param "size" missing or invalid');
        return ctx.replicad.makeBaseBox(size[0], size[1], size[2]).translateZ(-size[2] / 2);
      }
      case 'cylinder': {
        const r = readNumber(stmt.args.radius);
        const l = readNumber(stmt.args.length);
        if (r === undefined || l === undefined) throw new BakerError('cylinder: radius/length missing');
        return ctx.replicad.makeCylinder(r, l, [0, 0, -l / 2], [0, 0, 1]);
      }
      case 'sphere': {
        const r = readNumber(stmt.args.radius);
        if (r === undefined) throw new BakerError('sphere: radius missing');
        return ctx.replicad.makeSphere(r);
      }
      case 'profile_polygon':
      case 'profile_rect':
      case 'profile_circle':
      case 'profile_rounded_rect':
      case 'profile_regular_polygon':
        return buildProfilePreviewShape(ctx, stmt);
      case 'union': {
        return csgFuse(
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'a', byId, visiting), 'union'),
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'b', byId, visiting), 'union'),
        );
      }
      case 'difference': {
        return csgCut(
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'base', byId, visiting), 'difference'),
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'tool', byId, visiting), 'difference'),
        );
      }
      case 'intersection': {
        return csgIntersect(
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'a', byId, visiting), 'intersection'),
          ensureReplicadShape(buildRefShape(ctx, memo, stmt, 'b', byId, visiting), 'intersection'),
        );
      }
      case 'extrude':
        return buildExtrudeShape(ctx, stmt, byId);
      case 'extrude_with_holes':
        return buildExtrudeWithHolesShape(ctx, stmt, byId);
      case 'loft':
        return buildLoftShape(ctx, stmt, byId);
      case 'pipe':
        return buildPipeShape(ctx, stmt);
      case 'sweep':
        return buildSweepShape(ctx, stmt, byId);
      case 'section_loft':
        return buildSectionLoftShape(stmt);
      case 'lathe':
      case 'revolve':
        return buildLatheShape(ctx, stmt, byId);
      case 'translate':
        return buildTranslateShape(ctx, memo, stmt, byId, visiting);
      case 'rotate':
        return buildRotateShape(ctx, memo, stmt, byId, visiting);
      case 'scale':
        return buildScaleShape(ctx, memo, stmt, byId, visiting);
      case 'mirror':
        return buildMirrorShape(ctx, memo, stmt, byId, visiting);
      case 'array_linear':
        return buildArrayLinearShape(ctx, memo, stmt, byId, visiting);
      case 'array_radial':
        return buildArrayRadialShape(ctx, memo, stmt, byId, visiting);
      default: {
        const builder = getOpBuilder(stmt.op);
        if (!builder) throw new BakerError(`op "${stmt.op}" is not bake-able inside CSG`);
        return builder(ctx, stmt.args);
      }
      }
    })();
    memo.shapes.set(stmt.id, product);
    return cloneBakeProduct(product);
  } finally {
    visiting.delete(stmt.id);
  }
}

function buildRefShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  argName: string,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const refArg = stmt.args[argName];
  if (!refArg || refArg.kind !== 'ref') throw new BakerError(`${stmt.op}: "${argName}" must be a ref`);
  const target = byId.get(refArg.name);
  if (!target) throw new BakerError(`${stmt.op}: ref "${refArg.name}" not found`);
  return buildStatementShape(ctx, memo, target, byId, visiting);
}

function ensureReplicadShape(shape: BakeProduct, op: string): ReplicadShape {
  if (isMeshGeometry(shape)) {
    throw new BakerError(
      `${op}: boolean operations cannot consume mesh-backed shapes. `
      + `Upstream pipe/sweep/section_loft (and align/non-polyline sweep) produce triangle meshes, not solids, `
      + `so they cannot be a base/tool/operand of union/difference/intersection. `
      + `Build the boolean from solid primitives (box/cylinder/sphere) or extrude/loft/revolve solids instead, `
      + `or apply the boolean before converting to a mesh-backed path op.`,
    );
  }
  return shape;
}

type ClosedDrawing = ReturnType<ReturnType<OpContext['replicad']['draw']>['close']>;
const PROFILE_PREVIEW_THICKNESS = 0.002;

function buildProfilePreviewShape(ctx: OpContext, stmt: Statement): BakeableShape {
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const sketch = drawingFromPoints(ctx, profilePoints(stmt))
    .sketchOnPlane('XY', -PROFILE_PREVIEW_THICKNESS / 2) as unknown as SolidSketch;
  return sketch.extrude(PROFILE_PREVIEW_THICKNESS);
}

function buildExtrudeShape(
  ctx: OpContext,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): BakeableShape {
  const profile = resolveProfile(stmt, byId);
  const h = readNumber(stmt.args.height);
  if (h === undefined || h <= 0) throw new BakerError('extrude: height must be positive');
  const center = readBool(stmt.args.center) ?? true;
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const sketch = drawingFromPoints(ctx, profile).sketchOnPlane('XY', center ? -h / 2 : 0) as unknown as SolidSketch;
  return sketch.extrude(h);
}

function buildExtrudeWithHolesShape(
  ctx: OpContext,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): BakeableShape {
  const outerRef = stmt.args.outer;
  if (!outerRef || outerRef.kind !== 'ref') throw new BakerError('extrude_with_holes: outer must be a ref');
  const outerStmt = byId.get(outerRef.name);
  if (!outerStmt) throw new BakerError(`extrude_with_holes: outer "${outerRef.name}" not found`);

  let drawing = drawingFromPoints(ctx, profilePoints(outerStmt));
  const holesArg = stmt.args.holes;
  if (holesArg !== undefined) {
    if (holesArg.kind !== 'list') throw new BakerError('extrude_with_holes: holes must be a list of refs');
    for (const item of holesArg.items) {
      if (item.kind !== 'ref') throw new BakerError('extrude_with_holes: holes must contain only refs');
      const holeStmt = byId.get(item.name);
      if (!holeStmt) throw new BakerError(`extrude_with_holes: hole "${item.name}" not found`);
      drawing = drawing.cut(drawingFromPoints(ctx, profilePoints(holeStmt))) as ClosedDrawing;
    }
  }

  const h = readNumber(stmt.args.height);
  if (h === undefined || h <= 0) throw new BakerError('extrude_with_holes: height must be positive');
  const center = readBool(stmt.args.center) ?? true;
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const sketch = drawing.sketchOnPlane('XY', center ? -h / 2 : 0) as unknown as SolidSketch;
  return sketch.extrude(h);
}

function buildLatheShape(
  ctx: OpContext,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): BakeableShape {
  const profile = resolveProfile(stmt, byId);
  // lathe/revolve 把 profile 的每个点当作 (r, z) 在 XZ 平面绕 Z 轴旋转。
  // 若 profile 实际是 XY 语义（如 g_profile_rect/circle/polygon 居中于原点），
  // 其 x 会出现负值 → 这里直接报错，避免静默生成错误回转体。
  const refArg = stmt.args.profile;
  const srcOp = (refArg && refArg.kind === 'ref') ? byId.get(refArg.name)?.op : undefined;
  for (const [r] of profile) {
    if (r < 0) {
      const hint = srcOp
        ? ` (profile source op "${srcOp}" appears to be an XY-centered profile; lathe/revolve需要 r,z 语义且所有 r>=0，请改用专为回转设计、半径非负的 profile)`
        : ' (lathe/revolve 把点视为 r,z；所有 r 必须 >= 0)';
      throw new BakerError(`${stmt.op}: profile radii must be >= 0${hint}`);
    }
  }
  type RevolveSketch = { revolve: (axis?: [number, number, number]) => BakeableShape };
  const sketch = drawingFromPoints(ctx, profile).sketchOnPlane('XZ', 0) as unknown as RevolveSketch;
  return sketch.revolve([0, 0, 1]);
}

function buildLoftShape(
  ctx: OpContext,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): BakeableShape {
  const profilesArg = stmt.args.profiles;
  if (!profilesArg || profilesArg.kind !== 'list') throw new BakerError('loft: profiles must be a list of refs');
  const profileRefs = profilesArg.items;
  if (profileRefs.length < 2) throw new BakerError('loft: profiles must contain at least two refs');

  const profiles = profileRefs.map((arg) => {
    if (arg.kind !== 'ref') throw new BakerError('loft: profiles must contain only refs');
    const profile = byId.get(arg.name);
    if (!profile) throw new BakerError(`loft: profile "${arg.name}" not found`);
    return profilePoints(profile);
  });
  assertSamePointCount('loft', profiles);

  const zValues = readNumList(stmt.args.z_values);
  const height = readNumber(stmt.args.height) ?? 1;
  if (height <= 0) throw new BakerError('loft: height must be positive');
  if (zValues && zValues.length !== profiles.length) {
    throw new BakerError('loft: z_values length must match profiles length');
  }
  const zs = zValues ?? profiles.map((_, i) => -height / 2 + (height * i) / (profiles.length - 1));
  const ruled = readBool(stmt.args.ruled) ?? false;

  return loftProfilesAt(ctx, profiles, zs, ruled);
}

function buildSweepShape(
  ctx: OpContext,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): BakeProduct {
  const profile = resolveProfile(stmt, byId);
  const path = readPathPoints(stmt.args.path, 'sweep');
  const spline = readString(stmt.args.spline) ?? 'polyline';
  const align = readBool(stmt.args.align) ?? false;
  if (align || spline !== 'polyline') {
    return sweepProfileMesh(path, profile, readSweepOptions(stmt, !Boolean(readBool(stmt.args.closed))));
  }
  const sampled = samplePath(path, readSweepOptions(stmt, false));
  const profiles = sampled.map(([x, y]) => profile.map(([px, py]) => [px + x, py + y] as const));
  const zs = sampled.map((p) => p[2]);
  const ruled = readBool(stmt.args.ruled) ?? false;
  return loftProfilesAt(ctx, profiles, zs, ruled);
}

function buildPipeShape(ctx: OpContext, stmt: Statement): BakeProduct {
  const path = readPathPoints(stmt.args.path, 'pipe');
  const radius = readNumber(stmt.args.radius);
  if (radius === undefined || radius <= 0) throw new BakerError('pipe: radius must be positive');
  const spline = readString(stmt.args.spline) ?? 'polyline';
  const radialSegments = Math.round(readNumber(stmt.args.radial_segments) ?? 16);
  const closed = readBool(stmt.args.closed) ?? false;
  const cap = readBool(stmt.args.cap) ?? !closed;
  if (spline !== 'polyline' || radialSegments !== 16 || closed || stmt.args.up_hint || stmt.args.samples_per_segment) {
    return tubeMeshFromPath(path, radius, radialSegments, readSweepOptions(stmt, cap));
  }

  const pieces: BakeableShape[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as [number, number, number];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len <= 1e-9) continue;
    pieces.push(ctx.replicad.makeCylinder(radius, len, asPoint(a), dir) as BakeableShape);
  }
  for (const p of path) pieces.push(ctx.replicad.makeSphere(radius).translate(asPoint(p)) as BakeableShape);
  if (pieces.length === 0) throw new BakerError('pipe: path has no non-zero segments');
  return compoundOrSingle(ctx, pieces);
}

function buildSectionLoftShape(stmt: Statement): BakeProduct {
  const sections = readSectionPoints(stmt.args.sections);
  const closed = readBool(stmt.args.closed) ?? false;
  const cap = readBool(stmt.args.cap) ?? !closed;
  return sectionLoftMesh(sections, { closed, cap });
}

function loftProfilesAt(
  ctx: OpContext,
  profiles: Array<Array<readonly [number, number]>>,
  zs: readonly number[],
  ruled: boolean,
): BakeableShape {
  type SketchLike = unknown;
  const sketches: SketchLike[] = profiles.map((profile, i) => drawingFromPoints(ctx, profile).sketchOnPlane('XY', zs[i]));
  const [first, ...rest] = sketches;
  return (first as unknown as {
    loftWith: (s: unknown[], cfg?: { ruled?: boolean }) => BakeableShape;
  }).loftWith(rest as unknown[], { ruled });
}

function assertSamePointCount(op: string, profiles: Array<Array<readonly [number, number]>>): void {
  const n = profiles[0]?.length ?? 0;
  if (n < 3) throw new BakerError(`${op}: profiles must contain at least 3 points`);
  for (const p of profiles) {
    if (p.length !== n) throw new BakerError(`${op}: all profiles must have the same point count`);
  }
}

function readPathPoints(arg: Arg | undefined, op: string): Array<readonly [number, number, number]> {
  const raw = readNumList(arg);
  if (!raw || raw.length < 6 || raw.length % 3 !== 0) {
    throw new BakerError(`${op}: path must be [x1,y1,z1,x2,y2,z2,...] with at least two points`);
  }
  const out: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < raw.length; i += 3) out.push([raw[i], raw[i + 1], raw[i + 2]]);
  return out;
}

function readSweepOptions(stmt: Statement, defaultCap: boolean) {
  return {
    spline: readString(stmt.args.spline) ?? 'polyline',
    samplesPerSegment: Math.round(readNumber(stmt.args.samples_per_segment) ?? 12),
    closed: readBool(stmt.args.closed) ?? false,
    alpha: readNumber(stmt.args.alpha) ?? 0.5,
    upHint: asPoint(readNumList(stmt.args.up_hint, 3) ?? [0, 0, 1]),
    cap: readBool(stmt.args.cap) ?? defaultCap,
  };
}

function readSectionPoints(arg: Arg | undefined): Vec3[][] {
  if (!arg || arg.kind !== 'list') throw new BakerError('section_loft: sections must be a list');
  const sections: Vec3[][] = [];
  for (const section of arg.items) {
    if (section.kind !== 'list') throw new BakerError('section_loft: sections must contain point lists');
    const raw = readNumList(section);
    if (!raw || raw.length < 9 || raw.length % 3 !== 0) {
      throw new BakerError('section_loft: each section must be [x1,y1,z1,...] with at least three points');
    }
    const pts: Vec3[] = [];
    for (let i = 0; i < raw.length; i += 3) pts.push([raw[i], raw[i + 1], raw[i + 2]]);
    sections.push(pts);
  }
  return sections;
}

function buildTranslateShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const offset = readNumList(stmt.args.offset, 3);
  if (!offset) throw new BakerError('translate: offset must be [x,y,z]');
  const shape = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  return isMeshGeometry(shape) ? translateMesh(shape, asPoint(offset)) : shape.translate(asPoint(offset));
}

function buildRotateShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const angle = readNumber(stmt.args.angle_deg);
  if (angle === undefined) throw new BakerError('rotate: angle_deg missing');
  const axis = readNumList(stmt.args.axis, 3) ?? [0, 0, 1];
  const origin = readNumList(stmt.args.origin, 3) ?? [0, 0, 0];
  if (Math.hypot(axis[0], axis[1], axis[2]) <= 1e-9) throw new BakerError('rotate: axis must be non-zero');
  const shape = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  return isMeshGeometry(shape)
    ? rotateMesh(shape, angle, asPoint(origin), asPoint(axis))
    : shape.rotate(angle, asPoint(origin), asPoint(axis));
}

function buildScaleShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const factor = readNumber(stmt.args.factor);
  if (factor === undefined || factor <= 0) throw new BakerError('scale: factor must be positive');
  const center = readNumList(stmt.args.center, 3) ?? [0, 0, 0];
  const shape = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  return isMeshGeometry(shape) ? scaleMesh(shape, factor, asPoint(center)) : shape.scale(factor, asPoint(center));
}

function buildMirrorShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const plane = (readString(stmt.args.plane) ?? 'YZ').toUpperCase();
  if (!['XY', 'YZ', 'XZ'].includes(plane)) throw new BakerError('mirror: plane must be XY/YZ/XZ');
  const origin = readNumList(stmt.args.origin, 3) ?? [0, 0, 0];
  const shape = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  return isMeshGeometry(shape)
    ? mirrorMesh(shape, plane, asPoint(origin))
    : shape.mirror(plane as 'XY' | 'YZ' | 'XZ', asPoint(origin));
}

function buildArrayLinearShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const count = readCount(stmt, 'array_linear');
  const step = readNumList(stmt.args.step, 3);
  if (!step) throw new BakerError('array_linear: step must be [dx,dy,dz]');
  const base = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  const copies: BakeProduct[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      copies.push(cloneBakeProduct(base));
    } else if (isMeshGeometry(base)) {
      copies.push(translateMesh(base, [step[0] * i, step[1] * i, step[2] * i]));
    } else {
      const copy = cloneBakeProduct(base) as ReplicadShape;
      copies.push(copy.translate([step[0] * i, step[1] * i, step[2] * i]));
      safeDelete(copy);
    }
  }
  safeDelete(base);
  return compoundOrSingle(ctx, copies);
}

function buildArrayRadialShape(
  ctx: OpContext,
  memo: BakeBuildMemo,
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): BakeProduct {
  const count = readCount(stmt, 'array_radial');
  const totalDeg = readNumber(stmt.args.angle_deg) ?? 360;
  const axis = readNumList(stmt.args.axis, 3) ?? [0, 0, 1];
  const origin = readNumList(stmt.args.origin, 3) ?? [0, 0, 0];
  if (Math.hypot(axis[0], axis[1], axis[2]) <= 1e-9) throw new BakerError('array_radial: axis must be non-zero');
  const denom = Math.abs(totalDeg) >= 360 - 1e-9 ? count : Math.max(count - 1, 1);
  const base = buildRefShape(ctx, memo, stmt, 'shape', byId, visiting);
  const copies: BakeProduct[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (totalDeg * i) / denom;
    if (Math.abs(angle) <= 1e-9) {
      copies.push(cloneBakeProduct(base));
    } else if (isMeshGeometry(base)) {
      copies.push(rotateMesh(base, angle, asPoint(origin), asPoint(axis)));
    } else {
      const copy = cloneBakeProduct(base) as ReplicadShape;
      copies.push(copy.rotate(angle, asPoint(origin), asPoint(axis)));
      safeDelete(copy);
    }
  }
  safeDelete(base);
  return compoundOrSingle(ctx, copies);
}

function readCount(stmt: Statement, op: string): number {
  const raw = readNumber(stmt.args.count);
  const count = Math.round(raw ?? 0);
  if (!Number.isFinite(count) || count < 1 || count > 128) {
    throw new BakerError(`${op}: count must be an integer in [1, 128]`);
  }
  return count;
}

function asPoint(v: readonly number[]): [number, number, number] {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}

function compoundOrSingle(ctx: OpContext, shapes: BakeProduct[]): BakeProduct {
  if (shapes.length === 0) throw new BakerError('compound requires at least one shape');
  if (shapes.length === 1) return shapes[0];
  if (shapes.every(isMeshGeometry)) return combineMeshes(shapes as MeshGeometry[]);
  if (shapes.some(isMeshGeometry)) {
    throw new BakerError('cannot build a mixed OCCT/mesh compound');
  }
  const compound = ctx.replicad.makeCompound(shapes as ReplicadShape[]) as BakeableShape;
  for (const shape of shapes) safeDelete(shape);
  return compound;
}

function cloneBakeProduct(product: BakeProduct): BakeProduct {
  if (isMeshGeometry(product)) {
    return {
      kind: 'mesh_geometry',
      vertices: product.vertices.map(v => [v[0], v[1], v[2]] as const),
      faces: product.faces.map(f => [f[0], f[1], f[2]] as const),
    };
  }
  return product.clone() as BakeableShape;
}

function disposeMemo(memo: BakeBuildMemo): void {
  for (const product of memo.shapes.values()) {
    if (!isMeshGeometry(product)) safeDelete(product);
  }
  memo.shapes.clear();
}

function resolveProfile(
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
): Array<readonly [number, number]> {
  const refArg = stmt.args.profile;
  if (!refArg || refArg.kind !== 'ref') throw new BakerError(`${stmt.op}: profile must be a ref`);
  const profile = byId.get(refArg.name);
  if (!profile) throw new BakerError(`${stmt.op}: profile "${refArg.name}" not found`);
  return profilePoints(profile);
}

function profilePoints(profile: Statement): Array<readonly [number, number]> {
  switch (profile.op) {
    case 'profile_polygon': {
      const raw = readNumList(profile.args.points);
      if (!raw || raw.length < 6 || raw.length % 2 !== 0) {
        throw new BakerError('profile_polygon: points must contain at least 3 x/y pairs');
      }
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
      return out;
    }
    case 'profile_rect': {
      const w = readNumber(profile.args.w);
      const d = readNumber(profile.args.d);
      if (w === undefined || d === undefined || w <= 0 || d <= 0) {
        throw new BakerError('profile_rect: w and d must be positive');
      }
      return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    }
    case 'profile_circle': {
      const r = readNumber(profile.args.radius);
      const segments = Math.round(readNumber(profile.args.segments) ?? 48);
      if (r === undefined || r <= 0) throw new BakerError('profile_circle: radius must be positive');
      if (segments < 3 || segments > 256) throw new BakerError('profile_circle: segments must be in [3, 256]');
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i < segments; i++) {
        const a = (Math.PI * 2 * i) / segments;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return out;
    }
    case 'profile_rounded_rect': {
      const w = readNumber(profile.args.w);
      const d = readNumber(profile.args.d);
      const r = readNumber(profile.args.radius);
      const segments = Math.round(readNumber(profile.args.segments) ?? 8);
      if (w === undefined || d === undefined || r === undefined || w <= 0 || d <= 0 || r < 0) {
        throw new BakerError('profile_rounded_rect: w/d must be positive and radius must be >= 0');
      }
      if (r > Math.min(w, d) / 2) throw new BakerError('profile_rounded_rect: radius too large');
      if (segments < 1 || segments > 64) throw new BakerError('profile_rounded_rect: segments must be in [1, 64]');
      return roundedRectPoints(w, d, r, segments);
    }
    case 'profile_regular_polygon': {
      const r = readNumber(profile.args.radius);
      const sides = Math.round(readNumber(profile.args.sides) ?? 0);
      if (r === undefined || r <= 0) throw new BakerError('profile_regular_polygon: radius must be positive');
      if (sides < 3 || sides > 128) throw new BakerError('profile_regular_polygon: sides must be in [3, 128]');
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i < sides; i++) {
        const a = (Math.PI * 2 * i) / sides + Math.PI / 2;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return out;
    }
    default:
      throw new BakerError(`op "${profile.op}" is not a profile`);
  }
}

function roundedRectPoints(w: number, d: number, r: number, segments: number): Array<readonly [number, number]> {
  if (r <= 1e-9) return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const hx = w / 2 - r;
  const hy = d / 2 - r;
  const centers: Array<readonly [number, number, number, number]> = [
    [hx, hy, 0, Math.PI / 2],
    [-hx, hy, Math.PI / 2, Math.PI],
    [-hx, -hy, Math.PI, Math.PI * 1.5],
    [hx, -hy, Math.PI * 1.5, Math.PI * 2],
  ];
  const out: Array<readonly [number, number]> = [];
  for (const [cx, cy, a0, a1] of centers) {
    for (let i = 0; i <= segments; i++) {
      if (out.length > 0 && i === 0) continue;
      const t = i / segments;
      const a = a0 + (a1 - a0) * t;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

function drawingFromPoints(ctx: OpContext, points: Array<readonly [number, number]>): ClosedDrawing {
  if (points.length < 3) throw new BakerError('profile must contain at least 3 points');
  const pen = ctx.replicad.draw([points[0][0], points[0][1]]);
  for (let i = 1; i < points.length; i++) pen.lineTo([points[i][0], points[i][1]]);
  return pen.close();
}

// ── In-process cache —————————————————————————————————————————————

/**
 * 本进程内的 sha → BakeResult 缓存。开销轻（一个 Map 条目几十字节），
 * 命中后整个 bake 调用直接返回，省掉 OCCT 构图 + tessellate + library write。
 *
 * 有界 LRU：长时间运行 + 反复迭代会持续产生新 sha（每次改参数都是新 key），
 * 无界 Map 会单调增长。这里设上限并按"最久未用"淘汰。BakeResult 本身很小
 * （只存 url/sha/计数，不存 OBJ 字节），淘汰只丢失一次缓存命中、磁盘 alias 仍在，
 * 重新 bake 会再次命中磁盘缓存，正确性不受影响。
 */
const INPROC_CACHE_MAX_ENTRIES = 1024;
const INPROC_CACHE = new Map<string, BakeResult>();

/** 读缓存并把命中条目移到"最近使用"末尾（LRU touch）。 */
function inprocCacheGet(sha: string): BakeResult | undefined {
  const hit = INPROC_CACHE.get(sha);
  if (hit === undefined) return undefined;
  INPROC_CACHE.delete(sha);
  INPROC_CACHE.set(sha, hit);
  return hit;
}

/** 写缓存并在超出上限时淘汰最久未用的条目（Map 迭代序 = 插入/touch 序）。 */
function inprocCacheSet(sha: string, result: BakeResult): void {
  INPROC_CACHE.delete(sha);
  INPROC_CACHE.set(sha, result);
  while (INPROC_CACHE.size > INPROC_CACHE_MAX_ENTRIES) {
    const oldest = INPROC_CACHE.keys().next();
    if (oldest.done) break;
    INPROC_CACHE.delete(oldest.value);
  }
}

/** 测试 / 重启 / 手动失效 用 —— 不要在请求路径里调。 */
export function clearBakerCache(): void {
  INPROC_CACHE.clear();
}

/** 仅 debug / monitor 用：返回当前缓存条目数。 */
export function bakerCacheSize(): number {
  return INPROC_CACHE.size;
}

// ── OCCT 内存管理 ────────────────────────────────────────────────────

/** 安全释放 OCCT WASM 堆上的对象。失败时静默（不中断业务流）。 */
function safeDelete(obj: unknown): void {
  try { (obj as { delete?: () => void } | null | undefined)?.delete?.(); } catch { /* OCCT 对象可能已被回收 */ }
}
