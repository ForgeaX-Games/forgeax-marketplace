import { Handle, Position, type NodeProps } from 'reactflow';
import { TraceBadge } from './TraceBadge';

type AgentStatus = 'spawning' | 'running' | 'completed' | 'failed';

interface SubAgentData {
  agentId: string;
  agentType?: string;
  task?: string;
  status: AgentStatus;
  resultSummary?: string;
  turns?: number;
  lastProgress?: string;
}

const STATUS_STYLE: Record<AgentStatus, { color: string; label: string; animate: boolean }> = {
  spawning:  { color: '#FBBF24', label: 'spawning', animate: true },
  running:   { color: '#D4FF48', label: 'running', animate: true },
  completed: { color: '#D4FF48', label: 'completed', animate: false },
  failed:    { color: 'var(--ob-error)', label: 'failed', animate: false },
};

export function SubAgentNode({ id, data }: NodeProps<SubAgentData>) {
  const ss = STATUS_STYLE[data.status] ?? STATUS_STYLE.completed;

  return (
    <div
      className={`ob-node ${ss.animate ? 'ob-node--active' : ''}`}
      data-type="agent"
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--ob-agent)' }} />
      <div className="ob-node__header">
        <span
          className="ob-node__dot"
          style={{
            background: ss.color,
            animation: ss.animate ? 'ob-blink 1s ease-in-out infinite' : 'none',
          }}
        />
        <span className="ob-node__label">{data.agentId}</span>
        {data.agentType && <span className="ob-node__badge">{data.agentType}</span>}
        <TraceBadge nodeId={id} />
      </div>
      <div className="ob-node__content">
        {data.task && <div style={{ marginBottom: 3 }}>"{data.task.slice(0, 50)}"</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: ss.color }}>● {ss.label}</span>
          {data.turns != null && data.turns > 0 && (
            <span style={{ color: 'var(--ob-node-text-dim)', fontSize: 10 }}>
              {data.turns} turn{data.turns > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {data.lastProgress && data.status === 'running' && (
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--ob-node-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.lastProgress}
          </div>
        )}
        {data.resultSummary && (
          <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 4 }}>
            {data.resultSummary.slice(0, 100)}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--ob-agent)' }} />
    </div>
  );
}
