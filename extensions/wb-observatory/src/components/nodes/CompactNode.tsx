import { Handle, Position, type NodeProps } from 'reactflow';

interface CompactData {
  compressedCount: number;
  transcriptPath?: string;
}

export function CompactNode({ data }: NodeProps<CompactData>) {
  return (
    <div className="ob-node" data-type="reminder" style={{ minWidth: 160, borderStyle: 'dashed', opacity: 0.7 }}>
      <Handle type="target" position={Position.Top} style={{ background: '#8b5cf6' }} />
      <div className="ob-node__header">
        <span className="ob-node__dot" style={{ background: '#8b5cf6' }} />
        <span className="ob-node__label">compact</span>
      </div>
      <div className="ob-node__content">
        ≡ {data.compressedCount} messages compressed
        {data.transcriptPath && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3 }}>{data.transcriptPath}</div>}
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ob-turn)' }}>▶ click to load</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#8b5cf6' }} />
    </div>
  );
}
