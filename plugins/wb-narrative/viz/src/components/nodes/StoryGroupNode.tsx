import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";

interface PhaseInfo {
  id: string;
  label: string;
  done?: boolean;
  active?: boolean;
}

interface StoryGroupData {
  label: string;
  status: StepStatus;
  childCount: number;
  expanded: boolean;
  progress?: number;
  phases?: PhaseInfo[];
}

function StoryGroupNodeRaw({ data }: NodeProps<StoryGroupData>) {
  const { label, status, childCount, expanded, progress, phases } = data;

  const dotColor =
    status === "completed" ? "rgba(77,255,160,0.85)" :
    status === "running" ? "rgba(255,107,53,0.9)" :
    status === "failed" ? "rgba(255,80,80,0.8)" : "rgba(77,255,160,0.15)";

  const pct = status === "completed" ? 100 :
              status === "running" ? (progress ?? 50) :
              status === "failed" ? 100 : 0;

  const isComposite = !!phases?.length;

  return (
    <div className={`rf-story-group status-${status} ${expanded ? "expanded" : "collapsed"}${isComposite ? " composite" : ""}`}>
      <Handle type="target" position={Position.Left} className="rf-handle" />

      <div className="rf-story-group-header">
        <span style={{ fontSize: 8, color: dotColor, pointerEvents: "none" }}>◈</span>
        <span className="rf-story-group-label">{label}</span>
        {childCount > 0 && (
          <span className="rf-story-group-count">{childCount}</span>
        )}
        <ProgressRing pct={pct} status={status} size={16} />
        {expanded && <span className="rf-story-collapse-hint">▾</span>}
        {!expanded && childCount > 0 && <span className="rf-story-collapse-hint">▸</span>}
      </div>

      {/* Phase badges for composite nodes (e.g. scene generation P1→P2→P3) */}
      {isComposite && (
        <div className="rf-phase-bar">
          {phases!.map((ph, idx) => (
            <span key={ph.id} className="rf-phase-item">
              {idx > 0 && <span className="rf-phase-arrow">→</span>}
              <span className={`rf-phase-badge${ph.done ? " done" : ""}${ph.active ? " active" : ""}`}>
                {ph.label}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="rf-progress-bar">
        <div
          className={`rf-progress-fill status-${status}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!expanded && childCount > 0 && (
        <div className="rf-story-summary">
          {childCount} 节点（点击展开）
        </div>
      )}
      {!expanded && childCount === 0 && (
        <div className="rf-story-summary dim">
          {status === "pending" ? "等待生成..." : status === "running" ? "生成中..." : "无节点数据"}
        </div>
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
      {pct > 0 && pct < 100 && (
        <text x={cx} y={cy + 2} textAnchor="middle" fill={color}
          fontSize={5} fontFamily="monospace" fontWeight={700}>
          {pct}%
        </text>
      )}
    </svg>
  );
}

export const StoryGroupNode = memo(StoryGroupNodeRaw);
