import { useEffect } from "react";
import { useReactFlow } from "reactflow";

/**
 * 画布控件的文档内登记处。
 *
 * 缩放/复位要用 reactflow 实例，而实例只在 `<ReactFlowProvider>` 子树里拿得到；
 * 底部操作条在画布外面，够不着。于是画布挂载时把三个动作登记进来，操作条按名调用。
 * 没有画布（文本视图）时 controls 为 null，按钮相应置灰。
 */
export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
}

let controls: CanvasControls | null = null;
const listeners = new Set<(c: CanvasControls | null) => void>();

function publish(next: CanvasControls | null): void {
  controls = next;
  for (const l of listeners) l(next);
}

export function getCanvasControls(): CanvasControls | null {
  return controls;
}

export function subscribeCanvasControls(fn: (c: CanvasControls | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 在任一 reactflow 画布内调用一次即可。 */
export function useRegisterCanvasControls(): void {
  const rf = useReactFlow();
  useEffect(() => {
    publish({
      zoomIn: () => rf.zoomIn({ duration: 200 }),
      zoomOut: () => rf.zoomOut({ duration: 200 }),
      fitView: () => rf.fitView({ padding: 0.12, duration: 300 }),
    });
    return () => publish(null);
  }, [rf]);
}
