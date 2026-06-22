/**
 * hillContourGenerate
 *
 * 生成策略：
 *   在输入掩码的非零区域内，以高斯距离场为主体构建高度场，使等高线严格
 *   一层套一层（同心状）。具体步骤：
 *
 *   1. 计算每个非零格子到最近山峰的加权距离（多峰取 soft-max 融合）
 *   2. 在距离场上叠加轻微的 Value Noise 扰动（noiseAmount 控制），
 *      使等高线边缘呈有机感而非完美圆形
 *   3. 对非零区域的高度值做等面积重映射（分位数拉伸），
 *      使每层等高带的格子数相近
 *   4. 按层号切分为网格列表（外层序号小，内层序号大）
 *   5. 内置后处理：合并所有层 → 填孔洞 → 删孤立块 → 归并空白 → 拆回各层
 *
 * 输入：
 *   grid          (grid)   — 输入掩码网格，仅对非 0 格子生成等高线
 *   contourLevels (number) — 等高线层数（默认 6）
 *   hillCount     (number) — 山头数量（默认 1）
 *   roundness     (number) — 圆度 0~1（默认 0.85）
 *   peakRadius    (number) — 山包半径 0~1（默认 0.35）
 *   noiseAmount   (number) — 边缘扰动量（默认 0.12）
 *   minHoleSize   (number) — 后处理：最大孔洞面积（默认 20）
 *   minIslandSize (number) — 后处理：最小岛屿面积（默认 8）
 *   peakPosition  (number) — 九宫格位置 1~9（键盘数字键布局），0=随机（默认 0）
 *   seed          (number) — 随机种子（默认 0）
 *
 * 输出：
 *   contourLayers  (array<grid>) — 每层填充 mask，外→内层序号递增
 *   outputNameList (array)       — 各层名称清单
 */

type Grid = number[][];
type NameEntry = { id: number; name: string; type: string };
type Point = { x: number; y: number };

/** 将输入统一解析为 Grid[]，支持单个网格或网格列表 */
function parseInputGrids(raw: unknown): Grid[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return [raw as Grid];
  }
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return raw as Grid[];
  }
  return null;
}

// ─── PRNG ─────────────────────────────────────────────────────────────────────

class SeededRandom {
  private s: number;

  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() >>> 0 : (Math.abs(Math.round(seed)) >>> 0) || 1;
    for (let i = 0; i < 8; i++) this.next();
  }

  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0xffffffff;
  }
}

// ─── 数学工具 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fade(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ─── Value Noise（仅用于轻微边缘扰动）────────────────────────────────────────

function hash2(ix: number, iy: number, seed: number): number {
  let n = (ix * 374761393 + iy * 668265263 + seed * 69069) | 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), tx),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), tx),
    ty
  );
}

// ─── 九宫格位置映射 ────────────────────────────────────────────────────────────

/**
 * 将九宫格编号（1-9，键盘数字键布局）转换为归一化坐标。
 * 布局：
 *   7(左上) 8(上中) 9(右上)
 *   4(左中) 5(正中) 6(右中)
 *   1(左下) 2(下中) 3(右下)
 *
 * 边距 margin 使峰不贴近区域边缘。
 */
function numpadToNormalized(pos: number, margin = 0.2): Point {
  const col = ((pos - 1) % 3);        // 0=左 1=中 2=右
  const row = 2 - Math.floor((pos - 1) / 3); // 0=下 1=中 2=上（y 轴向下）
  const x = margin + col * (1 - 2 * margin) / 2;
  const y = margin + row * (1 - 2 * margin) / 2;
  return { x, y };
}

// ─── 山峰位置采样 ──────────────────────────────────────────────────────────────

/**
 * 在掩码边界框内用泊松排斥采样放置山峰，使山峰尽量分散。
 * 优先放置在掩码非零区域的重心附近。
 */
function samplePeakCenters(
  count: number,
  nonZeroCells: [number, number][],
  rows: number,
  cols: number,
  rng: SeededRandom
): Point[] {
  if (nonZeroCells.length === 0) return [{ x: 0.5, y: 0.5 }];

  const minDist = clamp(0.5 / Math.sqrt(count), 0.15, 0.45);
  const placed: Point[] = [];

  for (let i = 0; i < count; i++) {
    let best: Point = { x: 0.5, y: 0.5 };
    let bestScore = -1;

    for (let trial = 0; trial < 400; trial++) {
      const cellIdx = Math.floor(rng.next() * nonZeroCells.length);
      const [cr, cc] = nonZeroCells[cellIdx];
      const jitter = 0.08;
      const nx = clamp(cc / (cols - 1) + (rng.next() - 0.5) * jitter, 0, 1);
      const ny = clamp(cr / (rows - 1) + (rng.next() - 0.5) * jitter, 0, 1);
      const candidate = { x: nx, y: ny };

      let minD = Infinity;
      for (const p of placed) {
        const d = Math.hypot(candidate.x - p.x, candidate.y - p.y);
        if (d < minD) minD = d;
      }

      if (placed.length === 0 || minD >= minDist) {
        best = candidate;
        break;
      }
      if (minD > bestScore) {
        best = candidate;
        bestScore = minD;
      }
    }
    placed.push(best);
  }

  return placed;
}

// ─── 高斯高度场（带 roundness 控制）──────────────────────────────────────────

/**
 * 计算单个山峰对某点的高度贡献。
 * roundness 控制等高线形状：
 *   - 1.0 = L2 距离（正圆高斯）
 *   - 接近 0 = Lp 范数混合（等高线趋向菱形/方形）
 * 实际上 roundness 控制指数 p：p = lerp(1.0, 2.0, roundness)
 */
function hillGaussian(
  nx: number, ny: number,
  cx: number, cy: number,
  radius: number,
  roundness: number
): number {
  const p = lerp(1.2, 2.0, roundness);
  const dx = Math.abs(nx - cx) / radius;
  const dy = Math.abs(ny - cy) / radius;
  const dist = Math.pow(Math.pow(dx, p) + Math.pow(dy, p), 1 / p);
  return Math.exp(-2.5 * dist * dist);
}

// ─── 高度场构建 ────────────────────────────────────────────────────────────────

function buildHeightField(
  rows: number,
  cols: number,
  nonZeroMask: Uint8Array,
  peaks: Point[],
  peakRadius: number,
  roundness: number,
  noiseAmount: number,
  seed: number
): Float64Array {
  const raw = new Float64Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    const ny = rows > 1 ? r / (rows - 1) : 0.5;
    for (let c = 0; c < cols; c++) {
      if (!nonZeroMask[r * cols + c]) continue;
      const nx = cols > 1 ? c / (cols - 1) : 0.5;

      // 多峰 soft-max 融合：避免峰值区域被平均压低
      let maxH = 0;
      let softSum = 0;
      let softWeight = 0;
      const kSoft = 8;

      for (const peak of peaks) {
        const h = hillGaussian(nx, ny, peak.x, peak.y, peakRadius, roundness);
        if (h > maxH) maxH = h;
        const w = Math.exp(kSoft * h);
        softSum += h * w;
        softWeight += w;
      }

      // soft-max 融合，给最近山峰更高权重
      const baseH = softWeight > 0 ? softSum / softWeight : maxH;

      // 叠加轻微噪声扰动（频率较高，幅度受 noiseAmount 控制）
      const noiseVal = (valueNoise(nx * 8, ny * 8, seed) - 0.5) * 2;
      raw[r * cols + c] = clamp(baseH + noiseVal * noiseAmount * baseH, 0, 1);
    }
  }

  return raw;
}

// ─── 等面积重映射 ──────────────────────────────────────────────────────────────

function equalAreaRemap(values: Float64Array, indices: number[]): Float64Array {
  const n = indices.length;
  if (n === 0) return new Float64Array(0);
  const sorted = [...indices].sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(values.length).fill(-1);
  for (let rank = 0; rank < n; rank++) {
    out[sorted[rank]] = rank / (n - 1);
  }
  return out;
}

// ─── 分层切割 ─────────────────────────────────────────────────────────────────

function levelOf(v: number, totalLevels: number): number {
  if (v >= 1) return totalLevels;
  return Math.floor(v * totalLevels) + 1;
}

function buildContourLayers(
  rows: number,
  cols: number,
  nonZeroMask: Uint8Array,
  remapped: Float64Array,
  contourLevels: number
): Grid[] {
  const layers: Grid[] = Array.from({ length: contourLevels }, () =>
    Array.from({ length: rows }, () => new Array(cols).fill(0))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!nonZeroMask[idx] || remapped[idx] < 0) continue;
      const lv = levelOf(remapped[idx], contourLevels);
      layers[lv - 1][r][c] = lv;
    }
  }
  return layers;
}

// ─── 后处理（形态学清理，直接内嵌）──────────────────────────────────────────

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

function bfsRegion(
  grid: Grid,
  startR: number,
  startC: number,
  visited: Uint8Array,
  rows: number,
  cols: number,
  targetValue: number
): { cells: [number, number][]; touchesBorder: boolean; neighborCount: Map<number, number> } {
  const cells: [number, number][] = [];
  const neighborCount = new Map<number, number>();
  let touchesBorder = false;
  const queue: [number, number][] = [[startR, startC]];
  visited[startR * cols + startC] = 1;

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    cells.push([r, c]);
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) touchesBorder = true;

    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nv = grid[nr][nc];
      if (nv !== targetValue) {
        if (nv !== 0) neighborCount.set(nv, (neighborCount.get(nv) ?? 0) + 1);
        continue;
      }
      if (visited[nr * cols + nc]) continue;
      visited[nr * cols + nc] = 1;
      queue.push([nr, nc]);
    }
  }

  return { cells, touchesBorder, neighborCount };
}

function mergeLayers(layers: Grid[]): Grid {
  const rows = layers[0].length;
  const cols = layers[0][0].length;
  const merged: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const g of layers) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 0) merged[r][c] = g[r][c];
      }
    }
  }
  return merged;
}

function fillHoles(grid: Grid, minHoleSize: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, touchesBorder, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0);
      if (!touchesBorder && neighborCount.size === 1 && cells.length <= minHoleSize) {
        const fillVal = [...neighborCount.keys()][0];
        for (const [fr, fc] of cells) result[fr][fc] = fillVal;
      }
    }
  }
  return result;
}

function removeIslands(grid: Grid, minIslandSize: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = result[r][c];
      if (v === 0 || visited[r * cols + c]) continue;
      const { cells } = bfsRegion(result, r, c, visited, rows, cols, v);
      if (cells.length < minIslandSize) {
        for (const [dr, dc] of cells) result[dr][dc] = 0;
      }
    }
  }
  return result;
}

function fillVoids(grid: Grid): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0);
      if (neighborCount.size === 0) continue;

      let bestVal = 0;
      let bestCount = 0;
      for (const [val, cnt] of neighborCount) {
        if (cnt > bestCount) { bestCount = cnt; bestVal = val; }
      }
      for (const [fr, fc] of cells) result[fr][fc] = bestVal;
    }
  }
  return result;
}

function splitToLayers(merged: Grid, layerCount: number, rows: number, cols: number): Grid[] {
  const layers: Grid[] = Array.from({ length: layerCount }, () =>
    Array.from({ length: rows }, () => new Array(cols).fill(0))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = merged[r][c];
      if (v >= 1 && v <= layerCount) {
        layers[v - 1][r][c] = v;
      }
    }
  }
  return layers;
}

function postProcess(layers: Grid[], minHoleSize: number, minIslandSize: number): Grid[] {
  const rows = layers[0].length;
  const cols = layers[0][0].length;
  const layerCount = layers.length;

  const merged = mergeLayers(layers);
  const afterFill = fillHoles(merged, minHoleSize);
  const afterRemove = removeIslands(afterFill, minIslandSize);
  const afterVoid = fillVoids(afterRemove);
  return splitToLayers(afterVoid, layerCount, rows, cols);
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

/** 对单个网格执行等高线生成 */
function processOneGrid(
  grid: Grid,
  contourLevels: number,
  hillCount: number,
  roundness: number,
  peakRadius: number,
  noiseAmount: number,
  minHoleSize: number,
  minIslandSize: number,
  seed: number,
  peakPositionRaw: unknown,
): { contourLayers: Grid[]; outputNameList: NameEntry[] } {
  const rows = grid.length;
  const cols = grid[0].length;
  const rng  = new SeededRandom(seed);

  let peakPosition: number;
  if (typeof peakPositionRaw === "number" && !isNaN(peakPositionRaw)) {
    peakPosition = clamp(Math.round(peakPositionRaw), 1, 9);
  } else {
    peakPosition = Math.floor(rng.next() * 9) + 1;
  }

  const nonZeroMask = new Uint8Array(rows * cols);
  const nonZeroCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((grid[r]?.[c] ?? 0) !== 0) {
        nonZeroMask[r * cols + c] = 1;
        nonZeroCells.push([r, c]);
      }
    }
  }

  const emptyNameList: NameEntry[] = Array.from({ length: contourLevels }, (_, i) => ({
    id: i + 1, name: `山包层${i + 1}`, type: "tile",
  }));

  if (nonZeroCells.length === 0) {
    return {
      contourLayers: Array.from({ length: contourLevels }, () =>
        Array.from({ length: rows }, () => new Array(cols).fill(0))
      ),
      outputNameList: emptyNameList,
    };
  }

  const fixedPeak = numpadToNormalized(peakPosition);
  const peaks: Point[] = hillCount === 1
    ? [fixedPeak]
    : [fixedPeak, ...samplePeakCenters(hillCount - 1, nonZeroCells, rows, cols, rng)];

  const raw = buildHeightField(rows, cols, nonZeroMask, peaks, peakRadius, roundness, noiseAmount, seed);
  const nonZeroIdx = nonZeroCells.map(([r, c]) => r * cols + c);
  const remapped = equalAreaRemap(raw, nonZeroIdx);
  const rawLayers = buildContourLayers(rows, cols, nonZeroMask, remapped, contourLevels);
  const contourLayers = postProcess(rawLayers, minHoleSize, minIslandSize);

  const outputNameList: NameEntry[] = Array.from({ length: contourLevels }, (_, i) => ({
    id: i + 1, name: `山包层${i + 1}`, type: "tile",
  }));

  return { contourLayers, outputNameList };
}

export function hillContourGenerate(input: Record<string, unknown>): Record<string, unknown> {
  const grids = parseInputGrids(input.grid);
  if (!grids) {
    return { contourLayers: [], outputNameList: [] };
  }

  const contourLevels = typeof input.contourLevels === "number" ? Math.max(2, Math.round(input.contourLevels)) : 6;
  const hillCount     = typeof input.hillCount     === "number" ? Math.max(1, Math.round(input.hillCount))     : 1;
  const roundness     = typeof input.roundness     === "number" ? clamp(input.roundness, 0, 1)                : 0.85;
  const peakRadius    = typeof input.peakRadius    === "number" ? clamp(input.peakRadius, 0.05, 0.8)          : 0.35;
  const noiseAmount   = typeof input.noiseAmount   === "number" ? clamp(input.noiseAmount, 0, 0.5)            : 0.12;
  const minHoleSize   = typeof input.minHoleSize   === "number" ? Math.max(1, Math.round(input.minHoleSize))  : 20;
  const minIslandSize = typeof input.minIslandSize === "number" ? Math.max(1, Math.round(input.minIslandSize)): 8;
  const baseSeed      = typeof input.seed          === "number" ? input.seed : 0;

  const contourLayers: Grid[] = [];
  let outputNameList: NameEntry[] = [];

  for (let i = 0; i < grids.length; i++) {
    const g = grids[i];
    if (!g || g.length === 0 || !g[0] || g[0].length === 0) continue;
    const { contourLayers: layers, outputNameList: nameList } = processOneGrid(
      g, contourLevels, hillCount, roundness, peakRadius, noiseAmount,
      minHoleSize, minIslandSize, baseSeed + i * 1000003, input.peakPosition,
    );
    contourLayers.push(...layers);
    outputNameList = nameList;
  }

  return { contourLayers, outputNameList };
}
