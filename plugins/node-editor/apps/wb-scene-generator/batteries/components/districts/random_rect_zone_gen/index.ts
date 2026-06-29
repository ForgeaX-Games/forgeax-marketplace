/**
 * rectZoneGen: 在网格指定区域内随机生成不重叠矩形地块
 * 填充值自动取输入网格最大值+1，每个地块独立递增。
 * 输入：grid (array); targetValue (number) — 目标区域掩码（0=任意非零）;
 *       count (number); minSize/maxSize (number) — 宽高范围（宽高各自独立随机，共用同一范围）;
 *       minDistance (number) — 相邻矩形最近边之间的最小格数间距;
 *       dispersion (number, 0–1) — 离散程度，越大越分散;
 *       merge (boolean) — 开启时仅合并名称清单为单条"地块"，地块网格列表保持独立；关闭时每个地块独立网格和独立名称条目;
 *       seed (number)
 * 输出：outputGridList (array) — 合并模式：单值网格列表，每个地块一张网格（名称统一为"地块"）；非合并模式：同左，但名称各自独立
 *       outputNameList (array) — 合并模式：[{id:1, name:'地块', type:'tile'}]；非合并模式：[{id, name:'地块 N', type:'tile'}]
 */

class LCG {
  private s: bigint;
  constructor(seed: number) { this.s = BigInt(seed || 12345); }
  next(): bigint {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return this.s;
  }
  float(): number { return Number(this.next() & 0xFFFFFFFFn) / 0x100000000; }
  intn(n: number): number { return n <= 0 ? 0 : Number(this.next() % BigInt(n)); }
}

/**
 * 检查矩形 [x, x+w) × [y, y+h) 是否与所有已放矩形保持最小边距。
 * 最近边距离定义：两矩形在 X 轴上的单侧间隙（gapX）和 Y 轴上的单侧间隙（gapY），
 * 取两轴中较小的正间隙作为最近边距离。若任意一轴重叠（间隙 < 0），
 * 则仅看另一轴是否满足最小距离要求。
 * 即：只要 max(gapX,0) < minDistance 且 max(gapY,0) < minDistance，则距离不足。
 */
function hasMinDistance(
  x: number, y: number, w: number, h: number,
  placedRects: [number, number, number, number][],
  minDistance: number,
): boolean {
  if (minDistance <= 0) return true;
  for (const [px, py, pw, ph] of placedRects) {
    const gapX = Math.max(px - (x + w), x - (px + pw));
    const gapY = Math.max(py - (y + h), y - (py + ph));
    if (Math.max(gapX, 0) < minDistance && Math.max(gapY, 0) < minDistance) return false;
  }
  return true;
}

function canPlace(
  grid: number[][],
  placedMask: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
  rows: number,
  cols: number,
  targetValue: number,
  placedRects: [number, number, number, number][],
  minDistance: number,
): boolean {
  if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
  if (!hasMinDistance(x, y, w, h, placedRects, minDistance)) return false;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const v = grid[row][col];
      if (targetValue === 0 ? v === 0 : v !== targetValue) return false;
      if (placedMask[row][col]) return false;
    }
  }
  return true;
}

function placeRect(
  outputGrid: number[][],
  placedMask: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
  fillValue: number
): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      outputGrid[row][col] = fillValue;
      placedMask[row][col] = true;
    }
  }
}

/**
 * 基于离散程度加权采样锚点。
 * dispersion=0：纯均匀随机（与已放矩形的距离无关）
 * dispersion=1：完全按"距最近已放矩形中心的距离"正比加权，距离越远被选中概率越高
 * 中间值线性插值。
 * 若还没有已放矩形，退化为均匀随机。
 */
function sampleAnchor(
  candidates: [number, number][],
  placedCenters: [number, number][],
  dispersion: number,
  rng: LCG
): [number, number] {
  if (dispersion <= 0 || placedCenters.length === 0) {
    return candidates[rng.intn(candidates.length)];
  }

  // 计算每个候选格到最近已放矩形中心的距离
  const weights = candidates.map(([cx, cy]) => {
    let minDist = Infinity;
    for (const [px, py] of placedCenters) {
      const d = Math.abs(cx - px) + Math.abs(cy - py);
      if (d < minDist) minDist = d;
    }
    // 线性插值：weight = lerp(1, minDist, dispersion)
    // dispersion=0 → weight=1（均匀），dispersion=1 → weight=minDist（距离越远越重）
    return 1 + (minDist - 1) * dispersion;
  });

  // 加权随机采样
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.float() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

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

/** 对单个网格执行矩形放置，返回单值网格列表和名称清单 */
function processOneGrid(
  grid: number[][],
  targetValue: number,
  count: number,
  minSize: number,
  maxSize: number,
  minDistance: number,
  dispersion: number,
  maxAttempts: number,
  seed: number,
): { gridList: number[][][]; nameList: { id: number; name: string; type: string }[] } {
  const rows = grid.length;
  const cols = grid[0].length;

  let maxVal = 0;
  for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;
  let nextFillValue = maxVal + 1;

  const rng = new LCG(seed);
  const placedMask: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  const candidates: [number, number][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = grid[row][col];
      const valid = targetValue === 0 ? v !== 0 : v === targetValue;
      if (valid) candidates.push([col, row]);
    }
  }

  if (candidates.length === 0) return { gridList: [], nameList: [] };

  const placedCenters: [number, number][] = [];
  const placedRects: [number, number, number, number][] = []; // [x, y, w, h]
  const gridList: number[][][] = [];
  const nameList: { id: number; name: string; type: string }[] = [];

  for (let i = 0; i < count; i++) {
    let success = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const [anchorX, anchorY] = sampleAnchor(candidates, placedCenters, dispersion, rng);
      const w = minSize + rng.intn(maxSize - minSize + 1);
      const h = minSize + rng.intn(maxSize - minSize + 1);
      const x = anchorX - rng.intn(w);
      const y = anchorY - rng.intn(h);

      if (canPlace(grid, placedMask, x, y, w, h, rows, cols, targetValue, placedRects, minDistance)) {
        const rectGrid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
        placeRect(rectGrid, placedMask, x, y, w, h, nextFillValue);
        gridList.push(rectGrid);
        nameList.push({ id: nextFillValue, name: `地块 ${nextFillValue}`, type: "tile" });
        placedCenters.push([x + w / 2, y + h / 2]);
        placedRects.push([x, y, w, h]);
        nextFillValue++;
        success = true;
        break;
      }
    }
    void success;
  }

  return { gridList, nameList };
}

export function rectZoneGen(input: Record<string, unknown>): Record<string, unknown> {
  const grids = parseInputGrids(input.grid);
  if (!grids) {
    return { error: "grid is required" };
  }

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue)                    : 0;
  const count       = typeof input.count       === "number" ? Math.max(1, Math.round(input.count))            : 5;
  const minSize     = typeof input.minSize     === "number" ? Math.max(1, Math.round(input.minSize))          : 13;
  const maxSize     = typeof input.maxSize     === "number" ? Math.max(minSize, Math.round(input.maxSize))    : 19;
  const minDistance = typeof input.minDistance === "number" ? Math.max(0, Math.round(input.minDistance))      : 2;
  const dispersion  = typeof input.dispersion  === "number" ? Math.max(0, Math.min(1, input.dispersion))      : 0.6;
  const maxAttempts = 1000;
  const seedRaw     = typeof input.seed        === "number" ? input.seed : 0;
  const baseSeed    = seedRaw === 0 ? Date.now() : seedRaw;
  const doMerge     = input.merge !== false;

  const allGridList: number[][][] = [];
  const allNameList: { id: number; name: string; type: string }[] = [];

  for (let i = 0; i < grids.length; i++) {
    const g = grids[i];
    if (!g || g.length === 0 || g[0].length === 0) continue;
    const { gridList, nameList } = processOneGrid(
      g, targetValue, count, minSize, maxSize, minDistance, dispersion, maxAttempts,
      baseSeed + i * 1000003,
    );
    allGridList.push(...gridList);
    allNameList.push(...nameList);
  }

  // ── 合并模式：地块网格列表保持独立，仅合并名称清单为单条"地块" ────────────
  if (doMerge) {
    if (allGridList.length === 0) {
      return { outputGridList: [], outputNameList: [], placedCount: 0 };
    }
    return {
      outputGridList: allGridList,
      outputNameList: [{ id: 1, name: "地块", type: "tile" }],
      placedCount: allGridList.length,
    };
  }

  // ── 非合并模式：每个地块独立单值网格和独立名称条目 ──────────────────────────
  return { outputGridList: allGridList, outputNameList: allNameList, placedCount: allGridList.length };
}
