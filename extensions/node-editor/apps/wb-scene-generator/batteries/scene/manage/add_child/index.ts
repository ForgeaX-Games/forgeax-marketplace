/**
 * add_child — 把一组独立 scene 节点挂到 parent.focus 之下，作为兄弟子节点。
 *
 * 输入：
 *   - scene  : 父 scene（focus 指向父节点；focus 必须落在已存在节点上）
 *   - nodes  : scene 列表（rank=1）；每个元素是一棵单节点 scene（如 grid2node 的输出）
 *              子节点名取 element.focus 的最后一段；相同 basename 之间 / 与 parent 已有同名子节点
 *              均会触发显式冲突错误。
 *
 * 输出：
 *   - scene       : 新树（focus 保持父节点路径，便于下游再 add_child / 转 transform）
 *   - childPaths  : 实际挂入的子节点绝对路径列表（与 nodes 输入一一对应；便于下游
 *                   scene_focus_path 直接定位某个子节点继续展开）
 *
 * 实现要点：
 *   - 多次 graftAt 顺序复用结构共享，零拷贝兄弟子树
 *   - 任一元素失败立即返回 error，不留半成品（tree 是局部变量）
 */

import {
  graftAt,
  makeScenePort,
  parseScenePort,
  readNode,
  splitPath,
  type ScenePortValue,
  type SceneNodeSnapshot,
} from '../../../../vendor/dist/shared/types/index.js';

interface AddChildResult {
  scene?: ScenePortValue;
  childPaths?: string[];
  error?: string;
}

function basename(focus: string): string {
  const segs = splitPath(focus);
  return segs.length === 0 ? '' : segs[segs.length - 1]!;
}

export function addChild(input: Record<string, unknown>): AddChildResult {
  const parent = parseScenePort(input.scene);
  if (!parent) return { error: 'scene (parent) is required and must be a ScenePortValue' };

  const parentNode = readNode(parent.tree, parent.focus);
  if (parentNode === null) {
    return { error: `parent path not found: "${parent.focus}"` };
  }

  const rawNodes = input.nodes;
  if (!Array.isArray(rawNodes)) {
    return { error: 'nodes must be a list of scene values (rank=1)' };
  }
  if (rawNodes.length === 0) {
    return { scene: makeScenePort(parent.tree, parent.focus), childPaths: [] };
  }

  let tree = parent.tree;
  let version = tree.version;

  const seenNames = new Set<string>();
  const childPaths: string[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const sn = parseScenePort(rawNodes[i]);
    if (!sn) return { error: `nodes[${i}] is not a valid ScenePortValue` };

    const name = basename(sn.focus);
    if (!name) return { error: `nodes[${i}] focus is root "/"; cannot graft the root itself` };
    if (seenNames.has(name)) {
      return { error: `nodes contain duplicate basename "${name}" (index ${i})` };
    }
    seenNames.add(name);

    const subtree: SceneNodeSnapshot | null = readNode(sn.tree, sn.focus);
    if (subtree === null) {
      return { error: `nodes[${i}] focus path "${sn.focus}" does not exist in its tree` };
    }

    const destPath = parent.focus === '/' ? `/${name}` : `${parent.focus}/${name}`;
    if (readNode(tree, destPath) !== null) {
      return { error: `child "${name}" already exists under parent "${parent.focus}"` };
    }

    version += 1;
    try {
      tree = graftAt(tree, destPath, subtree, version);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    childPaths.push(destPath);
  }

  return { scene: makeScenePort(tree, parent.focus), childPaths };
}
