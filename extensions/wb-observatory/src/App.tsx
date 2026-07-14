import { ReactFlowProvider } from 'reactflow';
import { ObservatoryCanvas } from './components/ObservatoryCanvas';
import { ObservatoryToolbar } from './components/ObservatoryToolbar';
import { TimelineSlider } from './components/controls/TimelineSlider';
import { TokenBar } from './components/controls/TokenBar';
import { SearchBar } from './components/controls/SearchBar';
import { useObservatoryStore } from './store/observatoryStore';
import { useEffect } from 'react';

export function App() {
  const { setSessionPath, setSessionMode } = useObservatoryStore();

  useEffect(() => {
    // Pin sessionPath AND sessionMode together — a supplied sid means "replay
    // this saved session" (static), a cleared one means "follow the newest"
    // (live). Setting the path alone would leave sessionMode on its 'live'
    // default, mislabelling a pinned replay as Live. This mirrors the toolbar's
    // onPick contract so every entry point keeps the two in lockstep.
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) { setSessionMode('static'); setSessionPath(session); }

    const handleMessage = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'observatory:load-session') {
        const sid = d.sessionId ?? d.sessionDir ?? null;
        setSessionMode(sid ? 'static' : 'live');
        setSessionPath(sid);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setSessionPath, setSessionMode]);

  return (
    <div className="observatory-root">
      <ObservatoryToolbar />
      <div className="observatory-canvas-container" style={{ position: 'relative' }}>
        <ReactFlowProvider>
          <ObservatoryCanvas />
        </ReactFlowProvider>
        <SearchBar />
        <TokenBar />
        <TimelineSlider totalTurns={0} />
      </div>
    </div>
  );
}
