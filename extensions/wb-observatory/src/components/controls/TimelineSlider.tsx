import { useObservatoryStore } from '../../store/observatoryStore';

export function TimelineSlider({ totalTurns }: { totalTurns: number }) {
  const { selectedTurnIndex, setSelectedTurn } = useObservatoryStore();

  if (totalTurns === 0) return null;

  return (
    <div className="ob-timeline">
      <button type="button" onClick={() => setSelectedTurn(Math.max(0, selectedTurnIndex - 1))} style={{ background: 'none', border: 'none', color: 'var(--ob-node-text-dim)', cursor: 'pointer' }}>◀</button>
      <input
        type="range"
        min={0}
        max={Math.max(0, totalTurns - 1)}
        value={selectedTurnIndex}
        onChange={(e) => setSelectedTurn(Number(e.target.value))}
      />
      <button type="button" onClick={() => setSelectedTurn(Math.min(totalTurns - 1, selectedTurnIndex + 1))} style={{ background: 'none', border: 'none', color: 'var(--ob-node-text-dim)', cursor: 'pointer' }}>▶</button>
      <span className="ob-timeline__label">Turn {selectedTurnIndex}/{totalTurns - 1}</span>
    </div>
  );
}
