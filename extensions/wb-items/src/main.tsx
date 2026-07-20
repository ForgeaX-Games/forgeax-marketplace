import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initLocaleSync } from './i18n';
import './styles.css';

initLocaleSync();

type Pane = 'left' | 'center' | 'standalone';

function detectPane(): Pane {
  const pane = new URLSearchParams(window.location.search).get('pane');
  if (pane === 'left' || pane === 'center') return pane;
  return 'standalone';
}

const pane = detectPane();
document.body.dataset.pane = pane;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App pane={pane} />
    </StrictMode>,
  );
}
