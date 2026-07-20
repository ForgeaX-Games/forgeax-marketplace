import { useState } from 'react';
import { Play, Puzzle } from 'lucide-react';
import type { GlobalState } from './state/GlobalState';
import type { Bridge } from './platform/Bridge';
import { useGlobalState } from './hooks/useGlobalState';
import { Button } from '@/components/ui/button';

interface AppProps {
  pane: 'left' | 'center' | 'standalone';
  state: GlobalState;
  bridge: Bridge;
}

/**
 * Reference panel for split-surface plugins. The host loads this same bundle
 * up to three times (?pane=left | center | standalone); body[data-pane] gating
 * in ui/styles.css shows the relevant region. Everything visual is shadcn +
 * @forgeax/design tokens, so the plugin tracks the host theme and is skinnable.
 */
export function App({ state, bridge }: AppProps) {
  const s = useGlobalState(state);
  const [draft, setDraft] = useState('');

  const runEcho = async () => {
    const text = draft.trim();
    if (!text) return;
    state.setBusiness({ prompt: text, busy: true });
    try {
      const result = await bridge.callTool('template:echo', { text });
      state.setBusiness({ lastResult: JSON.stringify(result), busy: false });
    } catch (err) {
      state.setBusiness({ lastResult: `error: ${(err as Error).message}`, busy: false });
    }
  };

  return (
    <div id="app" className="text-foreground">
      <header className="pane-topbar">
        <span className="brand inline-flex items-center gap-2 text-foreground">
          <Puzzle className="h-4 w-4 text-primary" /> Plugin Template
        </span>
      </header>

      <aside className="pane-left">
        <div className="left-root flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">prompt</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={draft}
              placeholder="type something…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runEcho(); }}
            />
          </label>
          <Button size="sm" disabled={s.busy || !draft.trim()} onClick={() => void runEcho()}>
            <Play /> {s.busy ? 'running…' : 'Run echo'}
          </Button>
        </div>
      </aside>

      <main className="pane-center">
        <div className="flex h-full w-full items-center justify-center bg-muted/30">
          <div className="rounded-lg border border-border bg-card p-8 text-center text-card-foreground">
            <div className="mb-2 text-sm text-muted-foreground">center viewport</div>
            <div className="font-mono text-sm">
              {s.prompt ? `prompt: "${s.prompt}"` : '(no prompt yet)'}
            </div>
            {s.lastResult && (
              <div className="mt-3 max-w-md break-all font-mono text-xs text-info">
                {s.lastResult.slice(0, 240)}
              </div>
            )}
          </div>
        </div>
      </main>

      <aside className="pane-right">
        <div className="right-root text-sm text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Standalone info</p>
          <p>This pane shows only in standalone mode. Use ?pane=left / ?pane=center when embedded by the host.</p>
        </div>
      </aside>

      <footer className="pane-bottom">
        <span className="status">{s.busy ? 'busy' : 'idle'}</span>
      </footer>
    </div>
  );
}
