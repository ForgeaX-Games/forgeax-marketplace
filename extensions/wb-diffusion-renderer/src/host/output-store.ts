export interface DiffusionRendererOutputSnapshot {
  src: string | null;
  visible: boolean;
  updatedAt: number | null;
}

type Listener = () => void;

let target: HTMLImageElement | null = null;
let latestSrc: string | null = null;
let visible = true;
let updatedAt: number | null = null;
const listeners = new Set<Listener>();

export function getDiffusionRendererOutputSnapshot(): DiffusionRendererOutputSnapshot {
  return { src: latestSrc, visible, updatedAt };
}

export function subscribeDiffusionRendererOutput(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

function applyToTarget(): void {
  if (!target) return;
  if (latestSrc && visible) {
    if (target.src !== latestSrc) target.src = latestSrc;
    target.style.display = 'block';
  } else {
    target.style.display = 'none';
  }
}

export function paintDiffusionRendererOutput(src: string): void {
  latestSrc = src;
  updatedAt = Date.now();
  applyToTarget();
  notify();
}

export function setDiffusionRendererOutputVisible(nextVisible: boolean): void {
  visible = nextVisible;
  applyToTarget();
  notify();
}

export function setDiffusionRendererOutputTarget(img: HTMLImageElement | null): void {
  if (target === img) return;
  target = img;
  applyToTarget();
}
