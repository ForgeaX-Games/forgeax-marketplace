/**
 * Scene → Voxel 图层投影：把持久化 scene graph 的 focus 子树展平为渲染器消费的
 * 体素图层列表。
 *
 * 这是重构范围里唯一必须改、但改完之后能把改动面彻底隔离住的文件（见重构规格
 * 「消费端迁移清单」页「核心结论」）：输出的 VoxelLayer[] / NameListEntry[] 形状
 * 字节级不变（cells 依然是纯 Point3D[]，在这里用 iterCells 就地物化），所以整条
 * 渲染栈、useNodePreviews、导出 cook、viewer.js 都不需要感知 children 从数组变
 * map、cells 从数组变 Volume 这两件事。
 *
 * v1 简化（沿用旧实现的既有约定，不在本轮变动）：
 *   - 不累积 transform（multi-SceneOutput 共享同一坐标原点，自然叠加）
 *   - 体素仅保留 (x,y,z)，丢弃 token / state（渲染层只用坐标和图层 value 上色）
 *   - 节点级 layer：每个 cellCount(content) > 0 的节点产出一条 layer，value 为 1-based 序号
 */

import type { Point3D } from '../point3d.js';
import type { NodeId, SceneGraph, SceneNode } from './graph.js';
import { childrenOf, getNode, pathOf } from './graph.js';
import { cellCount, iterCells } from './volume.js';

export interface VoxelLayer {
  /** 来自 scene graph 节点的人类可读路径（绝对路径，由 NodeId 现算，不再是节点自带字段）。 */
  nodePath: string;
  /** basename（用于面板显示与 nameList fallback） */
  nodeName: string;
  /** 1-based 序号；与同一 bundle 的 names[i].id 对齐 */
  value: number;
  /** 节点 schema（可选，用作 type fallback） */
  schema?: string;
  cells: Point3D[];
  /**
   * 多值（multi-value-per-layer）子层：当本节点的体素携带 >1 种不同 token 时，
   * 列出按首次出现顺序的去重 token 列表；单一 token 的节点不产出该字段（单值层）。
   * 渲染器据此把该层渲为可折叠父层 + 每 token 一个子层（带子层可见性 Eye）。
   */
  tokens?: string[];
  /**
   * 每个 token 的体素桶（与 tokens 对齐），仅多值层产出。渲染器用它在隐藏某子层时
   * 重算父层的可见 cells（cells 始终是全集，cellsByToken 提供按 token 的拆分）。
   */
  cellsByToken?: Record<string, Point3D[]>;
}

export interface NameListEntry {
  id: number;
  name: string;
  type?: string;
}

export interface VoxelOutputBundle {
  layers: VoxelLayer[];
  names: NameListEntry[];
}

function getStringAttr(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  if (!attributes) return undefined;
  const v = attributes[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function collect(
  graph: SceneGraph,
  node: SceneNode,
  path: string,
  out: VoxelOutputBundle,
  // 复盘(2026-07-01 循环引用死循环事故):纵深防御——graph.ts 的操作原语理论上不会
  // 产生结构环(每个 id 的血统由 hash(parentId,name) 派生,天然是 DAG),但这里不
  // 依赖那份保证。撞到已下探过的 id 直接跳过,把潜在死循环/栈溢出降级成"该重复
  // 子树不重复展平",绝不挂死 backend。
  visited: Set<NodeId> = new Set(),
): void {
  if (visited.has(node.id)) return;
  visited.add(node.id);

  if (node.content && cellCount(node.content) > 0) {
    const value = out.layers.length + 1;
    const nodeName = node.name === '' ? '/' : node.name;
    // Split cells by their voxel `token` so a node carrying multiple distinct
    // tokens becomes a multi-value layer (one sub-layer per token). `cells`
    // stays the full set (back-compat); tokens/cellsByToken are added only when
    // there is genuinely more than one token (>1 ⇒ multi-value-per-layer).
    const cells: Point3D[] = [];
    const cellsByToken: Record<string, Point3D[]> = {};
    const tokens: string[] = [];
    for (const c of iterCells(node.content)) {
      const p: Point3D = { x: c.x, y: c.y, z: c.z };
      cells.push(p);
      const tok = c.token ?? '';
      let bucket = cellsByToken[tok];
      if (!bucket) {
        bucket = [];
        cellsByToken[tok] = bucket;
        tokens.push(tok);
      }
      bucket.push(p);
    }
    const layer: VoxelLayer = {
      nodePath: path,
      nodeName,
      value,
      schema: node.schema,
      cells,
    };
    if (tokens.length > 1) {
      layer.tokens = tokens;
      layer.cellsByToken = cellsByToken;
    }
    out.layers.push(layer);
    // asset_name 缺失时**不再**回退到 nodeName,空串透传给 renderer。
    // 让 UI 能区分「scene 显式声明了 asset_name」与「scene 没设过」两种情况:
    // 前者 → 走 alias 匹配(命中 / 未命中);后者 → "no-field" 状态,UI 灰显。
    // asset_type 仍回退到 schema,语义上 schema 本就是节点类型的语言,作 fallback 合理。
    out.names.push({
      id: value,
      name: getStringAttr(node.attributes, 'asset_name') ?? '',
      type: getStringAttr(node.attributes, 'asset_type') ?? node.schema,
    });
  }

  // 旧实现按 node.version ASC 排序还原"加入顺序"（version 语义模糊：既是修订号
  // 又被顺手挪用当 z-order，是 v2 的已知局限）。新模型用 childrenOf 按
  // (order, id) 排序——order 是「本次 addChildren 调用内的局部序号」，只在
  // 同一次调用内比较才有意义；跨调用/跨分支的 order 冲突用 id 兜底，
  // 全程无任何全局状态参与（见节点独立性审计结论）。
  const path_ = path; // path of current node, used to build child paths below
  for (const child of childrenOf(graph, node.id)) {
    const childPath = path_ === '/' ? `/${child.name}` : `${path_}/${child.name}`;
    collect(graph, child, childPath, out, visited);
  }
}

/**
 * 从 focus 子树展平出 voxel layers + 对齐的 nameList。
 *
 * focus 不存在：返回空 bundle（不抛错）。
 * focus 存在但子树无任何体素：返回空 bundle。
 */
export function projectSceneToVoxelLayers(graph: SceneGraph, focus: NodeId): VoxelOutputBundle {
  const out: VoxelOutputBundle = { layers: [], names: [] };
  const root = getNode(graph, focus);
  if (!root) return out;
  const rootPath = pathOf(graph, focus) ?? '/';
  collect(graph, root, rootPath, out);
  return out;
}
