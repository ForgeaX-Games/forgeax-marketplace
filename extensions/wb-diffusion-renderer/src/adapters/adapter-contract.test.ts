import { describe, expect, test } from 'bun:test';
import { VisualBackendDescriptorSchema } from '@forgeax/types/visual-generation';
import { FluxRtAdapter, FLUXRT_DESCRIPTOR } from './fluxrt';
import { LingbotWorld2Adapter, LINGBOT_WORLD_2_DESCRIPTOR } from './lingbot-world-2';

describe('visual backend adapter contract', () => {
  test('keeps both provider capability declarations schema-valid and honest', () => {
    for (const descriptor of [FLUXRT_DESCRIPTOR, LINGBOT_WORLD_2_DESCRIPTOR]) {
      expect(() => VisualBackendDescriptorSchema.parse(descriptor)).not.toThrow();
      expect(JSON.stringify(descriptor)).not.toContain('timeline');
    }

    expect(FLUXRT_DESCRIPTOR.profiles[0]?.outputs).toContain('telemetry');
    expect(LINGBOT_WORLD_2_DESCRIPTOR.profiles[0]?.outputs).not.toContain('telemetry');
    expect(LINGBOT_WORLD_2_DESCRIPTOR.profiles[0]?.controls).toEqual([
      'prompt',
      'seed',
      'rotation-speed',
      'attention-window',
      'kv-cache-reset',
    ]);
  });

  test('rejects unsupported profiles before constructing a provider session', () => {
    const adapters = [
      new FluxRtAdapter(),
      new LingbotWorld2Adapter(() => {
        throw new Error('client should not be constructed');
      }),
    ];

    for (const adapter of adapters) {
      expect(() => adapter.createSession({
        profileId: 'not-a-real-profile',
        direction: { prompt: '' },
      })).toThrow('does not provide profile not-a-real-profile');
    }
  });
});
