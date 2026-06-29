/**
 * poiPlace: 在指定坐标放置兴趣点（POI）。
 * 若坐标格子的值不等于 targetValue，则 BFS 搜索整个网格找最近的合法格子，从等距候选格中随机选取。
 * 输入：grid (any) — 单/列表网格; poiRules (array) — [{decoration, targetValue, points: [[x,y],...]}]; seed
 * 输出：outputGrid (any); poiNameList (array); placedCount (number)
 */

type Grid = number[][];

interface PlaceRule {
  decoration: string;
  targetValue: number;
  points: Array<[number, number]>;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

function isGridList(v: unknown): v is Grid[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return Array.isArray((first as unknown[])[0]);
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

function parsePointList(rawPoints: unknown): Array<[number, number]> {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return [];
  return (rawPoints as unknown[]).flatMap(p => {
    let arr: unknown = p;
    if (typeof p === "string") {
      try { arr = JSON.parse(p); } catch { return []; }
    }
    if (Array.isArray(arr) && arr.length >= 2) {
      const x = Number(arr[0]), y = Number(arr[1]);
      if (!isNaN(x) && !isNaN(y)) return [[Math.round(x), Math.round(y)] as [number, number]];
    }
    return [];
  });
}

function parseRuleItem(r: Record<string, unknown>): PlaceRule | null {
  const decoration = typeof r.decoration === "string" ? r.decoration : "poi";
  const targetValue = typeof r.targetValue === "number" ? r.targetValue : 1;
  const points = parsePointList(r.points);
  if (points.length === 0) return null;
  return { decoration, targetValue, points };
}

/**
 * 解析 POI 规则，支持两种格式：
 * 简化格式（数组）：["名称", targetValue, [x1,y1], [x2,y2], ...]
 * 旧格式（对象）：{decoration, targetValue, points: [[x,y],...]}
 */
function parsePlaceRules(raw: unknown): PlaceRule[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];

  return (arr as unknown[]).flatMap((item: unknown) => {
    // 简化格式：["名称", targetValue, [x1,y1], [x2,y2], ...]
    if (Array.isArray(item)) {
      const name = typeof item[0] === "string" ? item[0] : "poi";
      const tv = typeof item[1] === "number" ? item[1] : 1;
      const points = parsePointList(item.slice(2));
      if (points.length === 0) return [];
      return [{ decoration: name, targetValue: tv, points }];
    }

    // 旧格式：{decoration, targetValue, points}
    let r: Record<string, unknown>;
    if (typeof item === "string") {
      try { r = JSON.parse(item) as Record<string, unknown>; } catch { return []; }
    } else if (item && typeof item === "object") {
      r = item as Record<string, unknown>;
    } else {
      return [];
    }
    const rule = parseRuleItem(r);
    return rule ? [rule] : [];
  });
}

interface PlacedPoint { x: number; y: number; }

/**
 * 找最近落点并放置：
 * 1. 扫全图收集所有 targetValue 格子
 * 2. 过滤掉距离已放置 POI 不足 minDistance 的格子
 * 3. 找最近格子，在 minDist+scatterR 范围内收集候选格
 * 4. 随机选一个
 */
function findAndPlace(
  grid: Grid,
  placed: PlacedPoint[],
  cx: number,
  cy: number,
  targetValue: number,
  scatterR: number,
  minDistance: number,
  rng: LCG,
): PlacedPoint | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const minDist2 = minDistance * minDistance;

  // 收集所有 targetValue 格子，过滤距离已放置点太近的
  const avail: Array<{ x: number; y: number; dist2: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== targetValue) continue;
      const tooClose = placed.some(p => {
        const dx = p.x - x, dy = p.y - y;
        return dx * dx + dy * dy < minDist2;
      });
      if (tooClose) continue;
      const dx = x - cx, dy = y - cy;
      avail.push({ x, y, dist2: dx * dx + dy * dy });
    }
  }
  if (avail.length === 0) return null;

  // 找最近距离
  let nearestDist = Math.sqrt(avail[0].dist2);
  for (const c of avail) {
    const d = Math.sqrt(c.dist2);
    if (d < nearestDist) nearestDist = d;
  }

  // 在 [nearestDist, nearestDist + scatterR] 范围内收集候选格
  const maxDist = nearestDist + scatterR;
  const candidates = avail.filter(c => Math.sqrt(c.dist2) <= maxDist);

  return candidates[rng.int(0, candidates.length - 1)];
}

/**
 * Try placing a point with progressively relaxed minDistance until it succeeds.
 * Relaxation steps: minDistance -> minDistance*0.5 -> minDistance*0.25 -> 1 -> 0 (allow overlap).
 * This guarantees every point is placed even on tiny grids.
 */
function placeWithFallback(
  grid: Grid,
  placed: PlacedPoint[],
  px: number,
  py: number,
  targetValue: number,
  scatterR: number,
  minDistance: number,
  rng: LCG,
): PlacedPoint | null {
  const relaxSteps = [minDistance, minDistance * 0.5, minDistance * 0.25, 1, 0];
  for (const dist of relaxSteps) {
    const chosen = findAndPlace(grid, placed, px, py, targetValue, scatterR, dist, rng);
    if (chosen) return chosen;
  }
  return null;
}

function placeOnGrid(
  grid: Grid,
  rules: PlaceRule[],
  baseId: number,
  scatterR: number,
  minDistance: number,
  rng: LCG,
): { outputGrid: Grid; nameList: NameEntry[]; count: number } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const out: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const nameMap = new Map<string, number>();
  let currentId = baseId;
  let totalCount = 0;
  const placed: PlacedPoint[] = [];

  for (const rule of rules) {
    if (!nameMap.has(rule.decoration)) {
      nameMap.set(rule.decoration, currentId++);
    }
    const poiId = nameMap.get(rule.decoration)!;

    for (const [px, py] of rule.points) {
      const chosen = placeWithFallback(grid, placed, px, py, rule.targetValue, scatterR, minDistance, rng);
      if (!chosen) continue;
      placed.push(chosen);
      out[chosen.y][chosen.x] = poiId;
      totalCount++;
    }
  }

  const nameList: NameEntry[] = [...nameMap.entries()].map(([name, id]) => ({ id, name, type: "asset" }));
  return { outputGrid: out, nameList, count: totalCount };
}

export function poiPlace(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.grid;
  const rawRules = input.poiRules;
  const scatterR = typeof input.scatterR === "number" ? Math.max(0, input.scatterR) : 5;
  const minDistance = typeof input.minDistance === "number" ? Math.max(1, input.minDistance) : 8;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  if (rawGrid == null) return { error: "grid is required" };

  const rules = parsePlaceRules(rawRules);
  if (rules.length === 0) return { error: "poiRules must be a non-empty array of {decoration, targetValue, points: [[x,y],...]}" };

  // 统一转换为网格列表
  let gridList: Grid[];
  if (isGridList(rawGrid)) {
    gridList = rawGrid as Grid[];
  } else if (isGrid(rawGrid)) {
    gridList = [rawGrid as Grid];
  } else {
    return { error: "grid must be a 2D grid (number[][]) or a list of 2D grids (number[][][])" };
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  let maxVal = 0;
  for (const g of gridList) { const m = gridMax(g); if (m > maxVal) maxVal = m; }
  const globalBaseId = maxVal + 1;

  const outputGridList: Grid[] = [];
  const outputNameList: NameEntry[] = [];
  let totalCount = 0;

  for (let i = 0; i < gridList.length; i++) {
    const rng = new LCG(baseSeed + i * 999983);
    const baseId = globalBaseId + i * rules.length;
    const { outputGrid, nameList, count } = placeOnGrid(gridList[i], rules, baseId, scatterR, minDistance, rng);
    totalCount += count;

    // 每种 POI 单独拆出一张单值网格，与 outputNameList 一一对应
    const rows = outputGrid.length;
    const cols = outputGrid[0]?.length ?? 0;
    for (const entry of nameList) {
      const single: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (outputGrid[r][c] === entry.id) single[r][c] = entry.id;
        }
      }
      outputGridList.push(single);
      outputNameList.push(entry);
    }
  }

  return { outputGridList, outputNameList, placedCount: totalCount };
}
