// Encode worker: receive a transferred VideoFrame, downscale onto an
// OffscreenCanvas, JPEG-encode off the main thread, and post the bytes back.

interface InitMsg { type: 'init'; w: number; h: number; quality: number }
interface FrameMsg { type: 'frame'; frame: VideoFrame; seq: number; ts: number; params?: Record<string, unknown> }

let osc: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let quality = 0.7;

self.onmessage = async (e: MessageEvent<InitMsg | FrameMsg>) => {
  const m = e.data;
  if (m.type === 'init') {
    osc = new OffscreenCanvas(m.w, m.h);
    ctx = osc.getContext('2d', { desynchronized: true });
    quality = m.quality;
    return;
  }
  const { frame, seq, ts, params } = m;
  try {
    if (!osc || !ctx) { frame.close(); return; }
    ctx.drawImage(frame, 0, 0, osc.width, osc.height);
    frame.close();
    const blob = await osc.convertToBlob({ type: 'image/jpeg', quality });
    const jpeg = await blob.arrayBuffer();
    (self as unknown as Worker).postMessage({ seq, ts, params, jpeg }, [jpeg]);
  } catch {
    try { frame.close(); } catch { /* already closed */ }
    (self as unknown as Worker).postMessage({ seq, ts, params, jpeg: null });
  }
};
