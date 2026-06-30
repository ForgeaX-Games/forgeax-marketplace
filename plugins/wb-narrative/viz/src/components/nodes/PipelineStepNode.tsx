import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";
import { GenericObjectView } from "../shared/GenericObjectView";
import { useNarrativeStore } from "../../store/narrativeStore";

interface PipelineStepData {
  label: string;
  status: StepStatus;
  stepType: "pipeline" | "story" | "special";
  isSelected?: boolean;
  progress?: number;
  stepData?: unknown;
}

function PipelineStepNodeRaw({ data }: NodeProps<PipelineStepData>) {
  const { label, status, stepType, isSelected, progress, stepData } = data;
  const [expanded, setExpanded] = useState(false);

  const dotColor =
    status === "completed" ? "rgba(77,255,160,0.85)" :
    status === "running" ? "rgba(255,107,53,0.9)" :
    status === "failed" ? "rgba(255,80,80,0.8)" : "rgba(77,255,160,0.15)";

  const isStory = stepType === "story";
  const selectedClass = isSelected ? " selected" : "";
  const hasData = status === "completed" && !!stepData;

  const pct = status === "completed" ? 100 :
              status === "running" ? (progress ?? 50) :
              status === "failed" ? 100 : 0;

  return (
    <div
      className={`rf-pipeline-node status-${status} type-${stepType}${selectedClass}`}
      onClick={(e) => {
        if (hasData) { e.stopPropagation(); setExpanded(!expanded); }
      }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-pipeline-header">
        <span style={{ fontSize: 8, color: dotColor, pointerEvents: "none" }}>
          {isStory ? "◈" : "◆"}
        </span>
        <span className="rf-pipeline-label">{label}</span>
        <ProgressRing pct={pct} status={status} size={16} />
      </div>
      <div className="rf-progress-bar">
        <div
          className={`rf-progress-fill status-${status}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {expanded && hasData && (
        <ExpandedOverlay
          label={label}
          dotColor={dotColor}
          isStory={isStory}
          stepData={stepData}
          status={status}
        />
      )}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

function ProgressRing({ pct, status, size = 16 }: { pct: number; status: string; size?: number }) {
  const cx = size / 2, cy = size / 2, r = (size - 3) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct / 100;
  const color = status === "completed" ? "rgba(77,255,160,0.85)" :
                status === "running" ? "rgba(255,107,53,0.9)" :
                status === "failed" ? "rgba(255,80,80,0.8)" : "rgba(77,255,160,0.15)";

  if (pct >= 100 && status === "completed") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        <polyline
          points={`${cx-3},${cy} ${cx-1},${cy+2.5} ${cx+3.5},${cy-2.5}`}
          fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5}
        strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 2} textAnchor="middle" fill={color}
        fontSize={5} fontFamily="monospace" fontWeight={700}>
        {pct > 0 && pct < 100 ? `${pct}%` : ""}
      </text>
    </svg>
  );
}

function ExpandedOverlay({
  label, dotColor, isStory, stepData, status,
}: {
  label: string; dotColor: string; isStory: boolean; stepData: unknown; status: StepStatus;
}) {
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const canEdit = (activeEntryStatus === "completed" || activeEntryStatus === "interrupted") && status === "completed";

  return (
    <div className="rf-pipeline-overlay">
      <div className="rf-pipeline-header" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 8, color: dotColor, pointerEvents: "none" }}>
          {isStory ? "◈" : "◆"}
        </span>
        <span className="rf-pipeline-label">{label}</span>
        <span className="rf-child-close">✕</span>
      </div>
      <div className="rf-node-detail">
        {typeof stepData === "string" ? (
          <pre className="rf-node-detail-pre">{stepData}</pre>
        ) : (
          <GenericObjectView data={stepData} />
        )}
      </div>
      {canEdit && (
        <div className="rf-overlay-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="rf-overlay-edit-btn"
            onClick={() => {
              useNarrativeStore.getState().setViewMode("text");
              setTimeout(() => setFocus(label), 50);
            }}
            title="切换到文本模式编辑"
          >
            编辑
          </button>
        </div>
      )}
    </div>
  );
}

export const PipelineStepNode = memo(PipelineStepNodeRaw);
