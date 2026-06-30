/**
 * townIslandLayout: 城镇岛状布局生成器
 *
 * 输入：
 *   inputGrid         (array)   — 源掩码网格或网格列表
 *   roadWidth         (number)  — 道路宽度，默认 1
 *   blockMinSize      (number)  — BSP块最小边长，控制路网与地块密度，默认 3
 *   shapeType         (string)  — 岛型形状：circle / ellipse / organic，默认 ellipse
 *   shapeScale        (number)  — 岛型面积占bbox面积比例（0.2–0.9），默认 0.6
 *   coverageThreshold (number)  — 地块保留覆盖率阈值（0–1），默认 0.6
 *   seed              (number)  — 随机种子（0 = 当前时间戳）
 *   merge             (boolean) — 默认 true：叠加所有输入为2张01网格（道路+地块）
 *
 * 输出：
 *   outputGridList (array) — 合并模式：[道路(id=1), 地块(id=2)]，2张01单值网格
 *                            非合并模式：[道路, 地块_pid1, 地块_pid2, ...]，每地块独立网格
 *   outputNameList (array) — 合并模式：[{id:1,name:'道路'},{id:2,name:'地块'}]
 *                            非合并模式：[{id:1,name:'道路'}, {id:pid,...}, ...]，与网格一一对应
 */

import { generateTownIsland, type TownIslandOptions } from "./generator";

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

function mergeToSingleValue(grids: number[][][], id: number): number[][] {
  if (grids.length === 0) return [];
  const H = Math.max(...grids.map(g => g.length));
  const W = Math.max(...grids.map(g => g[0]?.length ?? 0));
  const out: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
  for (const g of grids) {
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] !== 0) out[r][c] = id;
      }
    }
  }
  return out;
}

export function townIslandLayout(input: Record<string, unknown>): Record<string, unknown> {
  const grids = parseInputGrids(input.inputGrid);
  if (!grids) {
    return { error: "inputGrid is required", outputGridList: [], outputNameList: [] };
  }

  const baseSeed = typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const doMerge  = input.merge !== false;

  const allRoads:   number[][][] = [];
  const allParcels: number[][][] = [];
  const allNameLists: { id: number; name: string; type: string }[][] = [];

  for (let i = 0; i < grids.length; i++) {
    const inputGrid = grids[i];
    if (!Array.isArray(inputGrid) || inputGrid.length === 0) continue;

    const opts: TownIslandOptions = {
      roadWidth:         clampInt(input.roadWidth,           1, 10,  1),
      blockMinSize:      clampInt(input.blockMinSize,        2, 200, 3),
      shapeType:         pickOption(input.shapeType, ["circle", "ellipse", "organic"], "ellipse"),
      shapeScale:        clampFloat(input.shapeScale,        0.2, 0.9, 0.6),
      coverageThreshold: clampFloat(input.coverageThreshold, 0,   1,   0.6),
      seed:              baseSeed === 0 ? 0 : baseSeed + i * 1000003,
    };

    const { road, parcels, nameList } = generateTownIsland(inputGrid, opts);
    allRoads.push(road);
    allParcels.push(parcels);
    allNameLists.push(nameList);
  }

  // ── 合并模式：道路叠一张(id=1)，地块叠一张(id=2)，固定2条名称清单 ──────────
  if (doMerge) {
    return {
      outputGridList: [
        mergeToSingleValue(allRoads,   1),
        mergeToSingleValue(allParcels, 2),
      ],
      outputNameList: [
        { id: 1, name: "道路", type: "tile" },
        { id: 2, name: "地块", type: "tile" },
      ],
    };
  }

  // ── 非合并模式：地块按 pid 炸开，每个地块一张独立单值网格 ────────────────────
  // 输出顺序：[道路, 地块_pid1, 地块_pid2, ..., 道路, ...]（多输入时按输入顺序追加）
  // 名称清单：[{id:1,name:'道路'}, {id:pid1,...}, {id:pid2,...}, ...]
  const outputGridList: number[][][] = [];
  const outputNameList: { id: number; name: string; type: string }[] = [];

  for (let i = 0; i < allRoads.length; i++) {
    const road    = allRoads[i];
    const parcels = allParcels[i];
    const nameList = allNameLists[i];

    const rows = road.length;
    const cols = road[0]?.length ?? 0;

    // 道路：格子值写 1，名称清单 id=1
    const roadGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (road[r][c] !== 0) roadGrid[r][c] = 1;
      }
    }
    outputGridList.push(roadGrid);
    if (!outputNameList.some(e => e.id === 1)) {
      outputNameList.push({ id: 1, name: "道路", type: "tile" });
    }

    // 每个地块独立拆成一张网格，格子值 = pid，名称清单一一对应
    for (const entry of nameList) {
      const pid = entry.id;
      const parcelGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (parcels[r][c] === pid) parcelGrid[r][c] = pid;
        }
      }
      outputGridList.push(parcelGrid);
      outputNameList.push(entry);
    }
  }

  return { outputGridList, outputNameList };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function pickOption(value: unknown, options: string[], fallback: string): string {
  if (typeof value === "string" && options.includes(value)) return value;
  return fallback;
}
