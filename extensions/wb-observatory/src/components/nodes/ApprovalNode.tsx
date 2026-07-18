import { Handle, Position, type NodeProps } from 'reactflow';

interface ApprovalData {
  from: string;
  summary?: string;
  status: 'pending' | 'approved' | 'rejected';
}

const STATUS_STYLES = {
  pending: { border: 'var(--ob-reminder)', icon: '🔒', label: 'pending' },
  approved: { border: '#D4FF48', icon: '✓', label: 'approved' },
  rejected: { border: 'var(--ob-error)', icon: '✗', label: 'rejected' },
};

export function ApprovalNode({ data }: NodeProps<ApprovalData>) {
  const s = STATUS_STYLES[data.status];
  return (
    <div className="ob-node" data-type="reminder" style={{ borderColor: s.border, borderStyle: 'dashed', minWidth: 160 }}>
      <Handle type="target" position={Position.Top} style={{ background: s.border }} />
      <div className="ob-node__header">
        <span className="ob-node__dot" style={{ background: s.border }} />
        <span className="ob-node__label">approval</span>
        <span className="ob-node__badge">{s.icon} {s.label}</span>
      </div>
      <div className="ob-node__content">
        <div>from: {data.from}</div>
        {data.summary && <div style={{ marginTop: 3 }}>"{data.summary.slice(0, 80)}"</div>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: s.border }} />
    </div>
  );
}
