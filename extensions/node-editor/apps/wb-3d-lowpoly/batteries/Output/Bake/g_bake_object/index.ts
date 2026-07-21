/**
 * g_bake_object —— 把"一个由多个上色 part 组成的物体"整体烘成单个**多材质 GLB**。
 *
 * 与 g_bake_part 的区别：
 *   - g_bake_part 烘**一个形状**成纯几何 OBJ（无颜色）——一个 mesh 只能上一种 link 材质。
 *   - g_bake_object 烘**整组 part（每个带 shape + material 颜色 + 位姿）**成一个 `<sha>.glb`，
 *     颜色按 part 内嵌进 GLB。场景里 `g_mesh(filename=<sha>.glb)` 单实例引用即可保留多色。
 *     **引用它的 g_part 不要再上 material**，否则 viewer 会用 link 材质覆盖内嵌色。
 *
 * 输入 geometry 里所有 `part` 语句都会被烘进同一个物体 GLB：每个 part 解析
 * shape(ref) + material(ref→rgba，缺省灰) + origin/rpy，交给 baker.bakeColoredAssembly。
 *
 * 容错：不抛异常；失败路径写 error 字段返回并透传 geometry。
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import {
  parseGeometryPort,
  makeGeometry,
  listBakeableShapeOps,
  listSubgraphBakeOps,
  listUrdfNativeShapeOps,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

// 可烘进 GLB 的 part 形状：URDF 原生 primitive + CSG/profile 子图 + 单 op composite。
// 另外**也接受 `mesh`**（引用分件 `g_bake_part` 预烘的 `<sha>.obj`）：baker 会回读该 blob
// 的三角面、按 part 位姿合并进同一张网格。颜色由 part 的 `g_material` 决定（OBJ 本身无色），
// 缺省灰。角色路正是靠这条把"分件建模 + 逐件 bake"的件一起合并成单张可蒙皮网格。
const BUILDABLE_SHAPE_OPS = new Set<string>([
  ...listUrdfNativeShapeOps(),
  ...listSubgraphBakeOps(),
  ...listBakeableShapeOps(),
]);

interface BakeResultShape {
  url: string;
  sha256: string;
  vertexCount: number;
  triangleCount: number;
  byteSize: number;
  cacheHit: boolean;
  blobSha256?: string;
  bboxMin?: [number, number, number];
  bboxMax?: [number, number, number];
}
interface ColoredAssemblyPartTextureInput {
  imageBytes: Buffer;
  mime: string;
  repeatU?: number;
  repeatV?: number;
  offsetU?: number;
  offsetV?: number;
  rotation?: number;
}
interface ColoredAssemblyPartInput {
  shapeId: string;
  rgba: [number, number, number, number];
  origin?: [number, number, number];
  rpy?: [number, number, number];
  metalness?: number;
  roughness?: number;
  texture?: ColoredAssemblyPartTextureInput;
}
interface BakerHandle {
  bakeColoredAssembly?(
    parts: readonly ColoredAssemblyPartInput[],
    geometry: Geometry,
  ): Promise<BakeResultShape>;
}
interface CtxLike {
  services?: { baker?: BakerHandle; assetsDir?: string };
}

const DEFAULT_RGBA: [number, number, number, number] = [0.7, 0.7, 0.7, 1];

// g_material 电池默认 metalness=0.05/roughness=0.48（与前端 materials.ts 的 defaultSpec 一致）；
// 这里读不到显式值时不重复兜底，直接不传，交给 glb_export.ts 的同一对默认值负责。
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export async function gBakeObject(
  input: Record<string, unknown>,
  ctx?: CtxLike,
): Promise<Record<string, unknown>> {
  const geom: Geometry = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fail = (error: string): Record<string, unknown> => ({
    filename: '',
    sha256: '',
    vertexCount: 0,
    triangleCount: 0,
    cacheHit: false,
    bbox_min: [],
    bbox_max: [],
    size: [],
    geometry: geom,
    note: '',
    error,
  });

  const byId = new Map<string, Statement>(geom.statements.map((s) => [s.id, s]));
  const partStmts = geom.statements.filter((s) => s.op === 'part');
  if (partStmts.length === 0) {
    return fail('no part() statements in geometry; build the object as multiple g_part links (each wrapping a REAL shape + a g_material) in one graph, then g_bake_object');
  }

  const parts: ColoredAssemblyPartInput[] = [];
  for (const p of partStmts) {
    const shapeRef = p.args.shape;
    if (!shapeRef || shapeRef.kind !== 'ref') {
      return fail(`part "${p.id}" is missing a shape ref`);
    }
    const shapeStmt = byId.get(shapeRef.name);
    if (!shapeStmt) {
      return fail(`part "${p.id}" references unknown shape "${shapeRef.name}"`);
    }
    // mesh part（预烘 <sha>.obj 引用）交给 baker 回读合并；其余必须是可烘的真形状。
    if (shapeStmt.op !== 'mesh' && !BUILDABLE_SHAPE_OPS.has(shapeStmt.op)) {
      return fail(`part "${p.id}" shape op "${shapeStmt.op}" is not bakeable into a colored object (expected a primitive / CSG / Parts / composite shape, or a g_mesh reference to a pre-baked <sha>.obj)`);
    }
    const rgba = resolveRgba(p.args.material, byId);
    const extras = resolveMaterialExtras(p.args.material, byId);
    const origin = readNumList(p.args.origin, 3) as [number, number, number] | undefined;
    const rpy = readNumList(p.args.rpy, 3) as [number, number, number] | undefined;

    let texture: ColoredAssemblyPartTextureInput | undefined;
    if (extras.textureId) {
      const resolved = resolveTexture(extras.textureId, byId, ctx?.services?.assetsDir);
      if (resolved.error) {
        return fail(`part "${p.id}" material texture: ${resolved.error}`);
      }
      texture = resolved.texture;
    }

    parts.push({
      shapeId: shapeRef.name,
      rgba,
      ...(origin ? { origin } : {}),
      ...(rpy ? { rpy } : {}),
      ...(extras.metalness !== undefined ? { metalness: extras.metalness } : {}),
      ...(extras.roughness !== undefined ? { roughness: extras.roughness } : {}),
      ...(texture ? { texture } : {}),
    });
  }

  const baker = ctx?.services?.baker;
  if (!baker?.bakeColoredAssembly) {
    return fail('baker.bakeColoredAssembly is unavailable on ctx.services.baker; cannot bake colored object');
  }

  try {
    const res = await baker.bakeColoredAssembly(parts, geom);
    const bboxMin = res.bboxMin ?? null;
    const bboxMax = res.bboxMax ?? null;
    const size = bboxMin && bboxMax
      ? [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]] as [number, number, number]
      : null;
    const round3 = (v: readonly number[]): number[] => v.map((n) => Math.round(n * 1e6) / 1e6);
    const sizeNote = size
      ? `; size≈[${round3(size).join(', ')}] m`
      : '';
    return {
      filename: res.url,
      sha256: res.sha256,
      vertexCount: res.vertexCount,
      triangleCount: res.triangleCount,
      cacheHit: res.cacheHit,
      bbox_min: bboxMin ? round3(bboxMin) : [],
      bbox_max: bboxMax ? round3(bboxMax) : [],
      size: size ? round3(size) : [],
      geometry: geom,
      note: `baked colored object (${parts.length} part${parts.length === 1 ? '' : 's'}) → ${res.url}${res.cacheHit ? ' (cache hit)' : ''}${sizeNote}. Reference via g_mesh(filename=<sha>.glb) WITHOUT a link material so the embedded per-part colors show.`,
      error: '',
    };
  } catch (e) {
    return fail(`colored object bake failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 解析 part.material(ref) → 该 material 语句的 rgba；缺省 / 非法回退到灰。 */
function resolveRgba(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): [number, number, number, number] {
  if (!materialArg || materialArg.kind !== 'ref') return DEFAULT_RGBA;
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return DEFAULT_RGBA;
  const rgba = readNumList(mat.args.rgba, 4);
  if (!rgba) return DEFAULT_RGBA;
  return [
    clamp01(rgba[0]),
    clamp01(rgba[1]),
    clamp01(rgba[2]),
    clamp01(rgba[3]),
  ];
}

/** 解析 part.material(ref) → 该 material 语句的 metalness/roughness/texture(ref→id)。 */
function resolveMaterialExtras(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): { metalness?: number; roughness?: number; textureId?: string } {
  if (!materialArg || materialArg.kind !== 'ref') return {};
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return {};
  const metalness = readNumber(mat.args.metalness);
  const roughness = readNumber(mat.args.roughness);
  const textureArg = mat.args.texture;
  const textureId = textureArg && textureArg.kind === 'ref' ? textureArg.name : undefined;
  return {
    ...(metalness !== undefined ? { metalness: clamp01(metalness) } : {}),
    ...(roughness !== undefined ? { roughness: clamp01(roughness) } : {}),
    ...(textureId ? { textureId } : {}),
  };
}

/**
 * 解析 texture(ref) → 读出 image 路径（相对工程 assets/textures/），从磁盘读字节 +
 * 按扩展名猜 MIME，附带 repeat/offset/rotation。assetsDir 缺失或文件读不到都是错误
 * （贴图电池已明确约定这个落点，读不到大概率是用户忘了把文件放进去）。
 */
function resolveTexture(
  textureId: string,
  byId: ReadonlyMap<string, Statement>,
  assetsDir: string | undefined,
): { texture?: ColoredAssemblyPartTextureInput; error?: string } {
  const tex = byId.get(textureId);
  if (!tex) return { error: `texture "${textureId}" not found in geometry` };
  if (tex.op !== 'texture') return { error: `"${textureId}" is not a texture() statement (op="${tex.op}")` };

  const image = readString(tex.args.image);
  if (!image) return { error: `texture "${textureId}" is missing required "image"` };
  if (!assetsDir) {
    return { error: 'ctx.services.assetsDir is unavailable; cannot resolve texture image path' };
  }

  // image 约定是相对 assets/textures/ 的路径；拒绝逃出该目录（.. 穿越）。
  const rel = normalize(join('textures', image));
  if (isAbsolute(image) || rel.startsWith('..')) {
    return { error: `texture "${textureId}" image path "${image}" must be relative to assets/textures/ (no absolute paths or "..")` };
  }
  const abs = join(assetsDir, rel);

  let imageBytes: Buffer;
  try {
    imageBytes = readFileSync(abs);
  } catch (e) {
    return { error: `texture "${textureId}" failed to read image "${rel}" under assetsDir: ${e instanceof Error ? e.message : String(e)}` };
  }

  const dot = image.lastIndexOf('.');
  const ext = dot >= 0 ? image.slice(dot).toLowerCase() : '';
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    return { error: `texture "${textureId}" image "${image}" has unsupported extension "${ext}" (expected one of: ${Object.keys(MIME_BY_EXT).join(', ')})` };
  }

  const repeat = readNumList(tex.args.repeat, 2);
  const offset = readNumList(tex.args.offset, 2);
  const rotation = readNumber(tex.args.rotation);

  return {
    texture: {
      imageBytes,
      mime,
      ...(repeat ? { repeatU: repeat[0], repeatV: repeat[1] } : {}),
      ...(offset ? { offsetU: offset[0], offsetV: offset[1] } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
    },
  };
}

function readString(a: Arg | undefined): string | undefined {
  return a && a.kind === 'string' ? a.value : undefined;
}

function readNumber(a: Arg | undefined): number | undefined {
  return a && a.kind === 'number' ? a.value : undefined;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function readNumList(a: Arg | undefined, n?: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  if (n !== undefined && out.length !== n) return undefined;
  return out;
}

export default gBakeObject;
