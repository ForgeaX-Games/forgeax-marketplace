import { Handle, Position, type NodeProps } from 'reactflow';

interface SystemModuleData {
  id: string;
  tag: string | null;
  charCount: number;
  estimatedTokens: number;
  percentOfTotal: number;
  sourceFile?: string;
  findingsCount?: number;
  errorCount?: number;
  isPersona?: boolean;
  model?: string;
  persona?: string;
  status?: string;
}

export function SystemModuleNode({ data }: NodeProps<SystemModuleData>) {
  const color = data.isPersona ? 'var(--ob-persona)' : 'var(--ob-system)';
  const isSession = data.id === 'session';

  return (
    <div className="ob-node" data-type={data.isPersona ? 'persona' : 'system'} style={{ cursor: 'pointer' }}>
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div className="ob-node__header">
        <span className="ob-node__dot" style={{ background: color }} />
        <span className="ob-node__label">{isSession ? (data.persona ?? 'session') : data.id}</span>
        {data.status && (
          <span className="ob-node__badge" style={data.status === 'running' ? { background: 'rgba(212,255,72,0.1)', color: '#D4FF48' } : undefined}>
            {data.status}
          </span>
        )}
      </div>
      <div className="ob-node__content">
        {isSession && data.model && <span>{data.model}</span>}
        {!isSession && data.tag && <span>&lt;{data.tag}&gt;</span>}
        {!isSession && !data.tag && <span style={{ color: 'var(--ob-error)' }}>NO TAG</span>}
      </div>
      {isSession && (
        <div className="ob-node__footer" style={{ opacity: 0.5, fontSize: 9 }}>
          double-click to inspect context
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}
