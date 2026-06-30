/**
 * 多材质 GLB (glTF 2.0 binary) 写出器 —— 把"按颜色分组的三角网格"打成单个 .glb。
 *
 * 为什么要这个：
 *   普通 `g_bake_part` 烘的是**纯几何 OBJ**（不带颜色），一个物体烘成一个 mesh 在
 *   场景里就只能上一种 link material。要让"一个物体单元"自带多种颜色整体复用，
 *   就需要一个**自带内嵌材质**的容器。GLB 是最自然的选择：viewer 的 GLTFLoader
 *   原生认内嵌材质，只要 g_to_urdf 对这种 mesh 不再覆盖 link material，颜色就透得出来。
 *
 * 设计：
 *   - 一个 mesh、N 个 primitive，每个 primitive = 一组同色三角面 + 一个 material。
 *   - 相同 rgba 的组共用同一个 material（去重，控制 material 数量）。
 *   - 只写 POSITION + indices，**不写 normal**：与 OBJ 路径一致，前端
 *     `applyLoadedMeshPresentation` 在缺 normal 时会 `computeVertexNormals()`。
 *     省字节、产物稳定。
 *   - material 用 pbrMetallicRoughness.baseColorFactor=[r,g,b,a]；alpha<1 时
 *     标 alphaMode="BLEND"。metallic=0 / roughness=0.7 给 low-poly 漫反射观感。
 *   - 二进制布局：BIN chunk 里按组依次放 [positions(float32) | indices(uint32)]，
 *     各自 4 字节对齐（float32/uint32 天然 4 对齐）。
 */

export interface ColoredMeshGroup {
  /** flat [x,y,z,x,y,z,...]（已烘入世界/物体局部位姿） */
  readonly positions: ArrayLike<number>;
  /** flat [i0,i1,i2,...]，0-based 顶点索引 */
  readonly indices: ArrayLike<number>;
  /** [r,g,b,a]，0..1 */
  readonly rgba: readonly [number, number, number, number];
}

export interface GlbExportResult {
  bytes: Buffer;
  vertexCount: number;
  triangleCount: number;
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const CT_FLOAT = 5126;
const CT_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

function rgbaKey(c: readonly [number, number, number, number]): string {
  return c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000).join(',');
}

export function groupsToGlb(groups: readonly ColoredMeshGroup[]): GlbExportResult {
  // ── 去重 material（按 rgba） ──────────────────────────────────────────
  const materials: Array<{ pbrMetallicRoughness: Record<string, unknown>; alphaMode?: string }> = [];
  const matIndexByKey = new Map<string, number>();
  const materialIndexForGroup: number[] = [];
  for (const g of groups) {
    const key = rgbaKey(g.rgba);
    let idx = matIndexByKey.get(key);
    if (idx === undefined) {
      const [r, gg, b, a] = g.rgba.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number, number];
      const mat: { pbrMetallicRoughness: Record<string, unknown>; alphaMode?: string } = {
        pbrMetallicRoughness: { baseColorFactor: [r, gg, b, a], metallicFactor: 0, roughnessFactor: 0.7 },
      };
      if (a < 0.999) mat.alphaMode = 'BLEND';
      idx = materials.length;
      materials.push(mat);
      matIndexByKey.set(key, idx);
    }
    materialIndexForGroup.push(idx);
  }

  // ── 累积 BIN + accessors/bufferViews/primitives ──────────────────────
  const binChunks: Buffer[] = [];
  let binOffset = 0;
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const primitives: Array<Record<string, unknown>> = [];

  const gMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const gMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  let totalVerts = 0;
  let totalTris = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const vcount = group.positions.length / 3;
    const icount = group.indices.length;
    if (vcount === 0 || icount === 0) continue;

    // positions（float32）+ 局部 min/max
    const pos = new Float32Array(group.positions.length);
    const localMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const localMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < group.positions.length; i++) {
      const v = group.positions[i];
      pos[i] = v;
      const axis = i % 3;
      if (v < localMin[axis]) localMin[axis] = v;
      if (v > localMax[axis]) localMax[axis] = v;
    }
    seen = true;
    for (let a = 0; a < 3; a++) {
      if (localMin[a] < gMin[a]) gMin[a] = localMin[a];
      if (localMax[a] > gMax[a]) gMax[a] = localMax[a];
    }

    const posBuf = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
    const posView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: posBuf.length, target: TARGET_ARRAY_BUFFER });
    binChunks.push(posBuf);
    binOffset += posBuf.length; // float32 → 已 4 对齐

    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: CT_FLOAT,
      count: vcount,
      type: 'VEC3',
      min: localMin,
      max: localMax,
    });

    // indices（uint32）
    const idx = new Uint32Array(icount);
    for (let i = 0; i < icount; i++) idx[i] = group.indices[i];
    const idxBuf = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
    const idxView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binOffset, byteLength: idxBuf.length, target: TARGET_ELEMENT_ARRAY_BUFFER });
    binChunks.push(idxBuf);
    binOffset += idxBuf.length; // uint32 → 已 4 对齐

    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxView, componentType: CT_UINT, count: icount, type: 'SCALAR' });

    primitives.push({ attributes: { POSITION: posAcc }, indices: idxAcc, material: materialIndexForGroup[gi] });
    totalVerts += vcount;
    totalTris += icount / 3;
  }

  const binBody = Buffer.concat(binChunks);

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'forgeax-wb-scene baker (colored GLB)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBody.length }],
  };

  const bytes = assembleGlb(gltf, binBody);
  return {
    bytes,
    vertexCount: totalVerts,
    triangleCount: totalTris,
    bboxMin: seen ? gMin : null,
    bboxMax: seen ? gMax : null,
  };
}

/** 把 glTF JSON + BIN body 打成最终 .glb（含 12 字节 header + 两个 chunk，各 4 对齐）。 */
function assembleGlb(gltf: Record<string, unknown>, binBody: Buffer): Buffer {
  const jsonStr = JSON.stringify(gltf);
  let jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]); // 空格填充

  const binPad = (4 - (binBody.length % 4)) % 4;
  const binBuf = binPad > 0 ? Buffer.concat([binBody, Buffer.alloc(binPad, 0x00)]) : binBody;

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}
