/**
 * region_zone_generator — 区域分区生成器
 *
 * 输入基准掩码网格（或网格列表）+ 区域列表（[[名称, 面积权重, 九宫格方位], ...]），
 * 输出不重叠的不规则区域单值网格列表 + 名称清单。
 *
 * 算法流程：
 *   1. 解析输入（baseGrid 支持单网格/网格列表；regions 支持 [[name,area,pos],...] 格式）
 *   2. 按九宫格方位定位种子点
 *   3. 加权 Voronoi + Lloyd 松弛生成初始分区
 *   4. 按所选风格进行边界后处理（organic/smooth/rectilinear/voronoi）
 *   5. 将区域标签映射到输出 ID（从基准网格最大值+1 顺延）
 *   6. 每个区域输出独立单值网格（只含该区域 ID 和 0）
 */

import { RegionDef, collectUsableCells, placeSeedPoints, lloydRelax } from './placement.js';
import { applyBoundaryStyle } from './boundary.js';

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

interface Output {
  outputGridList: Grid[];
  nameList: NameEntry[];
}

/** 简单的 mulberry32 伪随机数生成器 */
function makeMRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 将 baseGrid 输入统一解析为 Grid[]，支持单个网格或网格列表 */
function parseBaseGrids(raw: unknown): Grid[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  // 单个网格：number[][]
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === 'number') {
    return [raw as Grid];
  }
  // 网格列表：number[][][]
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return raw as Grid[];
  }
  return null;
}

/**
 * 将区域列表解析为 RegionDef[]。
 * 支持三种格式：
 *   - 字符串：JSON 字符串，自动解析后继续处理
 *   - 新格式：[[name, area, position], ...]
 *   - 旧格式：[{name, area, position}, ...]（向后兼容）
 */
function parseRegions(raw: unknown): RegionDef[] {
  if (!raw) return [];
  // 字符串格式：尝试 JSON.parse
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    if (Array.isArray(item)) {
      // 新格式：[name, area, position]
      const [name, area, position] = item as [unknown, unknown, unknown];
      return {
        name: typeof name === 'string' ? name : String(name ?? '区域'),
        area: typeof area === 'number' ? area : 1,
        position: typeof position === 'number' ? position : 5,
      };
    }
    // 旧格式：{name, area, position}
    const obj = item as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : '区域',
      area: typeof obj.area === 'number' ? obj.area : 1,
      position: typeof obj.position === 'number' ? obj.position : 5,
    };
  });
}

export default function regionZoneGenerator(input: Record<string, unknown>): Output {
  const boundaryStyle = typeof input.boundaryStyle === 'string' ? input.boundaryStyle : 'rectilinear';
  const relaxIterations = typeof input.relaxIterations === 'number' ? input.relaxIterations : 5;
  const smoothIterations = typeof input.smoothIterations === 'number' ? input.smoothIterations : 5;
  const seed = typeof input.seed === 'number' ? input.seed : 0;

  // --- 解析 baseGrid（支持单网格/网格列表）---
  const baseGrids = parseBaseGrids(input.baseGrid);
  if (!baseGrids) return { outputGridList: [], nameList: [] };

  // --- 解析 regions（支持新旧两种格式）---
  const regions = parseRegions(input.regions);
  if (regions.length === 0) {
    return { outputGridList: [], nameList: [] };
  }

  // 使用第一个基准网格确定尺寸和最大 ID（各基准网格应同尺寸）
  const baseGrid = baseGrids[0];
  const rows = baseGrid.length;
  if (rows === 0 || baseGrid[0].length === 0) return { outputGridList: [], nameList: [] };
  const cols = baseGrid[0].length;

  const rng = makeMRng(seed === 0 ? Date.now() : seed);

  // --- Step 1: 收集可用像素（对所有基准网格取并集）---
  const usableCellSet = new Set<number>();
  for (const bg of baseGrids) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (bg[r][c] !== 0) usableCellSet.add(r * cols + c);
      }
    }
  }
  const usableCells: [number, number][] = [];
  for (const idx of usableCellSet) {
    usableCells.push([Math.floor(idx / cols), idx % cols]);
  }

  if (usableCells.length === 0) return { outputGridList: [], nameList: [] };

  // 构建掩码 Int32Array（1=可用，0=不可用）
  const mask = new Int32Array(rows * cols);
  for (const [r, c] of usableCells) {
    mask[r * cols + c] = 1;
  }

  // --- Step 2: 面积占比归一化 ---
  // area 支持任意正数（整数权重或 0~1 浮点均可），按比例归一化
  const rawRatios = regions.map(r => Math.max(0, r.area));
  const ratioSum = rawRatios.reduce((s, v) => s + v, 0);

  let areaRatios: number[];
  if (ratioSum <= 0) {
    // 全为0：平均分配
    areaRatios = rawRatios.map(() => 1 / regions.length);
  } else {
    // 按比例归一化，无论加和是否超过1
    areaRatios = rawRatios.map(r => r / ratioSum);
  }

  // --- Step 3: 种子定位 ---
  const seeds = placeSeedPoints(regions, rows, cols, usableCells, rng);

  // --- Step 4: 加权 Voronoi + Lloyd 松弛 ---
  const { seeds: relaxedSeeds, label } = lloydRelax(
    seeds,
    areaRatios,
    usableCells,
    rows,
    cols,
    Math.max(0, relaxIterations)
  );

  // --- Step 5: 边界后处理 ---
  const processedLabel = applyBoundaryStyle(
    boundaryStyle,
    label,
    mask,
    rows,
    cols,
    relaxedSeeds.map(s => ({ x: s.x, y: s.y })),
    areaRatios,
    Math.max(1, smoothIterations)
  );

  // --- Step 5: 计算基准网格最大 ID，顺延分配新 ID ---
  let maxBaseID = 0;
  for (const bg of baseGrids) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (bg[r][c] > maxBaseID) maxBaseID = bg[r][c];
      }
    }
  }
  const baseNewID = maxBaseID + 1;
  const regionToID: number[] = regions.map((_, i) => baseNewID + i);

  // --- Step 6: 输出单值网格列表，每个区域一张，只含该区域 ID 和 0 ---
  const outputGridList: Grid[] = regions.map((_, ki) => {
    const targetID = regionToID[ki];
    const grid: Grid = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (mask[idx] && processedLabel[idx] === ki) {
          row.push(targetID);
        } else {
          row.push(0);
        }
      }
      grid.push(row);
    }
    return grid;
  });

  // --- Step 7: 构建名称清单 ---
  const nameList: NameEntry[] = regions.map((reg, i) => ({
    id: regionToID[i],
    name: reg.name,
    type: 'tile',
  }));

  return { outputGridList, nameList };
}
