import { Handle, Position, type NodeProps } from 'reactflow';

type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

interface ToolCallData {
  toolName: string;
  inputSummary: string;
  hasReminder: boolean;
  status?: ToolStatus;
}

const STATUS_STYLE: Record<ToolStatus, { color: string; border: string; animate: boolean }> = {
  pending:   { color: 'var(--ob-node-text-dim)', border: 'rgba(167,139,250,0.25)', animate: false },
  running:   { color: '#A78BFA', border: 'rgba(167,139,250,0.5)', animate: true },
  completed: { color: '#D4FF48', border: 'rgba(167,139,250,0.4)', animate: false },
  error:     { color: 'var(--ob-error)', border: 'var(--ob-error)', animate: false },
};

export function ToolCallNode({ data }: NodeProps<ToolCallData>) {
  const status = data.status ?? 'completed';
  const ss = STATUS_STYLE[status];

  return (
    <div
      className="ob-node"
      data-type="tool"
      style={{
        minWidth: 140,
        borderColor: ss.border,
        animation: ss.animate ? 'ob-pulse-turn 1.5s ease-in-out infinite' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--ob-tool)' }} />
      <div className="ob-node__header">
        <span
          className="ob-node__dot"
          style={{
            background: ss.color,
            animation: ss.animate ? 'ob-blink 0.8s ease-in-out infinite' : 'none',
          }}
        />
        <span className="ob-node__label">{data.toolName}</span>
        {status === 'running' && <span className="ob-node__badge" style={{ color: '#A78BFA' }}>running</span>}
        {status === 'error' && <span className="ob-node__badge" style={{ color: 'var(--ob-error)' }}>error</span>}
        {data.hasReminder && <span className="ob-node__badge" style={{ color: 'var(--ob-reminder)' }}>⚡</span>}
      </div>
      <div className="ob-node__content" style={{ maxHeight: 40, overflow: 'hidden' }}>
        {data.inputSummary}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--ob-tool)' }} />
    </div>
  );
}
