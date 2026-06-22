/**
 * voxel_slice — 在指定 z 高度对体素列表切片，输出与基准 grid 同形状的 0/1 grid。
 *
 * 输入：
 *   - voxels : Point3D[]（rank=1，整组消费；通常来自 node_explode.voxels）
 *   - grid   : number[][] —— 基准 grid，仅用于决定输出形状（值不参与计算）
 *   - z      : number，默认 0；切片高度
 *
 * 输出：
 *   - slice    : number[][]，形状同 grid；voxel.z === z 且 (x,y) 落在 grid 范围内 → 1，否则 0
 *   - hitCount : 切片中被置 1 的格子数
 *
 * autoIterate：
 *   - voxels 为 rank=1 端口，整组喂入，不参与 dispatcher 拆分；
 *   - grid / z 在调用方提供列表时由 dispatcher 标准 zip+merge 迭代，输出 slice 列表（rank=1）。
 *     例如给定 z=[0,1,2] → 三层 slice grids，可后续打包动画或重新塞进 grid2node 重建多层 scene。
 */

import { isPoint3D } from '../../../../vendor/dist/shared/types/index.js';

interface VoxelSliceResult {
  slice: number[][];
  hitCount: number;
  error?: string;
}

function computeShape(grid: unknown[]): { rows: number; cols: number } | string {
  if (grid.length === 0) return 'grid is required and non-empty';
  const firstRow = grid[0];
  if (!Array.isArray(firstRow)) return 'grid must be a 2D array (number[][])';
  const cols = firstRow.length;
  if (cols === 0) return 'grid rows must be non-empty';
  // 校验所有行长一致；不要求严格 number 元素，只用形状
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== cols) {
      return `grid rows must have uniform length (row ${r} differs)`;
    }
  }
  return { rows: grid.length, cols };
}

function makeZeroGrid(rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows);
  for (let y = 0; y < rows; y++) {
    out[y] = new Array(cols).fill(0);
  }
  return out;
}

export function voxelSlice(input: Record<string, unknown>): VoxelSliceResult {
  const grid = input.grid;
  if (!Array.isArray(grid)) {
    return { slice: [], hitCount: 0, error: 'grid is required (number[][])' };
  }
  const shape = computeShape(grid);
  if (typeof shape === 'string') {
    return { slice: [], hitCount: 0, error: shape };
  }

  const z = Number(input.z ?? 0);
  if (!Number.isFinite(z)) {
    return { slice: [], hitCount: 0, error: 'z must be a finite number' };
  }

  const voxels = input.voxels;
  if (!Array.isArray(voxels)) {
    return { slice: [], hitCount: 0, error: 'voxels is required (Point3D[])' };
  }

  const out = makeZeroGrid(shape.rows, shape.cols);
  let hitCount = 0;

  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    if (!isPoint3D(v)) {
      return { slice: [], hitCount: 0, error: `voxels[${i}] is not a valid Point3D` };
    }
    if (v.z !== z) continue;
    // 体素 (x,y) 通常为整数索引；保险起见用 Math.round 对齐到 grid 索引空间
    const ix = Math.round(v.x);
    const iy = Math.round(v.y);
    if (ix < 0 || ix >= shape.cols || iy < 0 || iy >= shape.rows) continue;
    if (out[iy]![ix] === 0) {
      out[iy]![ix] = 1;
      hitCount += 1;
    }
  }

  return { slice: out, hitCount };
}
