export function extractFrames(img, cols) {
    const fw = Math.floor(img.width / cols);
    const fh = img.height;
    const frames = [];
    for (let c = 0; c < cols; c++) {
        const canvas = document.createElement('canvas');
        canvas.width = fw;
        canvas.height = fh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, c * fw, 0, fw, fh, 0, 0, fw, fh);
        frames.push(canvas);
    }
    return frames;
}

export function findBottomPixel(canvas, threshold = 10) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= threshold) return y;
        }
    }
    return 0;
}

export function findTopPixel(canvas, threshold = 10) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= threshold) return y;
        }
    }
    return 0;
}

export function findLeftPixel(canvas, threshold = 10) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            if (data[(y * width + x) * 4 + 3] >= threshold) return x;
        }
    }
    return 0;
}

export function findRightPixel(canvas, threshold = 10) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let x = width - 1; x >= 0; x--) {
        for (let y = 0; y < height; y++) {
            if (data[(y * width + x) * 4 + 3] >= threshold) return x;
        }
    }
    return 0;
}

export function getBoundingBox(canvas, threshold = 10) {
    return {
        top: findTopPixel(canvas, threshold),
        bottom: findBottomPixel(canvas, threshold),
        left: findLeftPixel(canvas, threshold),
        right: findRightPixel(canvas, threshold)
    };
}

export function shiftFrame(srcCanvas, dx, dy) {
    const canvas = document.createElement('canvas');
    canvas.width = srcCanvas.width;
    canvas.height = srcCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(srcCanvas, dx, dy);
    return canvas;
}

/**
 * Auto-detect background color by sampling the four corners of a canvas.
 * Returns [r, g, b] of the most common corner color, or null if ambiguous.
 */
export function detectBackgroundColor(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;

    const corners = [
        [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
        [1, 0], [0, 1], [w - 2, 0], [w - 1, 1],
        [0, h - 2], [1, h - 1], [w - 2, h - 1], [w - 1, h - 2]
    ];

    const colorCounts = {};
    corners.forEach(([x, y]) => {
        const idx = (y * w + x) * 4;
        const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
        colorCounts[key] = (colorCounts[key] || 0) + 1;
    });

    let bestKey = null, bestCount = 0;
    for (const [key, count] of Object.entries(colorCounts)) {
        if (count > bestCount) { bestCount = count; bestKey = key; }
    }

    if (bestCount < 4) return null;
    return bestKey.split(',').map(Number);
}

/**
 * Remove background color from a canvas frame, replacing matching pixels with transparent.
 * Returns a NEW canvas with the background removed.
 */
export function removeBackground(canvas, bgColor, tolerance = 30) {
    if (!bgColor) return canvas;

    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, out.width, out.height);
    const data = imgData.data;
    const [br, bg, bb] = bgColor;

    for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i] - br);
        const dg = Math.abs(data[i + 1] - bg);
        const db = Math.abs(data[i + 2] - bb);
        if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
            data[i + 3] = 0;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return out;
}
