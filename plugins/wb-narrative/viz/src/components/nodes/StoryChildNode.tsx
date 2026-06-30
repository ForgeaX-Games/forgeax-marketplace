import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { GenericObjectView } from "../shared/GenericObjectView";
import { useNarrativeStore } from "../../store/narrativeStore";

interface StoryChildData {
  nodeId: string;
  contentId?: string;
  name: string;
  narrativeFunction?: string;
  isBranch?: boolean;
  isMerge?: boolean;
  isFork?: boolean;
  branchLetter?: string;
  content?: string;
  stageType?: string;
  animStartTime?: number;
  ringDuration?: number;
  storyElements?: Record<string, unknown>;
  fullData?: Record<string, unknown>;
}

const NODE_OFFSET_MS = 450;

function StoryChildNodeRaw({ data }: NodeProps<StoryChildData>) {
  const {
    nodeId, contentId, name, narrativeFunction,
    isBranch, isMerge, isFork, branchLetter,
    content, stageType, animStartTime = -1, ringDuration = 1500, storyElements,
    fullData,
  } = data;
  const [expanded, setExpanded] = useState(false);
  const alreadyPlayed = useNarrativeStore((s) => s.animPlayedNodes.includes(data.nodeId));
  const markAnimPlayed = useNarrativeStore((s) => s.markAnimPlayed);

  // Compute remaining delay from absolute timestamp (synced with edge clock)
  const delayRef = useRef<number | null>(null);
  if (animStartTime > 0 && delayRef.current === null) {
    delayRef.current = Math.max(0, animStartTime - Date.now());
  }
  if (animStartTime <= 0) delayRef.current = null;
  const enterDelay = delayRef.current ?? -1;
  const skipAnim = enterDelay < 0 || alreadyPlayed;

  useEffect(() => {
    if (enterDelay >= 0 && !alreadyPlayed) {
      const totalMs = enterDelay + 500 + ringDuration + 400;
      const t = setTimeout(() => markAnimPlayed(data.nodeId), totalMs);
      return () => clearTimeout(t);
    }
  }, [enterDelay, alreadyPlayed, ringDuration, data.nodeId, markAnimPlayed]);

  const cls = isMerge ? "merge" : isBranch ? "branch" : "main";
  // 展示用 id：去掉前端撞号消歧后缀（"5.2#1" → "5.2"），内部 nodeId 仍保唯一用于动画追踪/键。
  const displayId = nodeId.split("#")[0];
  const badge =
    isBranch && branchLetter ? `⑂${branchLetter.toUpperCase()}` :
    isMerge ? "⊕" :
    isFork ? "⑂" : null;

  return (
    <div
      className={`rf-story-child ${cls}${skipAnim ? " no-anim" : ""}`}
      style={{
        ...(!skipAnim ? { "--enter-delay": `${enterDelay}ms` } : {}),
      } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle-sm" />

      <div className="rf-child-collapsed">
        <div className="rf-child-header">
          <span className="rf-child-id">{displayId}</span>
          {badge && <span className="rf-child-badge">{badge}</span>}
          <ChildProgressRing enterDelay={enterDelay} skipAnim={skipAnim} ringDuration={ringDuration} />
        </div>
        <div className="rf-child-name">{name}</div>
        {narrativeFunction && (
          <div className="rf-child-func">{narrativeFunction}</div>
        )}
      </div>

      {expanded && (
        <div className="rf-child-overlay">
          <div className="rf-child-exp-header">
            <span className="rf-child-id">{displayId}</span>
            {contentId && <span className="rf-child-cid">{contentId}</span>}
            {badge && <span className="rf-child-badge">{badge}</span>}
            {stageType && <span className="rf-child-stage">{stageType}</span>}
            <span className="rf-child-close">✕</span>
          </div>
          <div className="rf-child-exp-title">{name}</div>
          {fullData ? (
            <div className="rf-child-exp-content">
              <GenericObjectView data={fullData} />
            </div>
          ) : (
            <>
              {narrativeFunction && (
                <div className="rf-child-exp-func">{narrativeFunction}</div>
              )}
              {content && (
                <div className="rf-child-exp-content">{content}</div>
              )}
              {storyElements && (
                <div className="rf-child-exp-elements">
                  <GenericObjectView data={storyElements} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="rf-handle-sm" />
    </div>
  );
}

/**
 * Pure CSS-driven progress ring for child nodes.
 * Appears after enterDelay, then animates:
 *   0% → 50% in 33%, 50% → 99% in 67%, then ✓ check
 * Total animation duration = ringDuration, driven by CSS @keyframes + custom property
 */
function ChildProgressRing({ enterDelay, skipAnim, ringDuration }: { enterDelay: number; skipAnim: boolean; ringDuration: number }) {
  const size = 14;
  const cx = size / 2, cy = size / 2, r = (size - 2.5) / 2;
  const circ = 2 * Math.PI * r;

  if (skipAnim) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ flexShrink: 0, marginLeft: "auto" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(77,255,160,0.85)" strokeWidth={1.2} />
        <polyline
          points={`${cx - 2.5},${cy} ${cx - 0.8},${cy + 2} ${cx + 3},${cy - 2}`}
          fill="none" stroke="rgba(77,255,160,0.85)" strokeWidth={1.2}
          strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }

  const ringDelay = enterDelay + NODE_OFFSET_MS;

  return (
    <svg
      className="rf-child-progress-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        flexShrink: 0,
        marginLeft: "auto",
        "--ring-delay": `${ringDelay}ms`,
        "--ring-circ": `${circ.toFixed(1)}`,
        "--ring-dur": `${ringDuration}ms`,
      } as React.CSSProperties}
    >
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1.2}
      />
      <circle
        className="rf-child-progress-arc"
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(77,255,160,0.7)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray={`0 ${circ.toFixed(1)}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <polyline
        className="rf-child-progress-check"
        points={`${cx - 2.5},${cy} ${cx - 0.8},${cy + 2} ${cx + 3},${cy - 2}`}
        fill="none"
        stroke="rgba(77,255,160,0.85)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const StoryChildNode = memo(StoryChildNodeRaw);
