import { useNarrativeStore } from "../../store/narrativeStore";
import { useT } from "../../i18n";

/**
 * Legacy regeneration panel — kept as a stub.
 * Regeneration is now triggered via the bottom action button in TierModeSelector
 * after saving local drafts in StepCard.
 */
export function RegeneratePanel() {
  const t = useT();
  const hasDrafts = useNarrativeStore((s) =>
    Object.values(s.editDrafts).some((d) => d.saved),
  );
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);

  if (!hasDrafts || activeEntryStatus === "running") return null;

  return (
    <div className="regenerate-panel">
      <div className="regen-header">
        <span className="regen-title">{t("regen.title")}</span>
      </div>
      <div className="regen-input-area" style={{ padding: "8px 12px", opacity: 0.7, fontSize: 12 }}>
        {t("regen.hint")}
      </div>
    </div>
  );
}
