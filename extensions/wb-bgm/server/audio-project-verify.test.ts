import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { AudioProject } from '../shared/audio-project.ts';
import { verifyAudioProject } from './audio-project-verify.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempGame(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-audio-verify-'));
  roots.push(root);
  await mkdir(join(root, 'audio'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

function project(): AudioProject {
  return {
    schemaVersion: 'forgeax-audio-project/1',
    projectId: 'demo',
    revision: 3,
    status: 'applied',
    updatedAt: '2026-08-03T03:00:00.000Z',
    bindings: [{
      eventId: 'combat.hit',
      label: '命中',
      enabled: true,
      kind: 'sfx',
      assets: [{ assetId: 'hit', file: 'hit.wav' }],
      variation: { mode: 'single' },
      trigger: { delayMs: 0, cooldownMs: 0, probability: 1 },
      playback: {
        volume: 1,
        bus: 'sfx',
        spatial: '2d',
        mode: 'one-shot',
        fadeInMs: 0,
        fadeOutMs: 0,
      },
      conditions: [],
    }],
  };
}

describe('audio project verification', () => {
  test('accepts an applied project with assets, generated runtime and literal instrumentation', async () => {
    const root = await tempGame();
    await writeFile(join(root, 'audio/hit.wav'), 'RIFF');
    await writeFile(join(root, 'audio/manifest.json'), JSON.stringify({
      version: 1,
      slug: 'demo',
      tracks: [{ assetId: 'hit', file: 'audio/hit.wav', kind: 'sfx' }],
    }));
    await mkdir(join(root, 'src/forgeax-audio'), { recursive: true });
    await Promise.all(['runtime.ts', 'generated-bindings.ts', 'index.ts'].map((file) => (
      writeFile(join(root, 'src/forgeax-audio', file), 'export {};')
    )));
    await writeFile(join(root, 'src/combat.ts'), "gameAudio.emit('combat.hit', { damage: 10 });");

    expect(await verifyAudioProject(root, project())).toEqual({
      ok: true,
      errors: [],
      warnings: [],
      instrumentedEventIds: ['combat.hit'],
    });
  });

  test('reports empty bindings, missing files, missing runtime modules and absent instrumentation', async () => {
    const root = await tempGame();
    const invalid = project();
    invalid.bindings.push({ ...invalid.bindings[0]!, eventId: 'ui.empty', assets: [] });

    const result = await verifyAudioProject(root, invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { code: 'asset_missing', eventId: 'combat.hit', file: 'hit.wav', message: "audio asset 'hit.wav' does not exist" },
      { code: 'binding_assets_empty', eventId: 'ui.empty', message: "binding 'ui.empty' has no audio assets" },
      { code: 'runtime_missing', file: 'src/forgeax-audio/generated-bindings.ts', message: "generated runtime file 'src/forgeax-audio/generated-bindings.ts' does not exist" },
      { code: 'runtime_missing', file: 'src/forgeax-audio/index.ts', message: "generated runtime file 'src/forgeax-audio/index.ts' does not exist" },
      { code: 'runtime_missing', file: 'src/forgeax-audio/runtime.ts', message: "generated runtime file 'src/forgeax-audio/runtime.ts' does not exist" },
      { code: 'event_not_instrumented', eventId: 'combat.hit', message: "event 'combat.hit' has no literal gameAudio.emit/play call" },
      { code: 'event_not_instrumented', eventId: 'ui.empty', message: "event 'ui.empty' has no literal gameAudio.emit/play call" },
    ]);
    expect(result.instrumentedEventIds).toEqual([]);
  });

  test('treats disabled bindings as editable drafts rather than runtime failures', async () => {
    const root = await tempGame();
    const disabled = project();
    disabled.bindings[0] = { ...disabled.bindings[0]!, enabled: false, assets: [] };

    const result = await verifyAudioProject(root, disabled, { requireRuntime: false });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      { code: 'binding_disabled', eventId: 'combat.hit', message: "binding 'combat.hit' is disabled" },
    ]);
  });
});
