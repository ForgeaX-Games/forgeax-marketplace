/** Icon cutout — edge flood + near-white key removal (aligned with studio ui-asset-cleanup icon mode). */

const WHITE_THRESHOLD = 242;
const ALPHA_THRESHOLD = 16;
const COLOR_TOLERANCE = 34;
const ICON_KEY_WHITE_MAX_DIFF = 42;

interface SeedColor {
  r: number;
  g: number;
  b: number;
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD;
}

function isNearBlack(r: number, g: number, b: number): boolean {
  return r <= 52 && g <= 52 && b <= 52;
}

function isChromaMagentaKey(r: number, g: number, b: number): boolean {
  return g <= 110 && r >= 150 && b >= 150 && (r - g) >= 40 && (b - g) >= 40;
}

function isChromaGreenKey(r: number, g: number, b: number): boolean {
  return g >= 150 && r <= 120 && b <= 120 && g - Math.max(r, b) >= 30;
}

function isChromaKeyScreen(r: number, g: number, b: number): boolean {
  return isChromaMagentaKey(r, g, b) || isChromaGreenKey(r, g, b);
}

function isIconNearWhiteKey(r: number, g: number, b: number): boolean {
  return Math.max(255 - r, 255 - g, 255 - b) <= ICON_KEY_WHITE_MAX_DIFF;
}

function isLightExtractionKey(r: number, g: number, b: number): boolean {
  const maxDiff = Math.max(255 - r, 255 - g, 255 - b);
  if (maxDiff <= ICON_KEY_WHITE_MAX_DIFF) return true;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (max - min > 28) return false;
  const avg = (r + g + b) / 3;
  return maxDiff <= 72 && avg >= 175;
}

function alphaAt(data: Buffer, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3];
}

function scrubLightKeyFringe(data: Buffer, width: number, height: number): void {
  const copy = Buffer.from(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      if (copy[i + 3] <= ALPHA_THRESHOLD) continue;
      if (!isLightExtractionKey(copy[i], copy[i + 1], copy[i + 2])) continue;
      const hasTransparentNeighbor = (
        alphaAt(copy, width, x - 1, y) <= ALPHA_THRESHOLD
        || alphaAt(copy, width, x + 1, y) <= ALPHA_THRESHOLD
        || alphaAt(copy, width, x, y - 1) <= ALPHA_THRESHOLD
        || alphaAt(copy, width, x, y + 1) <= ALPHA_THRESHOLD
      );
      if (!hasTransparentNeighbor) continue;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

function runLightKeyFringePasses(data: Buffer, width: number, height: number, passes: number): void {
  for (let p = 0; p < passes; p++) scrubLightKeyFringe(data, width, height);
}

function colorCloseToSeed(r: number, g: number, b: number, seed: SeedColor, tolerance: number): boolean {
  return Math.abs(r - seed.r) <= tolerance
    && Math.abs(g - seed.g) <= tolerance
    && Math.abs(b - seed.b) <= tolerance;
}

function collectEdgeSeeds(data: Buffer, width: number, height: number): SeedColor[] {
  const seeds: SeedColor[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < ALPHA_THRESHOLD) return;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isNearWhite(r, g, b) && !isNearBlack(r, g, b) && !isChromaKeyScreen(r, g, b)) return;
    const key = `${Math.round(r / 16)}:${Math.round(g / 16)}:${Math.round(b / 16)}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ r, g, b });
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    add(0, y);
    add(width - 1, y);
  }
  return seeds;
}

function runFloodErasable(
  data: Buffer,
  width: number,
  height: number,
  isErasable: (r: number, g: number, b: number, a: number) => boolean,
): void {
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    const pos = y * width + x;
    if (visited[pos]) return;
    const i = pos * 4;
    if (!isErasable(data[i], data[i + 1], data[i + 2], data[i + 3])) return;
    visited[pos] = 1;
    queue.push(pos);
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  for (let head = 0; head < queue.length; head++) {
    const pos = queue[head];
    const x = pos % width;
    const y = Math.floor(pos / width);
    const idx = pos * 4;
    data[idx] = 0;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
    data[idx + 3] = 0;
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
}

function scorchIconWhiteKeyBackdrop(data: Buffer, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= ALPHA_THRESHOLD) continue;
      if (!isIconNearWhiteKey(data[i], data[i + 1], data[i + 2])) continue;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

function keepLargestOpaqueComponent(data: Buffer, width: number, height: number): void {
  const visited = new Uint8Array(width * height);
  let largest: number[] = [];
  const alphaAt = (pos: number) => data[pos * 4 + 3];
  for (let pos = 0; pos < width * height; pos++) {
    if (visited[pos] || alphaAt(pos) < ALPHA_THRESHOLD) continue;
    const component: number[] = [];
    const queue = [pos];
    visited[pos] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      component.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      for (const next of [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]) {
        if (next < 0 || visited[next] || alphaAt(next) < ALPHA_THRESHOLD) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  if (!largest.length) return;
  const keep = new Uint8Array(width * height);
  for (const pos of largest) keep[pos] = 1;
  for (let pos = 0; pos < width * height; pos++) {
    if (keep[pos]) continue;
    const idx = pos * 4;
    data[idx] = 0;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
    data[idx + 3] = 0;
  }
}

function zeroTransparentRgb(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= ALPHA_THRESHOLD) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

/** Mutates RGBA buffer in place — removes extraction background before bbox/crop. */
export function applyIconCutout(data: Buffer, width: number, height: number): void {
  const seeds = collectEdgeSeeds(data, width, height);
  runFloodErasable(data, width, height, (r, g, b, a) => {
    if (a < ALPHA_THRESHOLD) return true;
    if (isNearWhite(r, g, b) || isNearBlack(r, g, b) || isChromaKeyScreen(r, g, b)) return true;
    if (isLightExtractionKey(r, g, b)) return true;
    return seeds.some((seed) => colorCloseToSeed(r, g, b, seed, COLOR_TOLERANCE));
  });
  scorchIconWhiteKeyBackdrop(data, width, height);
  runLightKeyFringePasses(data, width, height, 4);
  scorchIconWhiteKeyBackdrop(data, width, height);
  keepLargestOpaqueComponent(data, width, height);
  runLightKeyFringePasses(data, width, height, 2);
  scorchIconWhiteKeyBackdrop(data, width, height);
  zeroTransparentRgb(data);
}
