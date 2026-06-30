/**
 * farmland_grid: 根据可用区域掩码列表批量生成农田分区布局
 * 输入：gridList (array) — 可用区域掩码列表（每项非零为可种植区）; layout (string) — 布局算法;
 *       plotWidth/plotHeight/pathWidth (number) — 地块与小径宽度; seed (number) — 随机种子
 *       plantDensity (number, 0~1, default 0.9) — 作物点位铺设密度，1=满铺
 *       mergeOutput (boolean, default true) — 是否将所有网格的同语义层合并为一张网格
 * 输出：
 *   outputGridList (array) — 单值网格列表：
 *     每个作物类型输出两张：①田地网格（type:"tile"，名称"田地"）；②满铺点位网格（type:"asset"，名称为作物名）
 *     mergeOutput=true:  按语义合并，每类只输出一对（田垄/田地×作物），ID全局唯一
 *     mergeOutput=false: 每张农田独立拆分（农田N-田垄 / 农田N-田地 / 农田N-水稻 / …）
 *   outputNameList (array) — 名称清单（与 outputGridList 一一对应），
 *                             格式：{id, name, type:"tile"|"asset"}
 */

type Grid = number[][];

// Plot type values (cycle through for visual variety) — 4 crop types, no orchard
const PLOT_TYPES = [2, 3, 4, 5] as const;
const PATH = 1;

// 田垄名称
const PATH_NAME = "田垄";

// 作物名称（val → 作物名，不含「田」字）
const CROP_NAMES: Record<number, string> = {
  2: "水稻",
  3: "小麦",
  4: "玉米",
  5: "蔬菜",
};

// Linear Congruential Generator
function makeLCG(seed: number): () => number {
  let s = ((seed === 0 ? Date.now() : seed) & 0xffffffff) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

// Bounding box of all non-zero cells
function getBBox(grid: Grid): { r0: number; r1: number; c0: number; c1: number } | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
      }
    }
  }
  return r1 === -1 ? null : { r0, r1, c0, c1 };
}

// --- Algorithm 1: grid (规则网格) ---
// Uniform rectangular plots arranged in a grid, separated by fixed-width paths.
// Remainder rows/cols (bbox size % period != 0) are distributed whole to random plots
// rather than left as oversized path ridges.
function generateGrid(grid: Grid, plotW: number, plotH: number, pathW: number, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  const spanR = r1 - r0 + 1;
  const spanC = c1 - c0 + 1;
  const periodR = plotH + pathW;
  const periodC = plotW + pathW;

  // N 个地块占用：N*plotSize + (N-1)*pathW，解出 N：
  const numBandsR = Math.max(1, Math.floor((spanR + pathW) / periodR));
  const numBandsC = Math.max(1, Math.floor((spanC + pathW) / periodC));
  // 余量：实际 span 减去严格排列后的占用（末尾无 path）
  const remR = spanR - (numBandsR * plotH + (numBandsR - 1) * pathW);
  const remC = spanC - (numBandsC * plotW + (numBandsC - 1) * pathW);

  // 随机选一个地块行/列 band 接收余量（扩展其地块尺寸）
  const bonusRowBand = Math.floor(rng() * numBandsR);
  const bonusColBand = Math.floor(rng() * numBandsC);

  // 预计算每个 band 的起止偏移（band 之间间距严格 pathW，末尾无尾 path）
  function buildBandRanges(numBands: number, plotSize: number, bonus: number, bonusBand: number) {
    const ranges: { plotStart: number; plotEnd: number }[] = [];
    let cursor = 0;
    for (let i = 0; i < numBands; i++) {
      const extra = i === bonusBand ? bonus : 0;
      ranges.push({ plotStart: cursor, plotEnd: cursor + plotSize + extra - 1 });
      cursor += plotSize + extra;
      if (i < numBands - 1) cursor += pathW; // band 间 path，最后一个后面不加
    }
    return ranges;
  }

  const rowRanges = buildBandRanges(numBandsR, plotH, remR, bonusRowBand);
  const colRanges = buildBandRanges(numBandsC, plotW, remC, bonusColBand);

  // Build lookup: span offset → band index (-1 = path between bands)
  function buildMap(ranges: { plotStart: number; plotEnd: number }[], span: number) {
    const map = new Int8Array(span).fill(-1);
    for (let i = 0; i < ranges.length; i++) {
      const { plotStart, plotEnd } = ranges[i];
      for (let p = plotStart; p <= plotEnd && p < span; p++) map[p] = i;
    }
    return map;
  }

  const rowMap = buildMap(rowRanges, spanR);
  const colMap = buildMap(colRanges, spanC);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r][c] === 0) continue;
      const bandR = rowMap[r - r0];
      const bandC = colMap[c - c0];
      if (bandR < 0 || bandC < 0) {
        output[r][c] = PATH;
      } else {
        output[r][c] = PLOT_TYPES[(bandR * 997 + bandC) % PLOT_TYPES.length];
      }
    }
  }

  return output;
}

// --- Algorithm 2: strip (条带农田) ---
// Strips of uniform height (or width), separated by paths, with a surrounding border ridge.
// Direction is randomly chosen per farmland: horizontal (along rows) or vertical (along cols).
// Remainder cells are distributed whole to a random strip rather than left as extra path.
function generateStrip(grid: Grid, stripH: number, pathW: number, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  // Randomly decide strip direction for this farmland
  const horizontal = rng() < 0.5;

  // Inner area after removing the border ring on all sides
  const ir0 = r0 + pathW;
  const ir1 = r1 - pathW;
  const ic0 = c0 + pathW;
  const ic1 = c1 - pathW;

  // Inner span along the strip direction
  const innerSpan = horizontal ? (ir1 - ir0 + 1) : (ic1 - ic0 + 1);
  const period = stripH + pathW;

  // N 条 strip 占用：N*stripH + (N-1)*pathW，解出 N：
  // N*stripH + (N-1)*pathW <= innerSpan  →  N*(stripH+pathW) <= innerSpan + pathW
  const numStrips = Math.max(1, Math.floor((innerSpan + pathW) / period));
  // 实际 strip+间隔占用的总格数（不含最后一条的尾部 path）
  const usedSpan = numStrips * stripH + (numStrips - 1) * pathW;
  // 余量：整体分配给随机一条 strip
  const rem = innerSpan - usedSpan; // >= 0

  // Random strip receives the bonus remainder cells
  const bonusStrip = Math.floor(rng() * numStrips);

  // Build per-strip ranges within inner span（strip 之间间距严格 pathW，末尾无尾 path）
  const stripRanges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < numStrips; i++) {
    const extra = i === bonusStrip ? rem : 0;
    stripRanges.push({ start: cursor, end: cursor + stripH + extra - 1 });
    cursor += stripH + extra;
    if (i < numStrips - 1) cursor += pathW; // 条带间 path，最后一条后面不加
  }

  // Build lookup map: inner offset → strip index (-1 = inner path)
  const innerMap = new Int16Array(innerSpan).fill(-1);
  for (let i = 0; i < stripRanges.length; i++) {
    const { start, end } = stripRanges[i];
    for (let p = start; p <= end && p < innerSpan; p++) innerMap[p] = i;
  }

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r][c] === 0) continue;
      // Border ring → path
      if (r < ir0 || r > ir1 || c < ic0 || c > ic1) {
        output[r][c] = PATH;
        continue;
      }
      const pos = horizontal ? (r - ir0) : (c - ic0);
      const stripIdx = innerMap[pos];
      output[r][c] = stripIdx < 0 ? PATH : PLOT_TYPES[stripIdx % PLOT_TYPES.length];
    }
  }

  return output;
}

// --- Algorithm 3: bsp (自由划分) ---
// Recursively splits the bounding area via BSP, yielding varied-size plots.
// All valid cells start as path; each leaf rect is filled with a plot type.
interface Rect { r0: number; r1: number; c0: number; c1: number }

function bspSplit(rect: Rect, minSize: number, pathW: number, depth: number, rng: () => number): Rect[] {
  const h = rect.r1 - rect.r0 + 1;
  const w = rect.c1 - rect.c0 + 1;
  const canH = h >= minSize * 2 + pathW;
  const canV = w >= minSize * 2 + pathW;

  // Stop splitting beyond depth 6 or when too small
  if ((!canH && !canV) || depth >= 6) return [rect];

  const splitH = canH && canV ? rng() < 0.5 : canH;

  if (splitH) {
    const lo = rect.r0 + minSize;
    const hi = rect.r1 - minSize - pathW + 1;
    if (lo > hi) return [rect];
    const split = lo + Math.floor(rng() * (hi - lo + 1));
    const a: Rect = { r0: rect.r0, r1: split - 1,      c0: rect.c0, c1: rect.c1 };
    const b: Rect = { r0: split + pathW, r1: rect.r1,   c0: rect.c0, c1: rect.c1 };
    return [...bspSplit(a, minSize, pathW, depth + 1, rng), ...bspSplit(b, minSize, pathW, depth + 1, rng)];
  } else {
    const lo = rect.c0 + minSize;
    const hi = rect.c1 - minSize - pathW + 1;
    if (lo > hi) return [rect];
    const split = lo + Math.floor(rng() * (hi - lo + 1));
    const a: Rect = { r0: rect.r0, r1: rect.r1, c0: rect.c0,    c1: split - 1 };
    const b: Rect = { r0: rect.r0, r1: rect.r1, c0: split + pathW, c1: rect.c1 };
    return [...bspSplit(a, minSize, pathW, depth + 1, rng), ...bspSplit(b, minSize, pathW, depth + 1, rng)];
  }
}

function generateBSP(grid: Grid, minPlotSize: number, pathW: number, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  // Fill all valid cells as path first; plots will overwrite
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r][c] !== 0) output[r][c] = PATH;
    }
  }

  const plots = bspSplit({ r0, r1, c0, c1 }, minPlotSize, pathW, 0, rng);

  plots.forEach((rect, idx) => {
    const plotType = PLOT_TYPES[idx % PLOT_TYPES.length];
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== 0) {
          output[r][c] = plotType;
        }
      }
    }
  });

  return output;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

/**
 * 非合并模式：将单张多值网格拆分为单值网格列表 + 名称清单。
 * farmIndex 为农田序号（1起）；nextId 为全局 ID 计数器引用。
 * 对于作物类型，额外输出一张按 plantDensity 随机稀疏的点位网格（type:"asset"）。
 */
function splitToSingleValueGrids(
  multiGrid: Grid,
  farmIndex: number,
  nextId: { value: number },
  plantDensity: number,
  rng: () => number
): { grids: Grid[]; nameList: NameEntry[] } {
  const rows = multiGrid.length;
  const cols = multiGrid[0]?.length ?? 0;
  const grids: Grid[] = [];
  const nameList: NameEntry[] = [];

  const valSet = new Set<number>();
  for (const row of multiGrid) for (const v of row) if (v !== 0) valSet.add(v);

  const sortedVals = [...valSet].sort((a, b) => a - b);
  for (const val of sortedVals) {
    const singleGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (multiGrid[r][c] === val) singleGrid[r][c] = nextId.value;

    if (val === PATH) {
      // 田垄：直接输出，type:"tile"
      nameList.push({ id: nextId.value, name: `农田${farmIndex}-${PATH_NAME}`, type: "tile" });
      grids.push(singleGrid);
      nextId.value++;
    } else {
      const cropName = CROP_NAMES[val] ?? `地块${val}`;

      // ① 田地网格，type:"tile"
      const landId = nextId.value;
      nameList.push({ id: landId, name: `农田${farmIndex}-田地`, type: "tile" });
      grids.push(singleGrid);
      nextId.value++;

      // ② 点位网格（按 plantDensity 随机稀疏），type:"asset"
      const assetId = nextId.value;
      const assetGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (singleGrid[r][c] === landId && rng() < plantDensity) assetGrid[r][c] = assetId;
      nameList.push({ id: assetId, name: `农田${farmIndex}-${cropName}`, type: "asset" });
      grids.push(assetGrid);
      nextId.value++;
    }
  }

  return { grids, nameList };
}

/**
 * 合并模式：将所有多值网格按语义值合并。
 * - 田垄：所有农田的田垄合并为一张（type:"tile"）
 * - 田地：所有作物类型的田地合并为同一张（type:"tile"，名称"田地"），共用同一 ID
 * - 作物点位：每种作物各输出一张按 plantDensity 随机稀疏的点位网格（type:"asset"，名称为作物名）
 * 输出顺序：田垄 → 田地（合并） → 各作物点位
 */
function mergeBySemantics(
  multiGrids: Grid[],
  rows: number,
  cols: number,
  nextId: { value: number },
  plantDensity: number,
  rng: () => number
): { grids: Grid[]; nameList: NameEntry[] } {
  // 收集所有出现的语义值
  const valSet = new Set<number>();
  for (const mg of multiGrids)
    for (const row of mg)
      for (const v of row)
        if (v !== 0) valSet.add(v);

  const sortedVals = [...valSet].sort((a, b) => a - b);
  const cropVals = sortedVals.filter(v => v !== PATH);

  const grids: Grid[] = [];
  const nameList: NameEntry[] = [];

  // ── 田垄 ──
  if (valSet.has(PATH)) {
    const merged: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    const id = nextId.value;
    for (const mg of multiGrids)
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (mg[r]?.[c] === PATH) merged[r][c] = id;
    nameList.push({ id, name: PATH_NAME, type: "tile" });
    grids.push(merged);
    nextId.value++;
  }

  // ── 田地（所有作物类型合并为一张）──
  if (cropVals.length > 0) {
    const landId = nextId.value;
    const landGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (const mg of multiGrids)
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (mg[r]?.[c] !== 0 && mg[r]?.[c] !== PATH) landGrid[r][c] = landId;
    nameList.push({ id: landId, name: "田地", type: "tile" });
    grids.push(landGrid);
    nextId.value++;

    // ── 各作物点位（每种作物单独一张，按 plantDensity 随机稀疏）──
    for (const val of cropVals) {
      const assetId = nextId.value;
      const assetGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
      for (const mg of multiGrids)
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            if (mg[r]?.[c] === val && rng() < plantDensity) assetGrid[r][c] = assetId;
      const cropName = CROP_NAMES[val] ?? `地块${val}`;
      nameList.push({ id: assetId, name: cropName, type: "asset" });
      grids.push(assetGrid);
      nextId.value++;
    }
  }

  return { grids, nameList };
}

export function farmlandGrid(input: Record<string, unknown>): Record<string, unknown> {
  const rawGridList  = input.gridList;
  const layout       = typeof input.layout       === "string"  ? input.layout                                           : "grid";
  const plotWidth    = typeof input.plotWidth    === "number"  ? Math.max(2, Math.floor(input.plotWidth))               : 4;
  const plotHeight   = typeof input.plotHeight   === "number"  ? Math.max(2, Math.floor(input.plotHeight))              : 4;
  const pathWidth    = typeof input.pathWidth    === "number"  ? Math.max(1, Math.floor(input.pathWidth))               : 1;
  const seed         = typeof input.seed         === "number"  ? Math.floor(input.seed)                                 : 0;
  const plantDensity = typeof input.plantDensity === "number"  ? Math.min(1, Math.max(0, input.plantDensity))           : 0.9;
  const mergeOutput  = input.mergeOutput === false ? false : true; // default true

  // Support both a single grid and an array of grids
  let gridList: Grid[];
  if (Array.isArray(rawGridList)) {
    if (rawGridList.length === 0) return { error: "gridList is required" };
    if (typeof rawGridList[0]?.[0] === "number") {
      gridList = [rawGridList as unknown as Grid];
    } else {
      gridList = rawGridList as Grid[];
    }
  } else {
    return { error: "gridList is required" };
  }

  const minPlotSize = Math.min(plotWidth, plotHeight);
  const baseSeed = seed === 0 ? Date.now() : seed;
  const nextId = { value: 1 };
  // 专用于点位密度随机，与布局 rng 独立，保证可复现
  const densityRng = makeLCG(baseSeed ^ 0xdeadbeef);

  // Generate multi-value grids for all inputs
  const rows = gridList[0]?.length ?? 0;
  const cols = gridList[0]?.[0]?.length ?? 0;
  const multiGrids: Grid[] = [];

  gridList.forEach((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) return;
    const rng = makeLCG(baseSeed + i * 999983);
    let multiGrid: Grid;
    switch (layout) {
      case "strip":
        multiGrid = generateStrip(grid, plotHeight, pathWidth, rng);
        break;
      case "bsp":
        multiGrid = generateBSP(grid, minPlotSize, pathWidth, rng);
        break;
      default:
        multiGrid = generateGrid(grid, plotWidth, plotHeight, pathWidth, rng);
    }
    multiGrids.push(multiGrid);
  });

  if (multiGrids.length === 0) return { outputGridList: [], outputNameList: [] };

  if (mergeOutput) {
    const { grids, nameList } = mergeBySemantics(multiGrids, rows, cols, nextId, plantDensity, densityRng);
    return { outputGridList: grids, outputNameList: nameList };
  }

  // Non-merge: split each farmland independently
  const outputGridList: Grid[] = [];
  const outputNameList: NameEntry[] = [];
  multiGrids.forEach((mg, i) => {
    const { grids, nameList } = splitToSingleValueGrids(mg, i + 1, nextId, plantDensity, densityRng);
    outputGridList.push(...grids);
    outputNameList.push(...nameList);
  });
  return { outputGridList, outputNameList };
}
