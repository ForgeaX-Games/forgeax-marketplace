/**
 * add_child — 把一组独立 scene 节点挂到 parent.focus 之下，作为兄弟子节点。
 *
 * 输入：
 *   - scene  : 父 scene（focus 指向父节点；focus 必须落在已存在节点上）
 *   - nodes  : scene 列表（rank=1）；每个元素是一棵单节点 scene（如 grid2node 的输出）
 *              子节点名取该节点自身的 name 字段；相同 name 之间 / 与 parent 已有同名子节点
 *              均会触发显式冲突错误。
 *
 * 输出：
 *   - scene       : 新 graph（focus 保持父节点 id，便于下游再 add_child / 转 transform）
 *   - childPaths  : 实际挂入的子节点绝对路径列表（与 nodes 输入一一对应；便于下游
 *                   scene_focus_path 直接定位某个子节点继续展开）
 *
 * 实现要点：
 *   - graftSubtree 只重写 parent 与新子树本身（O(子树大小)），不重建任何无关祖先/兄弟——
 *     不是旧 tree.ts 的 graftAt 那种"重写整条祖先 spine"路径拷贝。
 *   - order 接着 parent 现有子节点的最大值往后排，使多个 nodes[] 元素之间保持
 *     "输入数组顺序 = 兄弟展示顺序"（同 graph.ts addChildren 的理由）。
 *   - 任一元素失败立即返回 error，不留半成品（graph 是局部变量）。
 */

import {
  getNode,
  graftSubtree,
  makeScenePort,
  parseScenePort,
  pathOf,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface AddChildResult {
  scene?: ScenePortValue;
  childPaths?: string[];
  error?: string;
}

export function addChild(input: Record<string, unknown>): AddChildResult {
  const parent = parseScenePort(input.scene);
  if (!parent) return { error: 'scene (parent) is required and must be a ScenePortValue' };

  const parentNode = getNode(parent.graph, parent.focus);
  if (parentNode === null) {
    return { error: `parent path not found: "${parent.focus}"` };
  }

  const rawNodes = input.nodes;
  if (!Array.isArray(rawNodes)) {
    return { error: 'nodes must be a list of scene values (rank=1)' };
  }
  if (rawNodes.length === 0) {
    return { scene: makeScenePort(parent.graph, parent.focus), childPaths: [] };
  }

  let graph = parent.graph;
  let nextOrder = 0;
  for (const existingId of parentNode.children.values()) {
    const existing = graph.get(existingId);
    if (existing && existing.order >= nextOrder) nextOrder = existing.order + 1;
  }

  const seenNames = new Set<string>();
  const childPaths: string[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const sn = parseScenePort(rawNodes[i]);
    if (!sn) return { error: `nodes[${i}] is not a valid ScenePortValue` };

    const subtree = getNode(sn.graph, sn.focus);
    if (subtree === null) {
      return { error: `nodes[${i}] focus "${sn.focus}" does not exist in its graph` };
    }
    const name = subtree.name;
    if (!name) return { error: `nodes[${i}] focus is that source's own root; cannot graft the root itself` };
    if (seenNames.has(name)) {
      return { error: `nodes contain duplicate basename "${name}" (index ${i})` };
    }
    seenNames.add(name);

    try {
      const result = graftSubtree(graph, parent.focus, name, sn.graph, sn.focus, { order: nextOrder++ });
      graph = result.graph;
      childPaths.push(pathOf(graph, result.id) ?? `/${name}`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { scene: makeScenePort(graph, parent.focus), childPaths };
}
