import type { ViewMode } from "../../store/narrativeStore";
import { useT } from "../../i18n";

interface Props {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}

export function ModeSwitch({ mode, onChange }: Props) {
  const t = useT();
  return (
    <div className="mode-switch">
      <button
        className={`mode-btn ${mode === "text" ? "active" : ""}`}
        onClick={() => onChange("text")}
      >
        <span className="mode-icon">≡</span> {t("mode.text")}
      </button>
      <button
        className={`mode-btn ${mode === "graph" ? "active" : ""}`}
        onClick={() => onChange("graph")}
      >
        <span className="mode-icon">◈</span> {t("mode.graph")}
      </button>
    </div>
  );
}
