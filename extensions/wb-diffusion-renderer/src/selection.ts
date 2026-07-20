import type { VisualBackendProfile } from '@forgeax/types/visual-generation';
import type { VisualBackendAdapter, VisualDirection } from './adapter';
import type { VisualPresenterSelection } from './presenter';

export interface GenerativeVisualsSelectionRuntime {
  readonly adapters: readonly VisualBackendAdapter[];
}

function profileRequiresSeedImage(profile: VisualBackendProfile | undefined): boolean {
  return profile?.requiredInputs.includes('seed-image') ?? false;
}

/** Prefer LingBot when a prior catalog exists; otherwise skip seed-image backends. */
export function firstSelection(
  runtime: GenerativeVisualsSelectionRuntime,
  options: { readonly priorCatalogAvailable?: boolean } = {},
): VisualPresenterSelection {
  const allowSeedImage = options.priorCatalogAvailable !== false;
  const preferred = allowSeedImage
    ? runtime.adapters.find((candidate) => candidate.descriptor.id === 'reactor-lingbot-world-2')
    : runtime.adapters.find((candidate) => !profileRequiresSeedImage(candidate.descriptor.profiles[0]));
  const adapter = preferred
    ?? runtime.adapters.find((candidate) => (
      allowSeedImage || !profileRequiresSeedImage(candidate.descriptor.profiles[0])
    ))
    ?? runtime.adapters[0];
  const profile = adapter?.descriptor.profiles[0];
  if (!adapter || !profile) throw new Error('No generative visual backends are installed');
  const controls = profile.controls ?? [];
  return {
    backendId: adapter.descriptor.id,
    profileId: profile.id,
    direction: {
      prompt: '',
      ...(controls.includes('seed') ? { seed: 42 } : {}),
      ...(controls.includes('quality') ? { quality: 'realtime' as const } : {}),
      ...(controls.includes('rotation-speed') ? { rotationSpeedDeg: 5 } : {}),
      ...(controls.includes('attention-window') ? { attentionWindow: 'auto' as const } : {}),
      ...(controls.includes('kv-cache-reset')
        ? { kvCacheResetMode: 'auto' as const, kvCacheResetSequence: 0 }
        : {}),
    } satisfies VisualDirection,
  };
}

export { profileRequiresSeedImage };
