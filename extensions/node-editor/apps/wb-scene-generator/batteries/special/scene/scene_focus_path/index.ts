/**
 * scene_focus_path — 显式 refocus，tree 不变，仅改 focus。
 *
 * 输入：scene、path（绝对路径，必须存在于 tree 中）
 * 输出：scene（focus = path）
 *
 * 用途：手动定位某个节点（绕过 focus_children），或在多层 fanout 后把 focus 重置回某个公共祖先。
 */

import {
  parseScenePort,
  readNode,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  scene?: ScenePortValue;
  error?: string;
}

export function sceneFocusPath(input: Record<string, unknown>): Result {
  const port = parseScenePort(input.scene);
  if (!port) return { error: 'scene is required and must be a ScenePortValue' };

  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (!path) return { error: 'path is required and must be a non-empty string' };
  if (!path.startsWith('/')) return { error: `path must start with "/": "${path}"` };

  if (path !== '/' && readNode(port.tree, path) === null) {
    return { error: `path does not exist in tree: "${path}"` };
  }

  return { scene: { tree: port.tree, focus: path } };
}
