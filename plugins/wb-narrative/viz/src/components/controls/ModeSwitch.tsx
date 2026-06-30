import type { ViewMode } from "../../store/narrativeStore";

interface Props {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}

export function ModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="mode-switch">
      <button
        className={`mode-btn ${mode === "text" ? "active" : ""}`}
        onClick={() => onChange("text")}
      >
        <span className="mode-icon">≡</span> 文本模式
      </button>
      <button
        className={`mode-btn ${mode === "graph" ? "active" : ""}`}
        onClick={() => onChange("graph")}
      >
        <span className="mode-icon">◈</span> 可视化节点模式
      </button>
    </div>
  );
}
