import { Handle, Position, type NodeProps } from 'reactflow';

interface ReminderData {
  date?: string;
  lastInteraction?: string;
  humanActive?: boolean;
  scratchpadPath?: string;
}

export function ReminderNode({ data }: NodeProps<ReminderData>) {
  return (
    <div className="ob-node" data-type="reminder" style={{ minWidth: 140 }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--ob-reminder)' }} />
      <div className="ob-node__header">
        <span className="ob-node__dot" style={{ background: 'var(--ob-reminder)' }} />
        <span className="ob-node__label">reminder</span>
      </div>
      <div className="ob-node__content">
        {data.date && <div>📅 {data.date}</div>}
        {data.lastInteraction && <div>⏱ {data.lastInteraction}</div>}
        {data.scratchpadPath && <div style={{ fontSize: 10, opacity: 0.6 }}>{data.scratchpadPath}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--ob-reminder)' }} />
    </div>
  );
}
