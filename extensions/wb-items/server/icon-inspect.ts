const ALPHA_THRESHOLD = 16;

export function inspectCanvas(data: Buffer, width: number, height: number, pixel: boolean) {
  const opaque = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    opaque[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  }

  let opaqueEdge = 0;
  for (let x = 0; x < width; x++) {
    if (opaque[x]) opaqueEdge++;
    if (opaque[(height - 1) * width + x]) opaqueEdge++;
  }
  for (let y = 0; y < height; y++) {
    if (opaque[y * width]) opaqueEdge++;
    if (opaque[y * width + width - 1]) opaqueEdge++;
  }

  const corners = [
    [0, 0],
    [0, width - 1],
    [height - 1, 0],
    [height - 1, width - 1],
  ];
  let dirtyCorners = 0;
  for (const [y, x] of corners) {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] <= ALPHA_THRESHOLD && (data[idx] || data[idx + 1] || data[idx + 2])) dirtyCorners++;
  }

  let totalOpaque = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (opaque[y * width + x]) {
        totalOpaque++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  let frag = 1;
  let largest = 0;
  if (totalOpaque > 0) {
    const visited = new Uint8Array(width * height);
    const sizes: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!opaque[p] || visited[p]) continue;
        const stack = [p];
        visited[p] = 1;
        let size = 0;
        while (stack.length) {
          const cur = stack.pop()!;
          size++;
          const cy = Math.floor(cur / width);
          const cx = cur - cy * width;
          for (const [ny, nx] of [
            [cy - 1, cx],
            [cy + 1, cx],
            [cy, cx - 1],
            [cy, cx + 1],
          ]) {
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (opaque[np] && !visited[np]) {
              visited[np] = 1;
              stack.push(np);
            }
          }
        }
        sizes.push(size);
      }
    }
    largest = Math.max(...sizes) / totalOpaque;
    frag = 1 - largest;
  }

  const boundsFill = totalOpaque > 0 ? ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height) : 0;

  const passed = pixel
    ? opaqueEdge === 0
      && dirtyCorners === 0
      && frag < 0.58
      && largest >= 0.42
      && boundsFill <= 0.92
      && totalOpaque > 0
    : opaqueEdge === 0
      && dirtyCorners === 0
      && frag < 0.28
      && largest >= 0.72
      && boundsFill <= 0.92
      && totalOpaque > 0;

  return {
    opaqueEdgePixels: opaqueEdge,
    transparentCornerDirtyPixels: dirtyCorners,
    fragmentationRatio: Number(frag.toFixed(4)),
    largestComponentRatio: Number(largest.toFixed(4)),
    opaqueBoundsFillRatio: Number(boundsFill.toFixed(4)),
    passed,
  };
}
