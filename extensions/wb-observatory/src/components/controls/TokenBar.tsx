import { useState } from 'react';

export function TokenBar() {
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setHeatmapEnabled(!heatmapEnabled)}
      style={{
        position: 'absolute', bottom: 52, right: 12, zIndex: 15,
        padding: '4px 10px', fontSize: 10,
        background: heatmapEnabled ? 'rgba(251,191,36,0.1)' : 'rgba(16,16,16,0.9)',
        border: `1px solid ${heatmapEnabled ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 6, color: heatmapEnabled ? '#FBBF24' : 'var(--ob-node-text-dim)',
        cursor: 'pointer',
      }}
    >
      {heatmapEnabled ? '🔥 Token Heatmap ON' : '🔥 Heatmap'}
    </button>
  );
}
