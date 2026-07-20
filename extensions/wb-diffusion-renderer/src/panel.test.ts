import { describe, expect, test } from 'bun:test';
import type { VisualBackendAdapter } from './adapter';
import { firstSelection } from './selection';

function makeRuntime(adapters: VisualBackendAdapter[]) {
  return { adapters };
}

function adapter(
  id: string,
  requiredInputs: Array<'seed-image' | 'viewport-track' | 'semantic-intent'>,
): VisualBackendAdapter {
  return {
    descriptor: {
      id,
      label: id,
      profiles: [{
        id: `${id}-profile`,
        label: `${id} profile`,
        requiredInputs,
        optionalInputs: [],
        outputs: ['presentation-stream'],
        controls: ['prompt'],
      }],
    },
    createSession: () => {
      throw new Error('unused');
    },
  };
}

describe('firstSelection', () => {
  test('prefers LingBot when a prior catalog is available', () => {
    const selection = firstSelection(makeRuntime([
      adapter('reactor-lingbot-world-2', ['seed-image', 'semantic-intent']),
      adapter('fluxrt', ['viewport-track', 'semantic-intent']),
    ]), { priorCatalogAvailable: true });
    expect(selection.backendId).toBe('reactor-lingbot-world-2');
  });

  test('skips seed-image backends when the prior catalog is missing', () => {
    const selection = firstSelection(makeRuntime([
      adapter('reactor-lingbot-world-2', ['seed-image', 'semantic-intent']),
      adapter('fluxrt', ['viewport-track', 'semantic-intent']),
    ]), { priorCatalogAvailable: false });
    expect(selection.backendId).toBe('fluxrt');
  });
});
