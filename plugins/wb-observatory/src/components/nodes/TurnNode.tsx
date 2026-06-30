import { Handle, Position, type NodeProps } from 'reactflow';

type TurnStatus = 'thinking' | 'tool_calling' | 'completed';

interface TurnData {
  index: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  userSummary: string;
  assistantSummary: string;
  toolNames: string[];
  hasReminder: boolean;
  subAgentCount: number;
  status?: TurnStatus;
}

const STATUS_INDICATOR: Record<TurnStatus, { color: string; label: string; animate: boolean }> = {
  thinking:     { color: '#FBBF24', label: 'thinking...', animate: true },
  tool_calling: { color: '#A78BFA', label: 'calling tools...', animate: true },
  completed:    { color: '#D4FF48', label: 'done', animate: false },
};

export function TurnNode({ data }: NodeProps<TurnData>) {
  const status = data.status ?? 'completed';
  const si = STATUS_INDICATOR[status];
  const isActive = status !== 'completed';

  return (
    <div
      className={`ob-node ${isActive ? 'ob-node--active' : ''}`}
      data-type="turn"
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--ob-turn)' }} />
      <div className="ob-node__header">
        <span
          className="ob-node__dot"
          style={{
            background: si.color,
            boxShadow: si.animate ? `0 0 8px ${si.color}` : 'none',
            animation: si.animate ? 'ob-blink 1s ease-in-out infinite' : 'none',
          }}
        />
        <span className="ob-node__label">Turn {data.index}</span>
        <span className="ob-node__badge" style={{ color: si.color }}>{si.label}</span>
      </div>
      <div className="ob-node__content">
        <div style={{ marginBottom: 3 }}>▸ {data.userSummary}</div>
        {data.assistantSummary && <div style={{ opacity: 0.7 }}>◂ {data.assistantSummary}</div>}
        {data.toolNames.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {data.toolNames.map((t, i) => (
              <span key={i} style={{ background: 'rgba(167,139,250,0.15)', color: 'var(--ob-tool)', padding: '1px 6px', borderRadius: 4, fontSize: 10 }}>{t}</span>
            ))}
          </div>
        )}
      </div>
      {status === 'completed' && (
        <div className="ob-node__footer">
          ⏱ {(data.durationMs / 1000).toFixed(1)}s · 📥{data.inputTokens} · 📤{data.outputTokens}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--ob-turn)' }} />
    </div>
  );
}
