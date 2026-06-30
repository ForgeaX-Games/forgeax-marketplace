/**
 * naturalDecoration: 按装饰物清单对输入网格多轮填充自然装饰物
 * 自动将各网格所有非零格子作为目标区域；输出网格只含装饰物格子，其余清零。
 * 输入：grid (array) — 输入网格，支持单个二维网格或网格数组（兼容旧键 gridList）;
 *       decorations (array) — [{name, density},...] 或 [{名称: 密度}, ...] 简化格式;
 *       algorithm (string); seed (number); densityMode (boolean, default true)
 * 输出：outputGridList (array) — 多个单值网格平铺列表（每种装饰物一张，仅含该 id 与 0）；
 *       nameListList (array) — 与输入网格一一对应；名称项含 { id, name, type: "asset" }
 */

type RandFn = () => number;

interface DecorationEntry {
  name: string;
  density: number;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

function seededRandom(seed: number): RandFn {
  let s = seed >>> 0;
  if (s === 0) s = 12345;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// 收集网格中所有非零格子（作为目标区域）
function collectNonZeroCells(grid: number[][]): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) {
        cells.push([r, c]);
      }
    }
  }
  return cells;
}

function shuffle<T>(arr: T[], rand: RandFn): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillRandom(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  density: number,
  rand: RandFn
): void {
  const prob = density / 100;
  for (const [r, c] of cells) {
    if (rand() < prob) {
      output[r][c] = fillValue;
    }
  }
}

function fillCluster(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  density: number,
  rand: RandFn
): void {
  if (cells.length === 0) return;

  const targetCount = Math.round((cells.length * density) / 100);
  const clusterCount = Math.max(1, Math.round(targetCount / 6));
  const radius = 4;

  const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
  const shuffled = shuffle(cells, rand);
  const centers = shuffled.slice(0, clusterCount);

  const placed = new Set<string>();
  for (const [cr, cc] of centers) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist > radius) continue;
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (!cellSet.has(key) || placed.has(key)) continue;
        const prob = (1 - dist / (radius + 1)) * (density / 100) * 2;
        if (rand() < prob) {
          placed.add(key);
          output[nr][nc] = fillValue;
        }
      }
    }
    if (placed.size >= targetCount) break;
  }
}

function fillEdge(
  output: number[][],
  cells: [number, number][],
  occupiedSet: Set<string>,
  fillValue: number,
  density: number,
  rand: RandFn
): void {
  const rows = output.length;
  const cols = output[0].length;
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const edgeCells: [number, number][] = [];
  const innerCells: [number, number][] = [];

  for (const [r, c] of cells) {
    let isEdge = false;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      // 边缘：相邻格越界或不在目标区域内
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !occupiedSet.has(`${nr},${nc}`)) {
        isEdge = true;
        break;
      }
    }
    if (isEdge) edgeCells.push([r, c]);
    else innerCells.push([r, c]);
  }

  const edgeProb = Math.min(1, (density / 100) * 2);
  const innerProb = Math.max(0, (density / 100) * 0.3);

  for (const [r, c] of edgeCells) {
    if (rand() < edgeProb) output[r][c] = fillValue;
  }
  for (const [r, c] of innerCells) {
    if (rand() < innerProb) output[r][c] = fillValue;
  }
}

function hashNoise(r: number, c: number, seed: number): number {
  let h = seed ^ (r * 374761393) ^ (c * 668265263);
  h = (Math.imul(h, 1540483477) + 0x6b43a9b5) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (Math.imul(h, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h, 0xc2b2ae3d)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

function fillNoise(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  density: number,
  seed: number
): void {
  const noiseSeed = seed === 0 ? 42 : seed;
  const threshold = 1 - density / 100;
  for (const [r, c] of cells) {
    if (hashNoise(r, c, noiseSeed) > threshold) {
      output[r][c] = fillValue;
    }
  }
}

function fillPoisson(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  density: number,
  rand: RandFn
): void {
  if (cells.length === 0) return;

  const minDist = Math.max(1.5, 8 - (density / 100) * 6);
  const minDist2 = minDist * minDist;

  const shuffled = shuffle(cells, rand);
  const placed: [number, number][] = [];

  for (const [r, c] of shuffled) {
    let tooClose = false;
    for (const [pr, pc] of placed) {
      const dr = r - pr;
      const dc = c - pc;
      if (dr * dr + dc * dc < minDist2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      placed.push([r, c]);
      output[r][c] = fillValue;
    }
  }
}

// ——— 数量模式填充函数 ———

function fillRandomCount(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  count: number,
  rand: RandFn
): void {
  const n = Math.min(count, cells.length);
  if (n <= 0) return;
  const shuffled = shuffle(cells, rand);
  for (let i = 0; i < n; i++) {
    const [r, c] = shuffled[i];
    output[r][c] = fillValue;
  }
}

function fillClusterCount(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  count: number,
  rand: RandFn
): void {
  if (cells.length === 0 || count <= 0) return;
  const targetCount = Math.min(count, cells.length);
  const clusterCount = Math.max(1, Math.round(targetCount / 6));
  const radius = 4;

  const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
  const shuffled = shuffle(cells, rand);
  const centers = shuffled.slice(0, clusterCount);

  // Build scored candidates
  const scores = new Map<string, number>();
  for (const [cr, cc] of centers) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist > radius) continue;
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (!cellSet.has(key)) continue;
        const score = (1 - dist / (radius + 1)) + rand() * 0.2;
        if (!scores.has(key) || scores.get(key)! < score) {
          scores.set(key, score);
        }
      }
    }
  }

  // Sort by score descending and place top N
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < targetCount && i < sorted.length; i++) {
    const [key] = sorted[i];
    const [rs, cs] = key.split(",").map(Number);
    output[rs][cs] = fillValue;
  }
}

function fillEdgeCount(
  output: number[][],
  cells: [number, number][],
  occupiedSet: Set<string>,
  fillValue: number,
  count: number,
  rand: RandFn
): void {
  if (cells.length === 0 || count <= 0) return;
  const rows = output.length;
  const cols = output[0].length;
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const edgeCells: [number, number][] = [];
  const innerCells: [number, number][] = [];
  for (const [r, c] of cells) {
    let isEdge = false;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !occupiedSet.has(`${nr},${nc}`)) {
        isEdge = true;
        break;
      }
    }
    if (isEdge) edgeCells.push([r, c]);
    else innerCells.push([r, c]);
  }

  // Prefer edge cells first, then inner cells to reach exact count
  const n = Math.min(count, cells.length);
  const edgeShuffled = shuffle(edgeCells, rand);
  const innerShuffled = shuffle(innerCells, rand);
  const candidates = [...edgeShuffled, ...innerShuffled];
  for (let i = 0; i < n; i++) {
    const [r, c] = candidates[i];
    output[r][c] = fillValue;
  }
}

function fillNoiseCount(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  count: number,
  seed: number
): void {
  if (cells.length === 0 || count <= 0) return;
  const noiseSeed = seed === 0 ? 42 : seed;
  // Sort cells by noise value descending, place top N
  const scored = cells.map(([r, c]) => ({ r, c, n: hashNoise(r, c, noiseSeed) }));
  scored.sort((a, b) => b.n - a.n);
  const n = Math.min(count, scored.length);
  for (let i = 0; i < n; i++) {
    output[scored[i].r][scored[i].c] = fillValue;
  }
}

function fillPoissonCount(
  output: number[][],
  cells: [number, number][],
  fillValue: number,
  count: number,
  rand: RandFn
): void {
  if (cells.length === 0 || count <= 0) return;
  // Derive minDist from count vs area so spacing is roughly even
  const area = cells.length;
  const minDist = Math.max(1.0, Math.sqrt(area / (count * Math.PI)));
  const minDist2 = minDist * minDist;

  const shuffled = shuffle(cells, rand);
  const placed: [number, number][] = [];
  for (const [r, c] of shuffled) {
    if (placed.length >= count) break;
    let tooClose = false;
    for (const [pr, pc] of placed) {
      const dr = r - pr;
      const dc = c - pc;
      if (dr * dr + dc * dc < minDist2) { tooClose = true; break; }
    }
    if (!tooClose) {
      placed.push([r, c]);
      output[r][c] = fillValue;
    }
  }
  // If Poisson couldn't place enough due to spacing, fill remainder randomly
  if (placed.length < count) {
    const placedSet = new Set(placed.map(([r, c]) => `${r},${c}`));
    const remaining = shuffled.filter(([r, c]) => !placedSet.has(`${r},${c}`) && output[r][c] === 0);
    const need = count - placed.length;
    for (let i = 0; i < need && i < remaining.length; i++) {
      const [r, c] = remaining[i];
      output[r][c] = fillValue;
    }
  }
}

function maxGrid(grid: number[][]): number {
  let m = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > m) m = v;
    }
  }
  return m;
}

function processGrid(
  grid: number[][],
  decorations: DecorationEntry[],
  algorithm: string,
  seed: number,
  densityMode: boolean
): { outputGrid: number[][]; nameList: NameEntry[] } {
  // 全零输出网格，只写入装饰物
  const output: number[][] = grid.map((row) => row.map(() => 0));

  const baseID = maxGrid(grid) + 1;
  const nameList: NameEntry[] = [];
  let currentID = baseID;

  // 目标区域：所有非零格子
  let remainingCells = collectNonZeroCells(grid);
  // 用于 edge 算法判断原始目标区域边界
  const occupiedSet = new Set(remainingCells.map(([r, c]) => `${r},${c}`));

  const rand = seed !== 0 ? seededRandom(seed) : () => Math.random();

  for (const dec of decorations) {
    if (remainingCells.length === 0) break;

    const rawValue = typeof dec.density === "number" ? dec.density : 30;
    const name = typeof dec.name === "string" ? dec.name : `decoration_${currentID}`;

    if (rawValue > 0) {
      const fillValue = currentID;
      if (densityMode) {
        // 密度模式：rawValue 是百分比 (0-100)
        const density = Math.max(0, Math.min(100, rawValue));
        switch (algorithm) {
          case "cluster":
            fillCluster(output, remainingCells, fillValue, density, rand);
            break;
          case "edge":
            fillEdge(output, remainingCells, occupiedSet, fillValue, density, rand);
            break;
          case "noise":
            fillNoise(output, remainingCells, fillValue, density, seed);
            break;
          case "poisson":
            fillPoisson(output, remainingCells, fillValue, density, rand);
            break;
          case "random":
          default:
            fillRandom(output, remainingCells, fillValue, density, rand);
            break;
        }
      } else {
        // 数量模式：rawValue 是准确的格子数量
        const count = Math.max(0, Math.floor(rawValue));
        switch (algorithm) {
          case "cluster":
            fillClusterCount(output, remainingCells, fillValue, count, rand);
            break;
          case "edge":
            fillEdgeCount(output, remainingCells, occupiedSet, fillValue, count, rand);
            break;
          case "noise":
            fillNoiseCount(output, remainingCells, fillValue, count, seed);
            break;
          case "poisson":
            fillPoissonCount(output, remainingCells, fillValue, count, rand);
            break;
          case "random":
          default:
            fillRandomCount(output, remainingCells, fillValue, count, rand);
            break;
        }
      }
    }

    nameList.push({ id: currentID, name, type: "asset" });
    currentID++;

    // 下一轮只在未被写入装饰物的格子中继续
    remainingCells = remainingCells.filter(([r, c]) => output[r][c] === 0);
  }

  return { outputGrid: output, nameList };
}

/**
 * 归一化输入网格：支持单个 number[][] 或 number[][][]。
 */
function normalizeGridList(raw: unknown): number[][][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (Array.isArray(first) && (first.length === 0 || !Array.isArray(first[0]))) {
    return [raw as number[][]];
  }
  return raw as number[][][];
}

/**
 * 装饰物端口：数组原样返回；字符串则转为列表再解析。
 * - 优先 `JSON.parse` 为数组（如 `"[{\\"树木\\":40}]"`）
 * - 解析失败时按逗号/顿号/分号等切分，支持 `名称:密度` 或 `名称=密度`，无密度则默认 30
 */
function normalizeDecorationsInput(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (s === "") return [];
  try {
    const parsed: unknown = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 非 JSON 数组，走分隔符拆分
  }
  const parts = s.split(/[,，、;；\n\r|]+/).map(p => p.trim()).filter(Boolean);
  return parts.map(part => {
    const m = part.match(/^(.+?)[:=：]\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const name = m[1].trim();
      const dens = Math.min(100, Math.max(0, Math.round(Number(m[2]))));
      return { [name]: dens };
    }
    return { [part]: 30 };
  });
}

/**
 * 解析装饰物清单：
 * - 简化格式：[{ "树木": 30 }, { "花草": 20 }]（单键对象，键=name，值=density）
 * - 兼容旧格式：[{ name: "树木", density: 30 }, ...]
 */
function parseDecorations(raw: unknown): DecorationEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: DecorationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name === "string") {
      const d = typeof o.density === "number" ? o.density : 30;
      out.push({
        name: o.name,
        density: Math.max(0, Math.min(100, d)),
      });
      continue;
    }
    const keys = Object.keys(o);
    for (const k of keys) {
      const v = o[k];
      if (typeof v !== "number") continue;
      const name = k.trim() || `decoration_${out.length}`;
      out.push({
        name,
        density: Math.max(0, Math.min(100, v)),
      });
    }
  }
  return out;
}

export function naturalDecoration(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrids =
    input.grid !== undefined ? input.grid : input.gridList;
  const gridList = normalizeGridList(rawGrids);

  if (!gridList || gridList.length === 0) {
    return {
      error: "grid is required",
      outputGridList: [],
      nameListList: [],
    };
  }

  const decRaw = input.decorations;
  // 未接线、未填参、空串、空数组：不生成任何装饰输出（避免仅靠字符串解析误产生清单）
  if (
    decRaw === undefined ||
    decRaw === null ||
    (typeof decRaw === "string" && decRaw.trim() === "") ||
    (Array.isArray(decRaw) && decRaw.length === 0)
  ) {
    return {
      error: "decorations is required",
      outputGridList: [],
      nameListList: [],
    };
  }

  const decorations = parseDecorations(normalizeDecorationsInput(decRaw));

  if (decorations.length === 0) {
    return {
      error: "decorations is required and must be a non-empty array",
      outputGridList: [],
      nameListList: [],
    };
  }

  const algorithm =
    typeof input.algorithm === "string" ? input.algorithm : "random";
  const seed =
    typeof input.seed === "number" ? Math.floor(Math.abs(input.seed)) : 0;
  const densityMode =
    input.densityMode === false ? false : true;

  const baseSeed = seed === 0 ? Date.now() : seed;
  /** 平铺：每个输入网格每种装饰物各一张单值网格（与 0 二值化，非该 id 一律为 0） */
  const outputGridList: number[][][] = [];
  const outputNameList: NameEntry[] = [];

  for (let i = 0; i < gridList.length; i++) {
    const grid = gridList[i];
    if (!grid || grid.length === 0 || grid[0].length === 0) {
      continue;
    }
    const effectiveSeed = baseSeed + i * 999983;
    const { outputGrid, nameList } = processGrid(grid, decorations, algorithm, effectiveSeed, densityMode);

    const rows = outputGrid.length;
    const cols = outputGrid[0]?.length ?? 0;
    for (const entry of nameList) {
      const single: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (outputGrid[r][c] === entry.id) single[r][c] = entry.id;
        }
      }
      outputGridList.push(single);
      outputNameList.push(entry);
    }
  }

  return { outputGridList, outputNameList };
}
