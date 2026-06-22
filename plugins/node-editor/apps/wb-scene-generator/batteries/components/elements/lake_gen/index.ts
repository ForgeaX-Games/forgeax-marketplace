/**
 * lakeGen: Generate organic lakes inside a designated area of a mask grid.
 *
 * Inputs:
 *   inputGrid    (grid)    — source mask grid
 *   targetId     (number)  — cell value marking valid placement area
 *   lakeCount    (number)  — how many lakes to generate
 *   lakeSize     (number)  — target size of each lake in cells
 *   sizeVariance (number)  — size randomness factor 0–1 (0 = all same size)
 *   minSpacing   (number)  — minimum gap between any two lakes (cells)
 *   lakeBaseId   (number)  — starting mask ID for lakes (0 = auto: max+1)
 *   seed         (number)  — random seed (0 = current timestamp)
 *   merge        (boolean) — default true: merge all lake grids into one; false: one grid per lake
 *
 * Outputs:
 *   outputGridList (array) — merge mode: [mergedGrid]; non-merge: one grid per lake
 *   outputNameList (array) — merge mode: [{id:1,name:'湖泊',type:'tile'}]; non-merge: one entry per lake
 */

import { generateLakes, type GenerateOptions } from "./generator";

/** 将输入统一解析为 Grid[]，支持单个网格或网格列表 */
function parseInputGrids(raw: unknown): number[][][] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return [raw as number[][]];
  }
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return raw as number[][][];
  }
  return null;
}

export function lakeGen(input: Record<string, unknown>): Record<string, unknown> {
  const grids = parseInputGrids(input.inputGrid);

  if (!grids) {
    return { error: "inputGrid is required", outputGridList: [], outputNameList: [] };
  }

  const baseSeed = typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const doMerge = input.merge !== false;

  const outputGridList: number[][][] = [];
  const outputNameList: { id: number; name: string; type: string }[] = [];

  for (let gi = 0; gi < grids.length; gi++) {
    const inputGrid = grids[gi];
    if (!inputGrid || inputGrid.length === 0 || inputGrid[0].length === 0) continue;

    const opts: GenerateOptions = {
      targetId:     typeof input.targetId     === "number" ? Math.round(input.targetId)                   : 1,
      lakeCount:    typeof input.lakeCount    === "number" ? Math.max(1, Math.round(input.lakeCount))     : 3,
      lakeSize:     typeof input.lakeSize     === "number" ? Math.max(1, Math.round(input.lakeSize))      : 50,
      sizeVariance: typeof input.sizeVariance === "number" ? Math.max(0, Math.min(1, input.sizeVariance)) : 0.3,
      minSpacing:   typeof input.minSpacing   === "number" ? Math.max(0, Math.round(input.minSpacing))    : 3,
      lakeBaseId:   typeof input.lakeBaseId   === "number" ? Math.round(input.lakeBaseId)                 : 0,
      seed:         baseSeed === 0 ? 0 : baseSeed + gi * 1000003,
    };

    const lakes = generateLakes(inputGrid, opts);
    const rows = inputGrid.length;
    const cols = inputGrid[0].length;

    for (const lake of lakes) {
      const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
      for (const [r, c] of lake.cells) grid[r][c] = lake.id;
      outputGridList.push(grid);
      outputNameList.push({ id: lake.id, name: lake.name, type: "tile" });
    }
  }

  if (doMerge && outputGridList.length > 0) {
    const H = Math.max(...outputGridList.map(g => g.length));
    const W = Math.max(...outputGridList.map(g => g[0]?.length ?? 0));
    const merged: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
    for (const g of outputGridList) {
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[r].length; c++) {
          if (g[r][c] !== 0) merged[r][c] = 1;  // 统一写 1，输出单值 01 网格
        }
      }
    }
    return {
      outputGridList: [merged],
      outputNameList: [{ id: 1, name: "湖泊", type: "tile" }],
    };
  }

  return { outputGridList, outputNameList };
}
