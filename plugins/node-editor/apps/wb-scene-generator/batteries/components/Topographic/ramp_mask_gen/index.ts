/**
 * rampMaskGen（坡道掩码生成）v1.3
 * 输入：
 *   input        (array)   — 网格列表，每项为一个二维网格
 *   rampPosition (number)  — 坡道横向位置 0~1；-1 或缺省 → 随机
 *   seed         (number)  — 随机种子（仅随机模式生效）
 *   merge        (boolean) — 默认 true：将所有坡道合并为单张网格 + 单条名称清单
 * 输出：
 *   output         (array) — 合并模式：单张网格；非合并：网格列表
 *   outputNameList (array) — 合并模式：[{id:1,name:'坡道',type:'tile'}]；非合并：每网格一条
 */

type NameEntry = { id: number; name: string; type?: string };

function hashSeed(seed: number): number {
  let h = (seed ^ 0xdeadbeef) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function makeLCG(seed: number): () => number {
  let s = hashSeed(seed);
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 生成单个网格的坡道掩码。
 *
 * @param grid         输入二维网格
 * @param rampPosition 0~1 表示固定位置比例；-1 表示随机
 * @param rng          随机数生成器（随机模式使用）
 * @returns            坡道掩码网格
 */
function generateRampMask(
  grid: number[][],
  rampPosition: number,
  rng: () => number,
): number[][] {
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;

  // 收集每个区域值的合法坡道候选位置
  // 合法条件：
  //   (r, c) == v，(r, c+1) == v        ← 上两格在区域内
  //   (r+1, c) == 0，(r+1, c+1) == 0   ← 下两格为空（区域外）
  const candidates = new Map<number, Array<{ r: number; c: number }>>();

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W - 1; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (grid[r][c + 1] !== v) continue;
      if (r + 1 >= H) continue;
      if (grid[r + 1][c] !== 0) continue;
      if (grid[r + 1][c + 1] !== 0) continue;
      if (!candidates.has(v)) candidates.set(v, []);
      candidates.get(v)!.push({ r, c });
    }
  }

  const ramp: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));

  const useFixed = rampPosition >= 0 && rampPosition <= 1;

  for (const [v, list] of candidates) {
    if (list.length === 0) continue;

    let chosen: { r: number; c: number };

    if (useFixed) {
      // 按位置比例选：list 已经是从左到右排列的合法位置
      // 先找最左和最右候选列，再按比例插值选最近的候选
      const sortedByC = [...list].sort((a, b) => a.c - b.c);
      const targetIdx = Math.round(rampPosition * (sortedByC.length - 1));
      chosen = sortedByC[Math.max(0, Math.min(sortedByC.length - 1, targetIdx))];
    } else {
      const idx = Math.floor(rng() * list.length);
      chosen = list[idx];
    }

    const { r, c } = chosen;
    ramp[r][c]         = v;
    ramp[r][c + 1]     = v;
    ramp[r + 1][c]     = v;
    ramp[r + 1][c + 1] = v;
  }

  return ramp;
}

export function rampMaskGen(input: Record<string, unknown>): Record<string, unknown> {
  // ── 解析输入 ──────────────────────────────────────────────────────────────
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const rampPosRaw = typeof input.rampPosition === "number" ? input.rampPosition : -1;
  // -1 或超出 [0,1] 范围视为随机
  const rampPosition = rampPosRaw >= 0 && rampPosRaw <= 1 ? rampPosRaw : -1;

  // merge 默认 true
  const doMerge = input.merge !== false;

  const data = input.input;
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "input 必须是非空网格列表" };
  }

  // ── 确定列表中的每个网格 ──────────────────────────────────────────────────
  // 支持两种格式：
  //   1. 网格列表：data[0] 是二维数组（number[][]）
  //   2. 单个网格（向后兼容）：data[0] 是一维数组（number[]）
  let grids: number[][][];

  if (Array.isArray(data[0]) && Array.isArray((data[0] as unknown[][])[0])) {
    grids = data as number[][][];
  } else if (Array.isArray(data[0])) {
    // 单个网格包装成列表
    grids = [data as number[][]];
  } else {
    return { error: "input 格式无法识别，期望二维网格列表" };
  }

  // ── 生成每个网格的坡道掩码 ────────────────────────────────────────────────
  const rng = makeLCG(baseSeed);
  const masks = grids.map(g => generateRampMask(g, rampPosition, rng));

  // ── 合并模式：所有掩码叠加为一张网格，名称清单合并为单条 ──────────────────
  if (doMerge) {
    // 以最大行列数为画布，逐格取最后一个非零值（后写覆盖前写）
    const H = Math.max(...grids.map(g => g.length));
    const W = Math.max(...grids.map(g => (g[0]?.length ?? 0)));
    const merged: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
    for (const mask of masks) {
      for (let r = 0; r < mask.length; r++) {
        for (let c = 0; c < mask[r].length; c++) {
          if (mask[r][c] !== 0) merged[r][c] = 1;  // 统一写 1，输出单值 01 网格
        }
      }
    }
    return {
      output: [merged],
      outputNameList: [{ id: 1, name: "坡道", type: "tile" }] as NameEntry[],
    };
  }

  // ── 非合并模式：列表格式，每个网格对应一条坡道条目 ───────────────────────
  const outputNameList: NameEntry[] = grids.map((_, i) => ({
    id: i + 1,
    name: `坡道_${i + 1}`,
    type: "tile",
  }));

  return {
    output: masks,
    outputNameList,
  };
}
