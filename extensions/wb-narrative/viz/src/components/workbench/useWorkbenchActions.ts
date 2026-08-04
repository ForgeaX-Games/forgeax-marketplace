import { useCallback, useMemo } from "react";
import { useNarrativeStore, useNarrativePhase } from "../../store/narrativeStore";
import { isHeavyUploadSet } from "../../lib/uploads";
import { fireIpGenerate } from "../../lib/ipGenerateBridge";
import { useT } from "../../i18n";

export type PrimaryAction = "start" | "resume" | "regen" | "none";

/**
 * 操作条的动作门面：判断该亮哪个主按钮，并把点击转成命令。
 *
 * 全部只读 store，因此中栏 iframe 也能算得准；真正的执行落在 owner 侧的 WorkbenchProvider。
 * 唯一的例外是重需求的 IP 生成——它的触发闭包在渲染 IpStageFlow 的那个文档里，
 * 所以先就地 fire，fire 不到（本文档没渲染）才退回命令槽。
 */
export function useWorkbenchActions() {
  const t = useT();
  const phase = useNarrativePhase();
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const pendingFork = useNarrativeStore((s) => s.pendingFork);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const uploadedFiles = useNarrativeStore((s) => s.input.uploadedFiles);
  const ipCanGenerate = useNarrativeStore((s) => s.ipCanGenerate);
  const busy = useNarrativeStore((s) => s.workbenchBusy);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const ipDnaJob = useNarrativeStore((s) => s.ipDnaJob);
  const requestCommand = useNarrativeStore((s) => s.requestCommand);
  const setEntryDirty = useNarrativeStore((s) => s.setEntryDirty);
  const setWorkbenchError = useNarrativeStore((s) => s.setWorkbenchError);

  const hasDrafts = useMemo(() => Object.values(editDrafts).some((d) => d.saved), [editDrafts]);
  const isHeavyUpload = isHeavyUploadSet(uploadedFiles);
  const isRunning = !!runningRunId;
  const ipDnaRunning =
    !!ipDnaJob && ipDnaJob.status !== "completed" && ipDnaJob.status !== "failed" && ipDnaJob.status !== "cancelled";

  /**
   * 主按钮语义（以 activeEntryStatus 为准，草稿条目 status=null 也算 start）：
   *   running → none（不能再操作正在跑的）；有分叉待决 → start（铸新条目 fork，压过 resume/none）；
   *   有 step 草稿 → regen；interrupted → resume；completed → none；其余 → start。
   */
  const primaryAction = useMemo<PrimaryAction>(() => {
    if (activeEntryStatus === "running") return "none";
    if (pendingFork) return "start";
    if (hasDrafts) return "regen";
    if (activeEntryStatus === "interrupted") return "resume";
    if (activeEntryStatus === "completed") return "none";
    return "start";
  }, [activeEntryStatus, pendingFork, hasDrafts]);

  const start = useCallback(() => {
    if (isHeavyUpload) {
      if (!ipCanGenerate) {
        setWorkbenchError(t("tms.error.ipScopeRequired"));
        return;
      }
      if (fireIpGenerate()) {
        setEntryDirty(false); // 开始生成即视为已保存（IP 路径自身已落盘配置/确认）
        return;
      }
    }
    requestCommand("start");
  }, [isHeavyUpload, ipCanGenerate, requestCommand, setEntryDirty, setWorkbenchError, t]);

  const cancel = useCallback(() => requestCommand("cancel"), [requestCommand]);
  const resume = useCallback(() => requestCommand("resume"), [requestCommand]);
  const regenerate = useCallback(() => requestCommand("regenerate"), [requestCommand]);

  return {
    phase,
    primaryAction,
    busy,
    isRunning,
    isGenerating: isRunning || ipDnaRunning,
    isHeavyUpload,
    ipCanGenerate,
    canStart: phase === "routed" && !busy && !(isHeavyUpload && !ipCanGenerate),
    start,
    cancel,
    resume,
    regenerate,
  };
}
