/**
 * poiScatter: 在单张网格指定区域值上随机散布兴趣点（POI）。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 单张网格; poiRules (array) — POI规则; seed (number)
 * 输出：outputGrid (grid) — 单张多值网格（每种 POI 一个递增 id）; outputNameList (array); placedCount (number)
 */

type Grid = number[][];

interface PoiRule {
  decoration: string;
  targetValue: number;
  count?: number;
  minDistance?: number;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

interface PlacedPoi {
  x: number;
  y: number;
  id: number;
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

/**
 * 判断 v 是单网格 number[][]：
 *   v[0] 是数组，v[0][0] 是 number（而非数组）
 */
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

/**
 * 判断 v 是网格列表 Grid[]（number[][][]）：
 *   v[0] 是数组，v[0][0] 也是数组（即 v[0] 是一行 number[]，v[0][0] 是 number[] 说明 v[0] 是 Grid）
 *   关键区分：v[0][0] 是 Array 而非 number
 */
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

/**
 * 将各种非合法 JSON 格式修复为合法 JSON，支持：
 * 1. {"名称":1:4:12} 或 {"名称":1,4,12}  → {"名称":"1,4,12"}（值为多段数字）
 * 2. {"名称",1,4,12}                      → {"名称":"1,4,12"}（逗号分隔名称与数字）
 */
function fixPoiRulesString(s: string): string {
  // 格式2：{"名称",1,4,12} → {"名称":"1,4,12"}
  s = s.replace(/\{\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*(\d+(?:\s*[，,]\s*\d+)*)\s*\}/g,
    (_m, name, nums) => `{${name}:"${nums}"}`);
  // 格式1：{"名称":1:4:12} 或 {"名称":1,4,12}（值部分为多段裸数字）
  s = s.replace(/:\s*(\d+(?:\s*[：:，,]\s*\d+)+)\s*([}\]])/g,
    (_m, nums, tail) => `:"${nums}"${tail}`);
  return s;
}

/**
 * 解析 POI 规则，支持两种格式：
 * 简化格式：[{"洞穴":1:4:12}, {"营火":4:8:6}] 或 [{"洞穴":"1,4,12"}]
 *   键=名称，值=targetValue:count:minDistance（冒号或逗号分隔，可加引号可不加）
 * 旧格式：[{decoration, targetValue, count, minDistance}]
 */
function parsePoiRules(raw: unknown): PoiRule[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const fixed = fixPoiRulesString(raw);
    try { arr = JSON.parse(fixed); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];

  return (arr as unknown[]).flatMap((item: unknown) => {
    // 数组格式：["名称", targetValue, count, minDistance]
    if (Array.isArray(item)) {
      const name = typeof item[0] === "string" ? item[0] : "poi";
      const tv  = typeof item[1] === "number" ? item[1] : 1;
      const cnt = typeof item[2] === "number" ? Math.max(1, Math.round(item[2])) : 5;
      const md  = typeof item[3] === "number" ? Math.max(1, item[3]) : 8;
      return [{ decoration: name, targetValue: tv, count: cnt, minDistance: md }];
    }

    let r: Record<string, unknown>;
    if (typeof item === "string") {
      try { r = JSON.parse(item) as Record<string, unknown>; } catch { return []; }
    } else if (item && typeof item === "object") {
      r = item as Record<string, unknown>;
    } else {
      return [];
    }

    // 简化格式：单键对象，键=名称，值为字符串或数字（a:b:c 或 a,b,c）
    if (typeof r.decoration !== "string") {
      const keys = Object.keys(r);
      if (keys.length === 0) return [];
      const name = keys[0];
      const val = r[name];
      // 值拆分：支持冒号、中文冒号、逗号、中文逗号
      const parts = String(val).split(/[：:，,]+/).map(Number);
      return [{
        decoration: name,
        targetValue: isNaN(parts[0]) ? 1 : parts[0],
        count: isNaN(parts[1]) ? 5 : Math.max(1, Math.round(parts[1])),
        minDistance: isNaN(parts[2]) ? 8 : Math.max(1, parts[2]),
      }];
    }

    // 旧格式：{decoration, targetValue, count, minDistance}
    return [{
      decoration: r.decoration as string,
      targetValue: typeof r.targetValue === "number" ? r.targetValue : 1,
      count: typeof r.count === "number" ? Math.max(1, Math.round(r.count)) : 5,
      minDistance: typeof r.minDistance === "number" ? Math.max(1, r.minDistance) : 8,
    }];
  });
}

/**
 * 在单个网格上按规则散布 POI 点。
 * allPlaced 用于跨规则的间距约束（传入时已包含之前规则放置的点）。
 */
function scatterOnGrid(
  grid: Grid,
  rules: PoiRule[],
  baseId: number,
  maxAttempts: number,
  rng: LCG,
): { outputGrid: Grid; placed: PlacedPoi[]; nameList: NameEntry[]; count: number } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const out: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const allPlaced: PlacedPoi[] = [];
  const nameList: NameEntry[] = [];
  let totalCount = 0;
  let currentId = baseId;

  for (const rule of rules) {
    const poiId = currentId++;
    const count = rule.count ?? 5;
    const minDist = rule.minDistance ?? 8;
    const minDist2 = minDist * minDist;
    let placed = 0;

    for (let idx = 0; idx < count; idx++) {
      let found = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = rng.int(0, cols - 1);
        const y = rng.int(0, rows - 1);

        if (grid[y][x] !== rule.targetValue) continue;

        const tooClose = allPlaced.some(p => {
          const dx = p.x - x, dy = p.y - y;
          return dx * dx + dy * dy < minDist2;
        });
        if (tooClose) continue;

        out[y][x] = poiId;
        allPlaced.push({ x, y, id: poiId });
        found = true;
        break;
      }
      if (found) placed++;
    }

    if (placed > 0) {
      nameList.push({ id: poiId, name: rule.decoration, type: "asset" });
      totalCount += placed;
    }
  }

  return { outputGrid: out, placed: allPlaced, nameList, count: totalCount };
}

const MAX_ATTEMPTS = 1000;

export function poiScatter(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  const rawRules = input.poiRules;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  if (!isGrid(rawGrid)) return { error: "inputGrid is required (number[][])" };
  const grid = rawGrid as Grid;

  const rules = parsePoiRules(rawRules);
  if (rules.length === 0) return { error: "poiRules must be a non-empty array of {decoration, targetValue}" };

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);
  const baseId = gridMax(grid) + 1;

  // 单张多值网格：每种 POI 一个递增 id
  const { outputGrid, nameList, count } = scatterOnGrid(grid, rules, baseId, MAX_ATTEMPTS, rng);

  // 仅保留实际写入网格的 POI 条目
  const present = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) present.add(v);
  const outputNameList: NameEntry[] = nameList.filter(e => present.has(e.id));

  return { outputGrid, outputNameList, placedCount: count };
}
