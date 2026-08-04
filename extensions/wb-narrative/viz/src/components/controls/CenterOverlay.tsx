import { useEffect, useState } from "react";
import { Maximize, Minus, Plus, X } from "lucide-react";
import { RequirementInputPanel } from "./RequirementInputPanel";
import { RunActionBar } from "./RunActionBar";
import { useNarrativeStore } from "../../store/narrativeStore";
import {
  getCanvasControls,
  subscribeCanvasControls,
  type CanvasControls,
} from "../../lib/canvasControls";
import { useT } from "../../i18n";

/**
 * 创作空间的浮层（设计稿 01/03/04）。
 *
 * 主体永远是整片画布，这一层只是压在它上面：需求输入编辑卡居中浮在底部偏上，
 * 操作条与画布控件贴右下角。空态（没点过顶栏「需求输入」）只剩操作条，水印一览无余。
 */
export function CenterOverlay() {
  const t = useT();
  const inputTab = useNarrativeStore((s) => s.inputTab);
  const inputEditorOpen = useNarrativeStore((s) => s.inputEditorOpen);
  const setInputEditorOpen = useNarrativeStore((s) => s.setInputEditorOpen);
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const workbenchError = useNarrativeStore((s) => s.workbenchError);
  const [canvas, setCanvas] = useState<CanvasControls | null>(getCanvasControls);

  useEffect(() => subscribeCanvasControls(setCanvas), []);

  return (
    <div className="cw-overlay">
      {workbenchError && <div className="cw-overlay__error">{workbenchError}</div>}

      {inputEditorOpen && (
        <div className="cw-float-input" data-tab={inputTab}>
          <div className="cw-float-input__head">
            <span className="cw-float-input__badge">{t(`tms.inputTab.${inputTab}`)}</span>
            <button
              type="button"
              className="cw-float-input__close"
              title={t("nav.input.close")}
              aria-label={t("nav.input.close")}
              onClick={() => setInputEditorOpen(false)}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <RequirementInputPanel />
        </div>
      )}

      <div className="cw-overlay__actions">
        <RunActionBar />
        {viewMode === "graph" && (
          <div className="cw-canvasctl" role="group" aria-label={t("nav.tab.view")}>
            <button
              type="button"
              className="cw-canvasctl__btn"
              onClick={() => canvas?.zoomIn()}
              disabled={!canvas}
              title={t("canvas.zoomIn")}
              aria-label={t("canvas.zoomIn")}
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              className="cw-canvasctl__btn"
              onClick={() => canvas?.zoomOut()}
              disabled={!canvas}
              title={t("canvas.zoomOut")}
              aria-label={t("canvas.zoomOut")}
            >
              <Minus size={14} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              className="cw-canvasctl__btn"
              onClick={() => canvas?.fitView()}
              disabled={!canvas}
              title={t("canvas.fit")}
              aria-label={t("canvas.fit")}
            >
              <Maximize size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
