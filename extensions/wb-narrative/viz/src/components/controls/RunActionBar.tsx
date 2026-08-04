import { Pause, Play, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useWorkbenchActions } from "../workbench/useWorkbenchActions";
import { useEntryActions } from "../workbench/useEntryActions";
import { useT } from "../../i18n";

/**
 * 常驻操作条：开始生成 / 取消 / 断点续跑 / 重新生成。
 *
 * 设计稿 03 把它固定在创作空间底部，与需求输入编辑区同一行——不再随左栏第 3 段滚走。
 * 按钮本身不执行动作，只往 store 的命令槽写一条；执行在 owner 侧的 WorkbenchProvider。
 */
export function RunActionBar() {
  const t = useT();
  const {
    phase, primaryAction, busy, isRunning, isGenerating, isHeavyUpload, ipCanGenerate,
    start, cancel, resume, regenerate,
  } = useWorkbenchActions();

  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const entryDirty = useNarrativeStore((s) => s.entryDirty);
  const { saveEntryConfig } = useEntryActions();

  // 路由改完后落盘的那一手。原先在左栏 ROUTING 段底部，路由搬进顶栏下拉后跟操作条同排。
  const canSaveEntry = !!activeEntryKey && !activeEntryStatus;

  return (
    <div className="cw-actions">
      {canSaveEntry && (
        <button
          type="button"
          className="cw-actions__btn"
          onClick={() => void saveEntryConfig()}
          disabled={!entryDirty}
          title={t("tms.saveEntry")}
        >
          <Save size={14} strokeWidth={2} aria-hidden />
          <span>{entryDirty ? t("tms.saveEntry") : t("tms.saveEntryDone")}</span>
        </button>
      )}

      <button
        type="button"
        className={`cw-actions__btn cw-actions__btn--cancel${phase === "generating" ? " is-active" : ""}`}
        onClick={cancel}
        disabled={phase !== "generating"}
        title={t("tms.cancel")}
      >
        <Pause size={14} strokeWidth={2} aria-hidden />
        <span>{t("tms.cancel")}</span>
      </button>

      {primaryAction === "regen" ? (
        <button
          type="button"
          className="cw-actions__btn cw-actions__btn--primary"
          onClick={regenerate}
          disabled={busy || isRunning}
          title={t("tms.regen")}
        >
          <RefreshCw size={14} strokeWidth={2} aria-hidden />
          <span>
            {busy ? t("tms.regen.analyzing") : isRunning ? t("tms.regen.running") : t("tms.regen")}
          </span>
        </button>
      ) : primaryAction === "resume" ? (
        <button
          type="button"
          className="cw-actions__btn cw-actions__btn--primary"
          onClick={resume}
          disabled={busy || isRunning}
          title={t("tms.resume")}
        >
          <RotateCcw size={14} strokeWidth={2} aria-hidden />
          <span>
            {busy ? t("tms.resume.resuming") : isRunning ? t("tms.resume.generating") : t("tms.resume")}
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="cw-actions__btn cw-actions__btn--primary"
          onClick={start}
          disabled={phase !== "routed" || busy || (isHeavyUpload && !ipCanGenerate)}
          title={
            phase !== "routed"
              ? t("tms.start.notRoutedTitle")
              : isHeavyUpload && !ipCanGenerate
                ? t("tms.start.ipScopeTitle")
                : t("tms.start")
          }
        >
          <Play size={14} strokeWidth={2} aria-hidden />
          <span>{busy ? t("tms.start.starting") : isGenerating ? t("tms.start.generating") : t("tms.start")}</span>
        </button>
      )}

      {isRunning && activeEntryKey !== runningEntryKey && (
        <button
          type="button"
          className="cw-actions__hint"
          onClick={() => {
            if (!runningEntryKey) return;
            useNarrativeStore.setState({
              activeEntryKey: runningEntryKey,
              activeEntryStatus: "running",
              activeSteps: runningProgress,
            });
          }}
        >
          {t("tms.runningHint")}
        </button>
      )}
    </div>
  );
}
