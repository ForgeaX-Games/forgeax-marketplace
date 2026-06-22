import { useNarrativeStore } from "../../store/narrativeStore";

/**
 * Legacy regeneration panel — kept as a stub.
 * Regeneration is now triggered via the bottom action button in TierModeSelector
 * after saving local drafts in StepCard.
 */
export function RegeneratePanel() {
  const hasDrafts = useNarrativeStore((s) =>
    Object.values(s.editDrafts).some((d) => d.saved),
  );
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);

  if (!hasDrafts || activeEntryStatus === "running") return null;

  return (
    <div className="regenerate-panel">
      <div className="regen-header">
        <span className="regen-title">草稿已保存</span>
      </div>
      <div className="regen-input-area" style={{ padding: "8px 12px", opacity: 0.7, fontSize: 12 }}>
        请点击底部「重新生成」按钮，基于已保存的草稿 Fork 新分支。
      </div>
    </div>
  );
}
