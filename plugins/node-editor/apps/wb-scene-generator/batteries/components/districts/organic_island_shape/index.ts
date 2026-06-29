/**
 * organic_island_shape: 柏林噪声 + 椭圆距离场，将网格列表中每个网格重塑为有机海岛轮廓
 * 输入：grids (number[][][] | number[][]) — 网格列表或单个网格，非零区域决定生成范围
 * 输出：
 *   outputGrids (number[][][]) — 岛屿轮廓网格列表，陆地=1，海洋=0
 *   nameList ({ id: number; name: string; type: string }[]) — 海岛名称清单
 */

// ─── LCG 伪随机数生成器 ─────────────────────────────────────────────────────

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ─── 柏林噪声实现 ────────────────────────────────────────────────────────────

function buildPermTable(rng: () => number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
}

function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function perlinNoise2D(perm: Uint8Array, x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const aa = perm[(perm[xi] + yi) & 255];
  const ab = perm[(perm[xi] + yi + 1) & 255];
  const ba = perm[(perm[xi + 1] + yi) & 255];
  const bb = perm[(perm[xi + 1] + yi + 1) & 255];

  const u = fade(xf);
  const v = fade(yf);

  return lerp(
    lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u),
    lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u),
    v
  );
}

/** 多层柏林噪声（fBm），归一化到 [0, 1] */
function fbm(perm: Uint8Array, x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxValue = 0;

  for (let o = 0; o < octaves; o++) {
    value += perlinNoise2D(perm, x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return (value / maxValue) * 0.5 + 0.5;
}

// ─── 边界框计算 ──────────────────────────────────────────────────────────────

function getBoundingBox(grid: number[][]): { r0: number; r1: number; c0: number; c1: number } {
  const rows = grid.length;
  const cols = grid[0].length;
  let r0 = rows, r1 = 0, c0 = cols, c1 = 0;

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

  if (r0 > r1) return { r0: 0, r1: rows - 1, c0: 0, c1: cols - 1 };
  return { r0, r1, c0, c1 };
}

// ─── 核心算法 ────────────────────────────────────────────────────────────────

/**
 * 生成有机岛屿：椭圆距离场 + fBm 噪声扰动
 *
 * 每个格子计算一个"岛屿值"：
 *   islandValue = (1 - ellipticDist) + noiseStrength * (noise - 0.5) * 2
 * 当 islandValue > (1 - islandRatio) 时判定为陆地（值为 1）。
 */
function generateOrganicIsland(
  rows: number,
  cols: number,
  bbox: { r0: number; r1: number; c0: number; c1: number },
  perm: Uint8Array,
  noiseScale: number,
  noiseStrength: number,
  islandRatio: number,
  octaves: number
): number[][] {
  const output: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bboxH = bbox.r1 - bbox.r0 + 1;
  const bboxW = bbox.c1 - bbox.c0 + 1;
  const centerR = (bbox.r0 + bbox.r1) / 2;
  const centerC = (bbox.c0 + bbox.c1) / 2;

  const halfH = bboxH / 2;
  const halfW = bboxW / 2;

  const threshold = 1 - islandRatio;

  for (let r = bbox.r0; r <= bbox.r1; r++) {
    for (let c = bbox.c0; c <= bbox.c1; c++) {
      const nx = (c - centerC) / halfW;
      const ny = (r - centerR) / halfH;

      const ellipticDist = Math.sqrt(nx * nx + ny * ny);

      const noiseX = (c - bbox.c0) / bboxW * noiseScale;
      const noiseY = (r - bbox.r0) / bboxH * noiseScale;
      const noise = fbm(perm, noiseX, noiseY, octaves);

      const islandValue = (1 - ellipticDist) + noiseStrength * (noise - 0.5) * 2;

      if (islandValue > threshold) {
        output[r][c] = 1;
      }
    }
  }

  return output;
}

// ─── BFS 距离场：海洋分层，输出4张单值网格 ───────────────────────────────────

/**
 * 对已生成的岛屿网格（陆地=1，海洋=0）进行 BFS 距离场计算，
 * 将海洋格子按距陆地的最短步数分为浅水、中水、深水三层。
 *
 * 返回4张独立的单值网格（对应层的格子=1，其余=0）：
 *   [0] 地面网格
 *   [1] 浅水网格（distance 1 ~ 1/3 max）
 *   [2] 中水网格（distance 1/3 ~ 2/3 max）
 *   [3] 深水网格（distance > 2/3 max）
 */
function splitOceanLayers(grid: number[][]): number[][][] {
  const rows = grid.length;
  const cols = grid[0].length;

  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 1) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let maxDist = 0;
  let head = 0;

  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && dist[nr][nc] === -1) {
        dist[nr][nc] = dist[r][c] + 1;
        if (dist[nr][nc] > maxDist) maxDist = dist[nr][nc];
        queue.push([nr, nc]);
      }
    }
  }

  const third = maxDist > 0 ? maxDist / 3 : 1;
  const shallowMax = third;
  const midMax = third * 2;

  // 4张单值网格
  const landGrid:    number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const shallowGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const midGrid:     number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const deepGrid:    number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = dist[r][c];
      if (d === 0) {
        landGrid[r][c] = 1;
      } else if (d <= shallowMax) {
        shallowGrid[r][c] = 1;
      } else if (d <= midMax) {
        midGrid[r][c] = 1;
      } else {
        deepGrid[r][c] = 1;
      }
    }
  }

  return [landGrid, shallowGrid, midGrid, deepGrid];
}

// ─── 类型守卫：判断是否为单个 grid（number[][]） ─────────────────────────────

function isSingleGrid(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  // 如果第一个元素是数组且元素是数字，则视为 grid
  const first = value[0];
  if (!Array.isArray(first)) return false;
  if (first.length === 0) return true;
  return typeof first[0] === "number";
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function organicIslandShape(input: Record<string, unknown>): Record<string, unknown> {
  // 解析输入：支持 grids（网格列表）或 grid（单个网格，向后兼容）
  let rawGrids = input.grids ?? input.grid;

  if (rawGrids === undefined || rawGrids === null) {
    return { error: "grids is required" };
  }

  // 统一为 number[][][] 列表
  let gridList: number[][][];
  if (isSingleGrid(rawGrids)) {
    // 单个 grid，包装为列表
    gridList = [rawGrids as number[][]];
  } else if (Array.isArray(rawGrids) && rawGrids.length > 0 && isSingleGrid(rawGrids[0])) {
    // 已经是网格列表
    gridList = rawGrids as number[][][];
  } else {
    return { error: "grids must be a grid (number[][]) or a list of grids (number[][][])" };
  }

  if (gridList.length === 0) {
    return { error: "grids list is empty" };
  }

  const noiseScale    = typeof input.noiseScale    === "number" ? input.noiseScale    : 3;
  const noiseStrength = typeof input.noiseStrength === "number" ? input.noiseStrength : 0.35;
  const islandRatio   = typeof input.islandRatio   === "number"
    ? Math.max(0.1, Math.min(0.9, input.islandRatio))
    : 0.5;
  const octaves = typeof input.octaves === "number"
    ? Math.max(1, Math.min(8, Math.round(input.octaves)))
    : 4;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const outputGrids: number[][][] = [];
  // 名称清单固定：地面/浅水/中水/深水，id 与网格值一一对应
  const nameList: { id: number; name: string; type: string }[] = [
    { id: 1, name: "地面", type: "tile" },
    { id: 2, name: "浅水", type: "tile" },
    { id: 3, name: "中水", type: "tile" },
    { id: 4, name: "深水", type: "tile" },
  ];

  for (let i = 0; i < gridList.length; i++) {
    const grid = gridList[i];

    if (!grid || grid.length === 0 || grid[0].length === 0) {
      outputGrids.push([]);
      continue;
    }

    const rows = grid.length;
    const cols = grid[0].length;
    const bbox = getBoundingBox(grid);

    // 每个网格使用偏移种子，保证形态各异
    const rng = makeLCG(baseSeed + i * 999983);
    const perm = buildPermTable(rng);

    const shaped = generateOrganicIsland(
      rows, cols, bbox, perm,
      noiseScale, noiseStrength, islandRatio, octaves
    );

    // 对海洋区域做距离场分层，展开为4张单值网格追加到列表
    const layers = splitOceanLayers(shaped);
    for (const layer of layers) {
      outputGrids.push(layer);
    }
  }

  return { outputGrids, nameList };
}
