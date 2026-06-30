/**
 * Shape3D → OBJ ASCII bytes。
 *
 * 流程：
 *   1) shape.mesh({ tolerance, angularTolerance }) —— replicad 内部调
 *      BRepMesh_IncrementalMesh，把 OCCT NURBS / BRep 表面三角化
 *   2) 把 flat number[] (xyz 拼一起) 重新拆成 v / f 行
 *   3) 用 \n 拼接成完整字符串，UTF-8 编码成 Buffer
 *
 * 为什么是 ASCII OBJ 而不是 binary STL？
 *   - viewer 端 OBJLoader 是 three.js 内置零依赖，与 articraft 现有视觉一致
 *   - ASCII 体积大，但 baker.service 算 sha256 时拿到 stable 字节流方便去重
 *   - 同形状不同浮点表达不会产生重复 blob（toFixed(6) 截断后稳定）
 *
 * 没写 vertex normal / 不写 vt：
 *   - URDF 用途下 normal 在前端按面重算就行（geometry-loader 已经 computeVertexNormals）
 *   - 没贴图，也不需要 vt
 *   - 这样 OBJ 字节最小，cache hit 概率最大
 */

import type { BakeableShape, MeshGeometry, TessellationOptions } from './types.js';

export interface ObjExportResult {
  bytes: Buffer;
  vertexCount: number;
  triangleCount: number;
  /** baked mesh 的局部 AABB 最小角（米）；无顶点时为 null。 */
  bboxMin: [number, number, number] | null;
  /** baked mesh 的局部 AABB 最大角（米）；无顶点时为 null。 */
  bboxMax: [number, number, number] | null;
}

/** 单个 replicad 形状三角化后的裸数组（flat positions + flat indices）。 */
export interface RawMesh {
  /** flat [x,y,z,x,y,z,...] */
  vertices: number[];
  /** flat [i0,i1,i2,...]，0-based */
  triangles: number[];
}

/**
 * 把一个 replicad 形状按当前 tessellation 三角化成裸数组。
 *
 * 与 `shapeToObj` 共用同一套弦距/角度容差（含 low-poly 相对容差逻辑），保证
 * OBJ 烘焙与多材质 GLB 烘焙的面数表现一致。读完三角面后显式 delete WASM 句柄。
 */
export function meshShape(shape: BakeableShape, tess: TessellationOptions): RawMesh {
  const mesh = shape.mesh({
    tolerance: effectiveLinearDeflection(shape, tess),
    angularTolerance: tess.angularDeflection,
  });
  try {
    return {
      vertices: Array.from(mesh.vertices as ArrayLike<number>),
      triangles: Array.from(mesh.triangles as ArrayLike<number>),
    };
  } finally {
    try { (mesh as unknown as { delete?: () => void }).delete?.(); } catch { /* 已回收 */ }
  }
}

export function shapeToObj(
  shape: BakeableShape | MeshGeometry,
  tess: TessellationOptions,
): ObjExportResult {
  if (isMeshGeometry(shape)) return meshToObj(shape);

  const { vertices, triangles } = meshShape(shape, tess);

  {
    const vertexCount = vertices.length / 3;
    const triangleCount = triangles.length / 3;

    // 预估字节体积：每 v 行约 30 字符、每 f 行约 18 字符，外加 header 和换行
    const estimated = 32 + vertexCount * 32 + triangleCount * 20;
    const parts: string[] = ['# baked by forgeax-wb-scene baker (replicad + OCCT WASM)\n'];

    const bbox = newBboxAccumulator();
    for (let i = 0; i < vertices.length; i += 3) {
      accumulateBbox(bbox, vertices[i], vertices[i + 1], vertices[i + 2]);
      parts.push(`v ${fmt(vertices[i])} ${fmt(vertices[i + 1])} ${fmt(vertices[i + 2])}\n`);
    }
    // OBJ 索引 1-based
    for (let i = 0; i < triangles.length; i += 3) {
      parts.push(`f ${triangles[i] + 1} ${triangles[i + 1] + 1} ${triangles[i + 2] + 1}\n`);
    }

    const objStr = parts.join('');
    void estimated;
    return {
      bytes: Buffer.from(objStr, 'utf-8'),
      vertexCount,
      triangleCount,
      ...finalizeBbox(bbox),
    };
  }
}

function meshToObj(mesh: MeshGeometry): ObjExportResult {
  const parts: string[] = ['# baked by forgeax-wb-scene baker (mesh geometry)\n'];
  const bbox = newBboxAccumulator();
  for (const v of mesh.vertices) {
    accumulateBbox(bbox, v[0], v[1], v[2]);
    parts.push(`v ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}\n`);
  }
  for (const f of mesh.faces) {
    parts.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}\n`);
  }
  return {
    bytes: Buffer.from(parts.join(''), 'utf-8'),
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.faces.length,
    ...finalizeBbox(bbox),
  };
}

// ── AABB 累加器：边导出顶点边求 min/max，无额外遍历开销。 ──────────────
interface BboxAccumulator {
  min: [number, number, number];
  max: [number, number, number];
  seen: boolean;
}

function newBboxAccumulator(): BboxAccumulator {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    seen: false,
  };
}

function accumulateBbox(acc: BboxAccumulator, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  acc.seen = true;
  if (x < acc.min[0]) acc.min[0] = x;
  if (y < acc.min[1]) acc.min[1] = y;
  if (z < acc.min[2]) acc.min[2] = z;
  if (x > acc.max[0]) acc.max[0] = x;
  if (y > acc.max[1]) acc.max[1] = y;
  if (z > acc.max[2]) acc.max[2] = z;
}

function finalizeBbox(acc: BboxAccumulator): {
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
} {
  if (!acc.seen) return { bboxMin: null, bboxMax: null };
  return { bboxMin: acc.min, bboxMax: acc.max };
}

function isMeshGeometry(shape: BakeableShape | MeshGeometry): shape is MeshGeometry {
  return (shape as MeshGeometry).kind === 'mesh_geometry';
}

/**
 * 计算有效弦距（线性容差）：
 *   - relativeDeflection<=0 或拿不到包围盒 → 直接用绝对 linearDeflection
 *   - 否则 = clamp(relativeDeflection × bbox 对角线, min, max)
 * bbox 用完即 delete，避免 OCCT WASM 堆泄漏。
 */
function effectiveLinearDeflection(shape: BakeableShape, tess: TessellationOptions): number {
  const rel = tess.relativeDeflection ?? 0;
  if (!(rel > 0)) return tess.linearDeflection;

  let diagonal = 0;
  let bbox: { width: number; height: number; depth: number; delete?: () => void } | undefined;
  try {
    bbox = (shape as unknown as { boundingBox: typeof bbox }).boundingBox;
    if (bbox) {
      const w = bbox.width ?? 0;
      const h = bbox.height ?? 0;
      const d = bbox.depth ?? 0;
      diagonal = Math.sqrt(w * w + h * h + d * d);
    }
  } catch {
    diagonal = 0;
  } finally {
    try { bbox?.delete?.(); } catch { /* noop */ }
  }

  if (!(diagonal > 0)) return tess.linearDeflection;

  const lo = tess.minLinearDeflection ?? tess.linearDeflection;
  const hi = tess.maxLinearDeflection ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(rel * diagonal, lo), hi);
}

/**
 * 数值格式化：整数原样，浮点 6 位定点去尾零。
 *
 * 选定点而非指数表示：
 *   - OBJLoader 对指数和定点都支持，但定点的字符序列更稳定
 *     （0.05 永远写成 "0.05"，而不是会因平台不同变成 "5e-2"）
 *   - 这让相同输入永远产出 byte-identical 的 OBJ，library blob 内容寻址才能正确去重
 */
function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // toFixed(6) 截断到 6 位小数，再去尾随的 .0+ 或纯尾零
  return n.toFixed(6).replace(/\.?0+$/, '');
}
