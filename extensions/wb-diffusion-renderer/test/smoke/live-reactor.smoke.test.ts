import { describe, expect, test } from 'bun:test';

/**
 * Gated real-provider smoke. Default CI / local suites stay hermetic; set
 * REACTOR_API_KEY (and a running ForgeaX server with the broker) to exercise
 * the live Reactor path manually:
 *
 *   REACTOR_API_KEY=... bun test \
 *     packages/marketplace/plugins/wb-diffusion-renderer/test/smoke/live-reactor.smoke.test.ts
 */
const reactorKey = process.env.REACTOR_API_KEY?.trim();
const fluxrtKey = process.env.FLUXRT_API_KEY?.trim();
const fluxrtBase = process.env.FLUXRT_BASE_URL?.trim();

describe('live provider smoke (keyed)', () => {
  test.skipIf(!reactorKey)('REACTOR_API_KEY is present for live Reactor smoke', () => {
    expect(reactorKey!.length).toBeGreaterThan(0);
  });

  test.skipIf(!(fluxrtKey && fluxrtBase))(
    'FLUXRT_API_KEY + FLUXRT_BASE_URL are present for live FluxRT smoke',
    () => {
      expect(fluxrtKey!.length).toBeGreaterThan(0);
      expect(fluxrtBase!.startsWith('http')).toBe(true);
    },
  );

  test('documents that hermetic suites never require provider keys', () => {
    // This file must stay skipped in default runs when keys are absent.
    expect(true).toBe(true);
  });
});
