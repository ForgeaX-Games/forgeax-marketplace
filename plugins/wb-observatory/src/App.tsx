import { ReactFlowProvider } from 'reactflow';
import { ObservatoryCanvas } from './components/ObservatoryCanvas';
import { ObservatoryToolbar } from './components/ObservatoryToolbar';
import { TimelineSlider } from './components/controls/TimelineSlider';
import { TokenBar } from './components/controls/TokenBar';
import { SearchBar } from './components/controls/SearchBar';
import { useObservatoryStore } from './store/observatoryStore';
import { useEffect } from 'react';

export function App() {
  const { setSessionPath } = useObservatoryStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) setSessionPath(session);

    const handleMessage = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'observatory:load-session') {
        setSessionPath(d.sessionId ?? d.sessionDir ?? null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setSessionPath]);

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
