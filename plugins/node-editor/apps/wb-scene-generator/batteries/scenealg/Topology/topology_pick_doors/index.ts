/**
 * topologyPickDoors: 在输入拓扑（墙状 0/1 grid）上挑 count 个宽度为 width 的门洞段。
 *
 * 输入：topology (grid)，count (number, default 1)，width (number, default 2)，seed (number, default 0)
 * 输出：topology (grid) — 挑中的门洞 0/1，placed (number)
 *
 * 算法本体（doorCandCells / collectDoorPriority / collectDoorFallback / placeDoors / doorOne）
 * 完整照搬自 components/interests/building_generator 的外门步骤。
 */

type Grid = number[][];
interface DoorCand { r: number; c: number; dir: "H" | "V"; width: number }

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function doorCandCells(d: DoorCand, cols: number): number[] {
  if (d.dir === "H") return Array.from({ length: d.width }, (_, i) => d.r * cols + d.c + i);
  return Array.from({ length: d.width }, (_, i) => (d.r + i) * cols + d.c);
}

function collectDoorPriority(grid: Grid, rows: number, cols: number, dw: number): DoorCand[] {
  const SEG = 6, cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++) {
    let s = -1;
    for (let c = 0; c <= cols; c++) {
      const isW = c < cols && grid[r][c] !== 0;
      if (isW && s === -1) s = c;
      else if (!isW && s !== -1) {
        const e = c - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
          if (ds >= s && de <= e && (r > 0 && grid[r - 1][ds] === 0 || r < rows - 1 && grid[r + 1][ds] === 0))
            cands.push({ r, c: ds, dir: "H", width: dw });
        }
        s = -1;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = -1;
    for (let r = 0; r <= rows; r++) {
      const isW = r < rows && grid[r][c] !== 0;
      if (isW && s === -1) s = r;
      else if (!isW && s !== -1) {
        const e = r - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
          if (ds >= s && de <= e && (c > 0 && grid[ds][c - 1] === 0 || c < cols - 1 && grid[ds][c + 1] === 0))
            cands.push({ r: ds, c, dir: "V", width: dw });
        }
        s = -1;
      }
    }
  }
  return cands;
}

function collectDoorFallback(grid: Grid, rows: number, cols: number, dw: number): DoorCand[] {
  const cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols - dw; c++)
      if (Array.from({ length: dw }, (_, i) => grid[r][c + i]).every(v => v !== 0) &&
          (r > 0 && grid[r - 1][c] === 0 || r < rows - 1 && grid[r + 1][c] === 0))
        cands.push({ r, c, dir: "H", width: dw });
  for (let c = 0; c < cols; c++)
    for (let r = 0; r <= rows - dw; r++)
      if (Array.from({ length: dw }, (_, i) => grid[r + i][c]).every(v => v !== 0) &&
          (c > 0 && grid[r][c - 1] === 0 || c < cols - 1 && grid[r][c + 1] === 0))
        cands.push({ r, c, dir: "V", width: dw });
  return cands;
}

function placeDoors(cands: DoorCand[], need: number, opened: Set<number>, doorG: Grid, cols: number): number {
  let placed = 0;
  for (const cand of cands) {
    if (placed >= need) break;
    const keys = doorCandCells(cand, cols);
    if (keys.some(k => opened.has(k))) continue;
    for (const k of keys) { opened.add(k); doorG[Math.floor(k / cols)][k % cols] = 1; }
    placed++;
  }
  return placed;
}

function doorOne(wallGrid: Grid, doorCount: number, doorWidth: number, seedRaw: number): { doorGrid: Grid; placed: number } {
  const rows = wallGrid.length, cols = wallGrid[0].length;
  const rand = makeLCG(seedRaw);
  const doorGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (doorCount === 0) return { doorGrid, placed: 0 };
  const priority = collectDoorPriority(wallGrid, rows, cols, doorWidth);
  shuffle(priority, rand);
  const opened = new Set<number>();
  let placed = placeDoors(priority, doorCount, opened, doorGrid, cols);
  if (placed < doorCount) {
    const fb = collectDoorFallback(wallGrid, rows, cols, doorWidth)
      .filter(c => !doorCandCells(c, cols).some(k => opened.has(k)));
    shuffle(fb, rand);
    placed += placeDoors(fb, doorCount - placed, opened, doorGrid, cols);
  }
  return { doorGrid, placed };
}

export function topologyPickDoors(input: Record<string, unknown>): Record<string, unknown> {
  const topology = input.topology as Grid | undefined;
  if (!topology || topology.length === 0 || (topology[0]?.length ?? 0) === 0) {
    return { error: "topology is required" };
  }
  const count = typeof input.count === "number" ? Math.max(0, Math.round(input.count)) : 1;
  const width = typeof input.width === "number" ? Math.max(1, Math.round(input.width)) : 2;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const { doorGrid, placed } = doorOne(topology, count, width, seed);
  return { topology: doorGrid, placed };
}
