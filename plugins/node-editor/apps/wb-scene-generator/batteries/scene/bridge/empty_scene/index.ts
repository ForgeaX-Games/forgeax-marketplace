/**
 * empty_scene — 无输入，输出一个空场景。
 *
 * 构造一棵只含空根节点（children 为空）的 scene DataTree，并包成 scene 端口值。
 * emptyTree() 即 { name:'', path:'/', version:0, children:[] }；focus 指向根 '/'，
 * 便于下游在此根之下挂接子节点。
 */

import {
  emptyTree,
  makeScenePort,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface EmptySceneResult {
  scene: ScenePortValue;
}

export function emptyScene(_input: Record<string, unknown>): EmptySceneResult {
  return { scene: makeScenePort(emptyTree(), '/') };
}
