import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalState } from './state/GlobalState';
import { Bridge } from './platform/Bridge';
import { App } from './App';

// Vendored @forgeax/design tokens — full --prim-/--color-/--fx-* set, so this
// plugin's iframe bundle is theme-consistent without host CSS injection.
import './design/tokens.css';
// Framework-agnostic layout: 3-pane grid + body[data-pane] show/hide gating.
import './ui/styles.css';
// Tailwind utilities (preflight off).
import './styles/app.css';

const PLUGIN_ID = '@forgeax-plugin/_template';
const SURFACE_ID = 'template';

type Pane = 'left' | 'center' | 'standalone';

function detectPane(): Pane {
  const q = new URLSearchParams(location.search).get('pane');
  if (q === 'left' || q === 'center') return q;
  return 'standalone';
}

function bootstrap() {
  const pane = detectPane();
  document.body.setAttribute('data-pane', pane);

  const state = new GlobalState({ pluginId: PLUGIN_ID, surfaceId: SURFACE_ID, pane });
  const bridge = new Bridge({ pluginId: PLUGIN_ID, surfaceId: SURFACE_ID, pane, state });
  state.bindBridge(bridge);

  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      <StrictMode>
        <App pane={pane} state={state} bridge={bridge} />
      </StrictMode>,
    );
  }

  bridge.announceReady();
}

bootstrap();
