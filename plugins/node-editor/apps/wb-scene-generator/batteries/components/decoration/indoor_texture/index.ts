/**
 * indoor_texture: 根据楼层掩码网格列表批量生成室内纹理分布（普通/青苔/裂纹/木/石板地板）
 * 输入：gridList (array) — 楼层掩码网格列表（支持单个网格或网格数组）; algorithm (string) — 算法类型; seed (number) — 随机种子
 * 输出：outputGridList (array) — 单值网格的平铺列表：每个输入楼层的多类别结果按纹理 id 1～5 拆分，每张网格仅含 0 或该 id；无该类型的层不输出；
 *       nameList (array) — 与 outputGridList 一一对应 [{id, name, type:"tile"}]
 */

type Grid = number[][];

const TEXTURE_COUNT = 5; // 1=普通地板, 2=青苔地板, 3=裂纹地板, 4=木地板, 5=石板地板

// Linear Congruential Generator for deterministic randomness
function makeLCG(seed: number): () => number {
  let s = ((seed === 0 ? Date.now() : seed) & 0xffffffff) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

// Selects a texture type (1..N) from a weight array via weighted random.
// An optional additive noise on the random value biases toward later types.
function weightedSelect(weights: number[], rng: () => number, noise = 0): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let rv = rng() + noise;
  let cumulative = 0;
  for (let k = 0; k < weights.length; k++) {
    cumulative += weights[k] / total;
    if (rv <= cumulative) return k + 1;
  }
  return weights.length; // noise pushed rv > 1, fall through to last type
}

// --- Algorithm 1: Nature ---
// Positional hash noise + edge/corner distance decay.
// 青苔/裂纹 boosted near edges and corners; 木地板 mild edge boost; 石板地板 mild corner boost.
function generateByNoiseAndDistance(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const noiseScale = 0.1;
  const edgeDecayDist = 3;
  const cornerDecayDist = 2;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;

      const hashNoise = (((i * 31337 + j * 1337 + 17) % 1000) + 1000) % 1000;
      const noise = (hashNoise / 1000) * noiseScale;

      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      const cornerDist = Math.min(
        Math.sqrt(i * i + j * j),
        Math.sqrt(i * i + (cols - 1 - j) ** 2),
        Math.sqrt((rows - 1 - i) ** 2 + j * j),
        Math.sqrt((rows - 1 - i) ** 2 + (cols - 1 - j) ** 2),
      );

      const edgeFactor = edgeDist < edgeDecayDist ? Math.max(0, 1 - edgeDist / edgeDecayDist) : 0;
      const cornerFactor = cornerDist < cornerDecayDist ? Math.max(0, 1 - cornerDist / cornerDecayDist) : 0;
      const specialBoost = edgeFactor * 0.3 + cornerFactor * 0.5;

      const base = 1 / TEXTURE_COUNT;
      const weights = [
        base,                              // 1=普通地板（无加成）
        base * (1 + specialBoost),         // 2=青苔地板（边角强加成）
        base * (1 + specialBoost),         // 3=裂纹地板（边角强加成）
        base * (1 + edgeFactor * 0.2),    // 4=木地板（边缘轻微加成）
        base * (1 + cornerFactor * 0.3),  // 5=石板地板（角落轻微加成）
      ];

      output[i][j] = weightedSelect(weights, rng, noise);
    }
  }

  return output;
}

// --- Algorithm 2: Water ---
// Assigns textures based on simulated moisture (edge-biased) and light (center-biased) values.
// Each texture type has a preferred [moisture, light] target; closer = higher score.
function generateMoistureMap(rows: number, cols: number, grid: Grid, rng: () => number): number[][] {
  const maxDist = Math.max(rows, cols) / 2;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (__, j) => {
      if (grid[i][j] === 0) return 0;
      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      return maxDist > 0
        ? Math.max(0, 1 - edgeDist / maxDist) * 0.5 + rng() * 0.3
        : rng() * 0.8;
    }),
  );
}

function generateLightMap(rows: number, cols: number, grid: Grid, rng: () => number): number[][] {
  const ci = rows / 2;
  const cj = cols / 2;
  const maxDist = Math.sqrt(rows ** 2 + cols ** 2) / 2;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (__, j) => {
      if (grid[i][j] === 0) return 0;
      const dist = Math.sqrt((i - ci) ** 2 + (j - cj) ** 2);
      return maxDist > 0
        ? Math.max(0, 1 - dist / maxDist) * 0.7 + rng() * 0.3
        : rng();
    }),
  );
}

function generateByEnvironment(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const moisture = generateMoistureMap(rows, cols, grid, rng);
  const light = generateLightMap(rows, cols, grid, rng);

  // [moisture target, light target] for each texture type (index 0 → value 1)
  const prefs = [
    { m: 0.3, l: 0.5 }, // 普通地板（适中）
    { m: 0.8, l: 0.3 }, // 青苔地板（潮湿+暗）
    { m: 0.2, l: 0.7 }, // 裂纹地板（干燥+亮）
    { m: 0.5, l: 0.8 }, // 木地板（适中湿度+明亮）
    { m: 0.1, l: 0.2 }, // 石板地板（极干+偏暗）
  ];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const m = moisture[i][j];
      const l = light[i][j];
      const scores = prefs.map(p => ((1 - Math.abs(m - p.m)) + (1 - Math.abs(l - p.l))) / 2);
      const total = scores.reduce((a, b) => a + b, 0);
      if (total > 0) {
        let rv = rng() * total;
        let selected = 0;
        for (let k = 0; k < scores.length; k++) {
          rv -= scores[k];
          if (rv <= 0) { selected = k; break; }
        }
        output[i][j] = selected + 1;
      } else {
        output[i][j] = Math.floor(rng() * TEXTURE_COUNT) + 1;
      }
    }
  }

  return output;
}

// --- Algorithm 3: Smooth ---
// Divides the mask into coarser clusters, assigns each cluster a texture type,
// then adds smooth blending at cluster boundaries via transition probability.
function generateByClustering(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const clusterSize = 5;
  const transitionProb = 0.3;
  const gRows = Math.ceil(rows / clusterSize);
  const gCols = Math.ceil(cols / clusterSize);

  const clusterTexture: number[][] = Array.from({ length: gRows }, () =>
    Array.from({ length: gCols }, () => Math.floor(rng() * TEXTURE_COUNT) + 1),
  );

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const gi = Math.floor(i / clusterSize);
      const gj = Math.floor(j / clusterSize);
      const iMod = i % clusterSize;
      const jMod = j % clusterSize;
      const isBoundary = iMod < 2 || iMod >= clusterSize - 2 || jMod < 2 || jMod >= clusterSize - 2;

      if (isBoundary && rng() < transitionProb) {
        const neighbors = (
          [
            [gi - 1, gj],
            [gi + 1, gj],
            [gi, gj - 1],
            [gi, gj + 1],
          ] as [number, number][]
        ).filter(([ni, nj]) => ni >= 0 && ni < gRows && nj >= 0 && nj < gCols);
        if (neighbors.length > 0) {
          const [ni, nj] = neighbors[Math.floor(rng() * neighbors.length)];
          output[i][j] = clusterTexture[ni][nj];
        } else {
          output[i][j] = clusterTexture[gi][gj];
        }
      } else {
        output[i][j] = clusterTexture[gi][gj];
      }
    }
  }

  return output;
}

// --- Algorithm 4: Mixed ---
// Hybrid: cluster-based foundation → 30% environment blend → edge/corner preference pass.
function generateHybrid(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const base = generateByClustering(grid, rng);
  const env = generateByEnvironment(grid, rng);

  // 30% environment blend
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] !== 0 && rng() < 0.3) base[i][j] = env[i][j];
    }
  }

  // Edge/corner preference: corners lean toward 青苔/石板, edges lean toward all special textures
  const cornerTypes = [2, 5]; // 青苔地板、石板地板偏好出现在角落
  const edgeTypes = [2, 3, 4, 5]; // 边缘偏好任意特殊纹理
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      const isCorner =
        (i < 3 && j < 3) ||
        (i < 3 && j >= cols - 3) ||
        (i >= rows - 3 && j < 3) ||
        (i >= rows - 3 && j >= cols - 3);

      if (isCorner && rng() < 0.6) {
        if (rng() < 0.6) base[i][j] = cornerTypes[Math.floor(rng() * cornerTypes.length)];
      } else if (edgeDist < 3 && rng() < 0.4) {
        base[i][j] = edgeTypes[Math.floor(rng() * edgeTypes.length)];
      }
    }
  }

  return base;
}

function processOneGrid(grid: Grid, algorithm: string, effectiveSeed: number): Grid {
  const rng = makeLCG(effectiveSeed);
  switch (algorithm) {
    case "water":  return generateByEnvironment(grid, rng);
    case "smooth": return generateByClustering(grid, rng);
    case "mixed":  return generateHybrid(grid, rng);
    default:       return generateByNoiseAndDistance(grid, rng);
  }
}

/** 纹理种类固定表：id 与名称对应关系。 */
const TEXTURE_NAMES: { id: number; name: string }[] = [
  { id: 1, name: "普通地板" },
  { id: 2, name: "青苔地板" },
  { id: 3, name: "裂纹地板" },
  { id: 4, name: "木地板"   },
  { id: 5, name: "石板地板" },
];

/**
 * 归一化 gridList 输入：支持单个网格（number[][]）或网格数组（number[][][]）。
 * 若第一个元素是数字数组（而非数组的数组），视为单个网格并包装为列表。
 */
function normalizeGridList(raw: unknown): Grid[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (Array.isArray(first) && (first.length === 0 || !Array.isArray(first[0]))) {
    return [raw as Grid];
  }
  return raw as Grid[];
}

/** 多类别纹理网格 → 单值网格列表：每种出现的纹理 id 一张网（仅含 0 与该 id），顺序 id 1…5。 */
function splitMultiToSingleValueLayers(multi: Grid): { id: number; grid: Grid }[] {
  if (!multi.length || !multi[0]?.length) return [];
  const rows = multi.length;
  const cols = multi[0].length;
  const out: { id: number; grid: Grid }[] = [];
  for (let tid = 1; tid <= TEXTURE_COUNT; tid++) {
    let hasAny = false;
    const g: Grid = Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) => {
        const v = multi[i][j];
        const cell = v === tid ? tid : 0;
        if (cell !== 0) hasAny = true;
        return cell;
      }),
    );
    if (hasAny) out.push({ id: tid, grid: g });
  }
  return out;
}

export function indoorTexture(input: Record<string, unknown>): Record<string, unknown> {
  const gridList = normalizeGridList(input.gridList);
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "nature";
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;

  if (!gridList || gridList.length === 0) {
    return { error: "gridList is required" };
  }

  const baseSeed = seed === 0 ? Date.now() : seed;

  // 按 id 合并：多个楼层同一纹理类型叠加到同一张单值网格（后楼层覆盖前楼层，非零优先）
  const mergedByTid = new Map<number, Grid>();

  for (let i = 0; i < gridList.length; i++) {
    const grid = gridList[i];
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) continue;

    const effectiveSeed = baseSeed + i * 999983;
    const multi = processOneGrid(grid, algorithm, effectiveSeed);
    for (const { id, grid: single } of splitMultiToSingleValueLayers(multi)) {
      const existing = mergedByTid.get(id);
      if (!existing) {
        mergedByTid.set(id, single);
      } else {
        // OR 合并：非零覆盖零
        const rows = Math.max(existing.length, single.length);
        const cols = Math.max(existing[0]?.length ?? 0, single[0]?.length ?? 0);
        const merged: Grid = Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const a = existing[r]?.[c] ?? 0;
            const b = single[r]?.[c] ?? 0;
            return b !== 0 ? b : a;
          }),
        );
        mergedByTid.set(id, merged);
      }
    }
  }

  // 按 id 1→5 有序输出
  const outputGridList: Grid[] = [];
  const nameList: { id: number; name: string; type: string }[] = [];
  for (let tid = 1; tid <= TEXTURE_COUNT; tid++) {
    const g = mergedByTid.get(tid);
    if (!g) continue;
    outputGridList.push(g);
    const meta = TEXTURE_NAMES.find(t => t.id === tid);
    nameList.push({ id: tid, name: meta?.name ?? `类型${tid}`, type: "tile" });
  }

  return { outputGridList, nameList };
}
