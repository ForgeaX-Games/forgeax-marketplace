/**
 * roadConnectLink: 将一组 POI 点用连连看式折线路径全部连通，同时绕开障碍物。
 *
 * 算法流程：
 *   1. Prim 最小生成树：决定哪些点对需要连线（N个点只需 N-1 条边）
 *   2. 连连看寻路：两点间最多允许 maxTurns 次转弯，优先尝试 0转弯（直线）→ 1转弯（L形）→ 2转弯（Z/S形）
 *      若连连看路径找不到（障碍过多），降级为 A* 寻路兜底
 *   3. 路宽膨胀：把1格宽路径扩展到 roadWidth 格宽
 *   4. 写入输出 grid：道路格写入 roadValue
 *
 * 连连看路径特点：
 *   - 0转弯：两点同行或同列，中间无障碍，直线连通
 *   - 1转弯：经过一个中间拐点 (r1,c2) 或 (r2,c1)，两段都无障碍
 *   - 2转弯：经过一个空白行或列作为"中继通道"，形成 Z/S/U 形路径
 *
 * 输入：
 *   poiGrid      (grid)   — POI 网格，自动取最大值格子作为连接点（无需手动指定 poiValue）
 *   obstacleGrid (grid)   — 障碍物网格，非零格不可通行（可选，不传则以 poiGrid 尺寸建空白障碍）
 *   roadWidth    (number) — 道路宽度（格），默认 1
 *   roadValue    (number) — 道路写入的值，默认 1
 *   maxTurns     (number) — 最大转弯次数，默认 2
 *
 * 输出：
 *   outputGrid   (grid)   — 道路网格，道路格=roadValue，其余=0
 */

type Grid = number[][];
type Point = { x: number; y: number };

interface NameEntry { id: number; name: string; type: string; }

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

// ─── Prim 最小生成树 ──────────────────────────────────────────────────────────

function primMST(points: Point[]): [number, number][] {
  const n = points.length;
  if (n <= 1) return [];

  const inMST = new Uint8Array(n);
  const minDist = new Float32Array(n).fill(Infinity);
  const minFrom = new Int32Array(n).fill(-1);
  const edges: [number, number][] = [];

  minDist[0] = 0;

  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minDist[i] < minDist[u])) u = i;
    }
    inMST[u] = 1;
    if (minFrom[u] !== -1) edges.push([minFrom[u], u]);

    for (let v = 0; v < n; v++) {
      if (inMST[v]) continue;
      const d = Math.abs(points[u].x - points[v].x) + Math.abs(points[u].y - points[v].y);
      if (d < minDist[v]) {
        minDist[v] = d;
        minFrom[v] = u;
      }
    }
  }

  return edges;
}

// ─── 障碍检测辅助 ─────────────────────────────────────────────────────────────

/**
 * 检查从 (r1,c1) 到 (r2,c2) 的直线段中间是否无障碍（两端点本身跳过，POI点位值非零但不是障碍）。
 */
function isLineClear(
  r1: number, c1: number,
  r2: number, c2: number,
  obstacle: Grid,
  rows: number, cols: number
): boolean {
  if (r1 === r2) {
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);
    for (let c = minC + 1; c < maxC; c++) {
      if (c < 0 || c >= cols) return false;
      if (obstacle[r1][c] !== 0) return false;
    }
    return true;
  }
  if (c1 === c2) {
    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    for (let r = minR + 1; r < maxR; r++) {
      if (r < 0 || r >= rows) return false;
      if (obstacle[r][c1] !== 0) return false;
    }
    return true;
  }
  return false;
}

/**
 * 检查某行的一段横向区间 [minC, maxC] 是否全部无障碍（跳过两端端点）。
 */
function isRowSegClear(
  row: number, minC: number, maxC: number,
  obstacle: Grid, cols: number,
  skipC1 = -1, skipC2 = -1
): boolean {
  if (row < 0 || row >= obstacle.length) return false;
  for (let c = minC; c <= maxC; c++) {
    if (c < 0 || c >= cols) return false;
    if (c === skipC1 || c === skipC2) continue; // 端点是POI点，跳过障碍检查
    if (obstacle[row][c] !== 0) return false;
  }
  return true;
}

/**
 * 检查某列的一段纵向区间 [minR, maxR] 是否全部无障碍（跳过两端端点）。
 */
function isColSegClear(
  col: number, minR: number, maxR: number,
  obstacle: Grid, rows: number,
  skipR1 = -1, skipR2 = -1
): boolean {
  if (col < 0 || col >= (obstacle[0]?.length ?? 0)) return false;
  for (let r = minR; r <= maxR; r++) {
    if (r < 0 || r >= rows) return false;
    if (r === skipR1 || r === skipR2) continue; // 端点是POI点，跳过障碍检查
    if (obstacle[r][col] !== 0) return false;
  }
  return true;
}

// ─── 路径生成工具 ─────────────────────────────────────────────────────────────

/** 生成从 (r1,c1) 到 (r2,c2) 的横向或纵向直线段格子列表（含两端）。*/
function lineCells(r1: number, c1: number, r2: number, c2: number): [number, number][] {
  const cells: [number, number][] = [];
  if (r1 === r2) {
    const step = c1 <= c2 ? 1 : -1;
    for (let c = c1; c !== c2 + step; c += step) cells.push([r1, c]);
  } else if (c1 === c2) {
    const step = r1 <= r2 ? 1 : -1;
    for (let r = r1; r !== r2 + step; r += step) cells.push([r, c1]);
  }
  return cells;
}

// ─── 连连看寻路（最多 maxTurns 次转弯）────────────────────────────────────────

/**
 * 连连看路径寻路。
 * - 0 转弯：直线（同行或同列）
 * - 1 转弯：L形，经过拐点 (r1,c2) 或 (r2,c1)
 * - 2 转弯：Z/S/U 形，在地图边界或空白行/列中选中继通道
 * 找到则返回路径格子列表（含起终点），找不到返回 null。
 */
function linkPath(
  r1: number, c1: number,
  r2: number, c2: number,
  obstacle: Grid,
  rows: number, cols: number,
  maxTurns: number
): [number, number][] | null {

  // 0 转弯：直线
  if (r1 === r2 || c1 === c2) {
    if (isLineClear(r1, c1, r2, c2, obstacle, rows, cols)) {
      return lineCells(r1, c1, r2, c2);
    }
  }

  if (maxTurns < 1) return null;

  // 1 转弯：L 形，两个候选拐点（拐点是空白中间格，不是POI端点，必须无障碍）
  const corners1: [number, number][] = [
    [r1, c2], // 先横后竖
    [r2, c1], // 先竖后横
  ];
  for (const [mr, mc] of corners1) {
    if (mr < 0 || mr >= rows || mc < 0 || mc >= cols) continue;
    if (obstacle[mr][mc] !== 0) continue;
    if (
      isLineClear(r1, c1, mr, mc, obstacle, rows, cols) &&
      isLineClear(mr, mc, r2, c2, obstacle, rows, cols)
    ) {
      return [...lineCells(r1, c1, mr, mc), ...lineCells(mr, mc, r2, c2).slice(1)];
    }
  }

  if (maxTurns < 2) return null;

  // 2 转弯：Z/S/U 形
  // 扫描所有可行的中继行和中继列，选总路径格子数最少的（最短路径），避免绕远
  let bestPath: [number, number][] | null = null;
  let bestLen = Infinity;

  const tryPath = (path: [number, number][]) => {
    if (path.length < bestLen) {
      bestLen = path.length;
      bestPath = path;
    }
  };

  // 候选中继行：竖→横→竖，路径总长 = |r1-mr| + |c1-c2| + |mr-r2|
  for (let mr = 0; mr < rows; mr++) {
    if (
      isColSegClear(c1, Math.min(r1, mr), Math.max(r1, mr), obstacle, rows, r1, mr) &&
      isRowSegClear(mr, Math.min(c1, c2), Math.max(c1, c2), obstacle, cols) &&
      isColSegClear(c2, Math.min(mr, r2), Math.max(mr, r2), obstacle, rows, mr, r2)
    ) {
      const seg1 = lineCells(r1, c1, mr, c1);
      const seg2 = lineCells(mr, c1, mr, c2);
      const seg3 = lineCells(mr, c2, r2, c2);
      tryPath([...seg1, ...seg2.slice(1), ...seg3.slice(1)]);
    }
  }

  // 候选中继列：横→竖→横，路径总长 = |c1-mc| + |r1-r2| + |mc-c2|
  for (let mc = 0; mc < cols; mc++) {
    if (
      isRowSegClear(r1, Math.min(c1, mc), Math.max(c1, mc), obstacle, cols, c1, mc) &&
      isColSegClear(mc, Math.min(r1, r2), Math.max(r1, r2), obstacle, rows) &&
      isRowSegClear(r2, Math.min(mc, c2), Math.max(mc, c2), obstacle, cols, mc, c2)
    ) {
      const seg1 = lineCells(r1, c1, r1, mc);
      const seg2 = lineCells(r1, mc, r2, mc);
      const seg3 = lineCells(r2, mc, r2, c2);
      tryPath([...seg1, ...seg2.slice(1), ...seg3.slice(1)]);
    }
  }

  if (bestPath) return bestPath;
  return null;
}

// ─── A* 兜底寻路 ──────────────────────────────────────────────────────────────

class MinHeap {
  private heap: [number, number][] = [];

  push(f: number, id: number) {
    this.heap.push([f, id]);
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): [number, number] | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() { return this.heap.length; }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent][0] <= this.heap[i][0]) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l][0] < this.heap[smallest][0]) smallest = l;
      if (r < n && this.heap[r][0] < this.heap[smallest][0]) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

function aStar(
  startR: number, startC: number,
  endR: number, endC: number,
  obstacle: Grid,
  rows: number, cols: number
): [number, number][] {
  const id = (r: number, c: number) => r * cols + c;
  const h = (r: number, c: number) => Math.abs(r - endR) + Math.abs(c - endC);

  const gScore = new Float32Array(rows * cols).fill(Infinity);
  const parent = new Int32Array(rows * cols).fill(-1);
  const startId = id(startR, startC);
  const endId = id(endR, endC);

  gScore[startId] = 0;
  const open = new MinHeap();
  open.push(h(startR, startC), startId);

  while (open.size > 0) {
    const [, cur] = open.pop()!;
    if (cur === endId) break;

    const cr = Math.floor(cur / cols);
    const cc = cur % cols;
    const curG = gScore[cur];

    for (let d = 0; d < 4; d++) {
      const nr = cr + DR[d];
      const nc = cc + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nid = id(nr, nc);
      if (nid !== endId && obstacle[nr][nc] !== 0) continue;
      const ng = curG + 1;
      if (ng < gScore[nid]) {
        gScore[nid] = ng;
        parent[nid] = cur;
        open.push(ng + h(nr, nc), nid);
      }
    }
  }

  if (gScore[endId] === Infinity) return [];
  const path: [number, number][] = [];
  let cur = endId;
  while (cur !== -1) {
    path.push([Math.floor(cur / cols), cur % cols]);
    cur = parent[cur];
  }
  return path.reverse();
}

// ─── 路宽膨胀 ─────────────────────────────────────────────────────────────────

function dilateRoad(
  roadGrid: Grid, obstacle: Grid,
  rows: number, cols: number,
  roadValue: number, roadWidth: number
): Grid {
  if (roadWidth <= 1) return roadGrid;
  const radius = Math.floor(roadWidth / 2);
  const result: Grid = roadGrid.map((r) => [...r]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (roadGrid[r][c] !== roadValue) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (obstacle[nr][nc] !== 0) continue;
          result[nr][nc] = roadValue;
        }
      }
    }
  }
  return result;
}

// ─── 辅助：网格最大值 ─────────────────────────────────────────────────────────

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

// ─── 从 POI 网格中提取点坐标 ──────────────────────────────────────────────────

function extractPoints(poiGrid: Grid, poiValue: number): Point[] {
  const points: Point[] = [];
  for (let r = 0; r < poiGrid.length; r++) {
    for (let c = 0; c < poiGrid[r].length; c++) {
      if (poiGrid[r][c] === poiValue) {
        points.push({ x: c, y: r });
      }
    }
  }
  return points;
}

// ─── 对单个 poiGrid 执行连连看道路生成 ──────────────────────────────────────

function processOnePoi(
  poiGrid: Grid,
  obstacle: Grid,
  rows: number,
  cols: number,
  roadWidth: number,
  roadValue: number,
): Grid {
  const poiValue = gridMax(poiGrid);
  const pois = extractPoints(poiGrid, poiValue);

  const roadGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (pois.length === 0) return roadGrid;

  if (pois.length === 1) {
    roadGrid[pois[0].y][pois[0].x] = roadValue;
  } else {
    const edges = primMST(pois);
    for (const [i, j] of edges) {
      const pa = pois[i];
      const pb = pois[j];
      let path = linkPath(pa.y, pa.x, pb.y, pb.x, obstacle, rows, cols, 2);
      if (!path || path.length === 0) {
        path = aStar(pa.y, pa.x, pb.y, pb.x, obstacle, rows, cols);
      }
      for (const [r, c] of path) roadGrid[r][c] = roadValue;
    }
  }

  return dilateRoad(roadGrid, obstacle, rows, cols, roadValue, roadWidth);
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

export function roadConnectLink(input: Record<string, unknown>): Record<string, unknown> {
  const poiGrids = parseInputGrids(input.poiGrid);
  if (!poiGrids) {
    return { error: "poiGrid is required" };
  }

  const roadWidth = typeof input.roadWidth === "number" ? Math.max(1, Math.round(input.roadWidth)) : 1;
  const roadValue = typeof input.roadValue === "number" ? Math.round(input.roadValue) : 1;

  // obstacleGrid 仅支持单个（障碍物对所有输入共享）
  let obstacle: Grid | null = null;
  let sharedRows = 0, sharedCols = 0;
  const obstacleGrid = input.obstacleGrid as Grid | undefined;
  if (Array.isArray(obstacleGrid) && obstacleGrid.length > 0 && obstacleGrid[0].length > 0) {
    obstacle = obstacleGrid;
    sharedRows = obstacle.length;
    sharedCols = obstacle[0].length;
  }

  const outputGridList: Grid[] = [];
  for (const poiGrid of poiGrids) {
    if (!poiGrid || poiGrid.length === 0 || poiGrid[0].length === 0) continue;
    const rows = obstacle ? sharedRows : poiGrid.length;
    const cols = obstacle ? sharedCols : poiGrid[0].length;
    const obs = obstacle ?? Array.from({ length: rows }, () => new Array(cols).fill(0));
    outputGridList.push(processOnePoi(poiGrid, obs, rows, cols, roadWidth, roadValue));
  }

  const outputNameList: NameEntry[] = [
    { id: roadValue, name: "道路", type: "tile" },
  ];

  return { outputGridList, outputNameList };
}
