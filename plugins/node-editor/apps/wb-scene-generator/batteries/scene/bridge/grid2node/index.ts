/**
 * grid2node — 由 2D grid 构造一个携带体素的独立场景节点，返回单节点 scene。
 *
 * 不接受 scene 输入；输出树形如 emptyTree → upsertCells("/<name>", { schema, cells })，focus 指向 /<name>。
 * 多个 grid2node 输出再经 add_child 挂到父节点下，即可构成完整 scene 树；该节点本身既可当父也可当子。
 *
 * autoIterate 下，name / grid 的列表会被分别迭代，每轮产出一个独立 ScenePortValue；
 * scene 输出无同名 scene 输入，dispatcher 把每轮 scene 收成 list（rank 1）——可直接喂 add_child.nodes。
 */

import {
  emptyTree,
  makeScenePort,
  upsertCells,
  type ScenePortValue,
  type VoxelCell,
} from '../../../../vendor/dist/shared/types/index.js';

interface Grid2NodeResult {
  scene?: ScenePortValue;
  voxelCount: number;
  error?: string;
}

export function grid2Node(input: Record<string, unknown>): Grid2NodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!rawName) return { voxelCount: 0, error: 'name is required' };
  if (rawName.includes('/')) return { voxelCount: 0, error: "name must not contain '/'" };

  const grid = input.grid;
  if (!Array.isArray(grid) || grid.length === 0) {
    return { voxelCount: 0, error: 'grid is required and non-empty' };
  }

  const schema = typeof input.schema === 'string' && input.schema.trim()
    ? input.schema.trim()
    : 'voxel-mass';
  const token = typeof input.token === 'string' && input.token
    ? input.token
    : 'cell';
  const rawZRange = Array.isArray(input.zRange) ? input.zRange : [input.zRange ?? 0];
  const zRange: number[] = rawZRange
    .map((v: unknown) => Number(v))
    .filter((v: number) => Number.isFinite(v));
  if (zRange.length === 0) {
    return { voxelCount: 0, error: 'zRange must contain at least one finite number' };
  }

  const cells: VoxelCell[] = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < row.length; x++) {
      const v = row[x];
      if (typeof v === 'number' && v !== 0) {
        for (const z of zRange) {
          cells.push({ x, y, z, token });
        }
      }
    }
  }

  // bounds 来自输入 grid 的尺寸；即使该 grid 内部没有非零 cell，下游仍能知道画布大小。
  const height = grid.length;
  const width = Array.isArray(grid[0]) ? (grid[0] as unknown[]).length : 0;

  const path = `/${rawName}`;
  let nextTree;
  try {
    nextTree = upsertCells(emptyTree(), path, { schema, cells, bounds: { width, height } }, 1);
  } catch (err) {
    return { voxelCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
  return {
    scene: makeScenePort(nextTree, path),
    voxelCount: cells.length,
  };
}
