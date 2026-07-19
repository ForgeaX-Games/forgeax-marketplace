import {
    findBottomPixel, findTopPixel,
    getBoundingBox, shiftFrame,
    detectBackgroundColor, removeBackground
} from '../utils/canvas-utils.js';

/**
 * Process raw frames according to the action plugin's postProcess config.
 *
 * Pipeline: detect bg → remove bg → vertical align → horizontal align → composite back
 *
 * @param {HTMLCanvasElement[]} rawFrames
 * @param {object} actionPlugin - the registered action plugin object
 * @param {object} options - { alphaThreshold, bgTolerance, removeBg }
 * @returns {HTMLCanvasElement[]}
 */
export function processFrames(rawFrames, actionPlugin, options = {}) {
    const config = actionPlugin.postProcess;
    const threshold = options.alphaThreshold ?? config.defaultAlphaThreshold ?? 10;
    const bgTolerance = options.bgTolerance ?? 30;
    const shouldRemoveBg = options.removeBg !== false;

    if (config.customFn) {
        return config.customFn(rawFrames, { ...options, threshold });
    }

    let frames = rawFrames;

    // Auto-detect and remove solid background so pixel detection works
    let detectedBg = null;
    if (shouldRemoveBg && frames.length > 0) {
        detectedBg = detectBackgroundColor(frames[0]);
        if (detectedBg) {
            frames = frames.map(f => removeBackground(f, detectedBg, bgTolerance));
        }
    }

    const vAlign = config.alignMode || 'none';
    frames = applyVerticalAlign(frames, vAlign, threshold);

    const hAlign = config.horizontalAlign || 'none';
    if (hAlign !== 'none') {
        frames = applyHorizontalAlign(frames, hAlign, threshold);
    }

    return frames;
}

function applyVerticalAlign(frames, mode, threshold) {
    if (mode === 'none') return frames;

    if (mode === 'bottom') {
        const bottoms = frames.map(f => findBottomPixel(f, threshold));
        const target = Math.max(...bottoms);
        return frames.map((f, i) => {
            const dy = target - bottoms[i];
            return dy === 0 ? f : shiftFrame(f, 0, dy);
        });
    }

    if (mode === 'top') {
        const tops = frames.map(f => findTopPixel(f, threshold));
        const target = Math.min(...tops);
        return frames.map((f, i) => {
            const dy = target - tops[i];
            return dy === 0 ? f : shiftFrame(f, 0, dy);
        });
    }

    if (mode === 'center') {
        const centers = frames.map(f => {
            const bb = getBoundingBox(f, threshold);
            return Math.round((bb.top + bb.bottom) / 2);
        });
        const avg = Math.round(centers.reduce((a, b) => a + b, 0) / centers.length);
        return frames.map((f, i) => {
            const dy = avg - centers[i];
            return dy === 0 ? f : shiftFrame(f, 0, dy);
        });
    }

    return frames;
}

function applyHorizontalAlign(frames, mode, threshold) {
    if (mode === 'none') return frames;

    if (mode === 'center') {
        const centers = frames.map(f => {
            const bb = getBoundingBox(f, threshold);
            return Math.round((bb.left + bb.right) / 2);
        });
        const avg = Math.round(centers.reduce((a, b) => a + b, 0) / centers.length);
        return frames.map((f, i) => {
            const dx = avg - centers[i];
            return dx === 0 ? f : shiftFrame(f, dx, 0);
        });
    }

    return frames;
}
