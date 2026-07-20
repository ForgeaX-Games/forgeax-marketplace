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
// 关键：**不含 `mesh`** —— g_bake_object 需要"真形状"的 part 才能逐 part 三角化；
// 引用已 bake `<sha>.obj` 的 mesh part 无法再细分（也没颜色源），必须报错引导。
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
interface ColoredAssemblyPartInput {
  shapeId: string;
  rgba: [number, number, number, number];
  origin?: [number, number, number];
  rpy?: [number, number, number];
}
interface BakerHandle {
  bakeColoredAssembly?(
    parts: readonly ColoredAssemblyPartInput[],
    geometry: Geometry,
  ): Promise<BakeResultShape>;
}
interface CtxLike {
  services?: { baker?: BakerHandle };
}

const DEFAULT_RGBA: [number, number, number, number] = [0.7, 0.7, 0.7, 1];

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
    if (shapeStmt.op === 'mesh') {
      return fail(
        `part "${p.id}" references an already-baked mesh ("${shapeRef.name}"). ` +
        `g_bake_object needs parts built from REAL shapes (primitives / CSG / Parts / composite), ` +
        `not pre-baked g_mesh refs. Build the object's parts with their actual shape ops + g_material ` +
        `in one graph, then g_bake_object — do NOT pre-bake them to <sha>.obj with g_bake_part first. ` +
        `(For the "pre-bake per part + color at assembly" route, skip g_bake_object and use g_bake_part + per-part g_material instead.)`,
      );
    }
    if (!BUILDABLE_SHAPE_OPS.has(shapeStmt.op)) {
      return fail(`part "${p.id}" shape op "${shapeStmt.op}" is not bakeable into a colored object (expected a primitive / CSG / Parts / composite shape)`);
    }
    const rgba = resolveRgba(p.args.material, byId);
    const origin = readNumList(p.args.origin, 3) as [number, number, number] | undefined;
    const rpy = readNumList(p.args.rpy, 3) as [number, number, number] | undefined;
    parts.push({
      shapeId: shapeRef.name,
      rgba,
      ...(origin ? { origin } : {}),
      ...(rpy ? { rpy } : {}),
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
