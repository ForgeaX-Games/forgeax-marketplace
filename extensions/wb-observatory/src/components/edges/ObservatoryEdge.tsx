import { getBezierPath, type EdgeProps } from 'reactflow';

const EDGE_STYLES: Record<string, { stroke: string; strokeWidth: number; dashArray?: string; animate?: boolean }> = {
  sequential: { stroke: 'rgba(212,255,72,0.35)', strokeWidth: 2 },
  fork:       { stroke: 'rgba(249,115,22,0.6)', strokeWidth: 3 },
  merge:      { stroke: 'rgba(249,115,22,0.35)', strokeWidth: 2, dashArray: '8 4', animate: true },
  message:    { stroke: '#38BDF8', strokeWidth: 2 },
  approval_req: { stroke: 'rgba(251,191,36,0.5)', strokeWidth: 1.5, dashArray: '6 3' },
  approval_res: { stroke: '#D4FF48', strokeWidth: 2 },
  injection:  { stroke: 'rgba(251,191,36,0.35)', strokeWidth: 1.5, dashArray: '3 3' },
};

export function ObservatoryEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const edgeType = (data?.edgeType as string) || 'sequential';
  const style = EDGE_STYLES[edgeType] ?? EDGE_STYLES.sequential;

  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  return (
    <g>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dashArray}
        filter={`drop-shadow(0 0 4px ${style.stroke})`}
      >
        {style.animate && (
          <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1s" repeatCount="indefinite" />
        )}
      </path>
      {data?.label && (
        <text x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2 - 8} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="middle">
          {String(data.label).slice(0, 40)}
        </text>
      )}
    </g>
  );
}
