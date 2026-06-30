import { memo, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";
import { GenericObjectView } from "../shared/GenericObjectView";

interface NarrativeCardData {
  label: string;
  status: StepStatus;
  card?: Record<string, unknown>;
}

const PRIORITY_KEYS = new Set(["game_name", "one_liner", "story", "gameplay_mapping", "level_expansion"]);

function NarrativeCardNodeRaw({ data }: NodeProps<NarrativeCardData>) {
  const { label, status, card } = data;
  const [expanded, setExpanded] = useState(false);
  const extraFields = useMemo(() => {
    if (!card) return null;
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(card)) {
      if (!PRIORITY_KEYS.has(k) && v !== null && v !== undefined && v !== "") {
        extra[k] = v;
      }
    }
    return Object.keys(extra).length > 0 ? extra : null;
  }, [card]);

  const dotColor =
    status === "completed" ? "rgba(77,255,160,0.85)" :
    status === "running" ? "rgba(255,107,53,0.9)" : "rgba(77,255,160,0.15)";

  const hasData = status === "completed" && !!card;

  return (
    <div
      className={`rf-pipeline-node status-${status} type-special`}
      onClick={(e) => { if (hasData) { e.stopPropagation(); setExpanded(!expanded); } }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-pipeline-header">
        <span style={{ fontSize: 8, color: dotColor }}>✦</span>
        <span className="rf-pipeline-label">{label}</span>
      </div>
      {expanded && card && (
        <div className="rf-pipeline-overlay rf-narrative-card-overlay">
          <div className="rf-pipeline-header" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 8, color: dotColor }}>✦</span>
            <span className="rf-pipeline-label">{label}</span>
            <span className="rf-child-close">✕</span>
          </div>
          {typeof card.game_name === "string" && card.game_name && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(77,255,160,0.9)", marginBottom: 6 }}>
              {card.game_name}
            </div>
          )}
          {typeof card.one_liner === "string" && card.one_liner && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 8, fontStyle: "italic" }}>
              {card.one_liner}
            </div>
          )}
          {typeof card.story === "string" && card.story && (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 8, maxHeight: 200, overflow: "auto" }}>
              {card.story}
            </div>
          )}
          {typeof card.gameplay_mapping === "object" && card.gameplay_mapping && (
            <div style={{ fontSize: 10, borderTop: "1px solid rgba(77,255,160,0.15)", paddingTop: 6 }}>
              {Object.entries(card.gameplay_mapping as Record<string, string>).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 3 }}>
                  <span style={{ color: "rgba(77,255,160,0.7)" }}>{k}：</span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {typeof card.level_expansion === "object" && card.level_expansion && (
            <div style={{ fontSize: 10, borderTop: "1px solid rgba(77,255,160,0.15)", paddingTop: 6, marginTop: 6 }}>
              {Object.entries(card.level_expansion as Record<string, string>).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 3 }}>
                  <span style={{ color: "rgba(77,255,160,0.7)" }}>{k}：</span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {extraFields && (
            <div style={{ fontSize: 10, borderTop: "1px solid rgba(77,255,160,0.15)", paddingTop: 6, marginTop: 6 }}>
              <GenericObjectView data={extraFields} />
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

export const NarrativeCardNode = memo(NarrativeCardNodeRaw);
