import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import type { AudioProject } from '../shared/audio-project.ts';
import { compileAudioRuntime } from './audio-runtime-compiler.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempGame(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-audio-compile-'));
  roots.push(root);
  await mkdir(join(root, 'audio/ui'), { recursive: true });
  return root;
}

function project(file = 'ui/confirm sound.wav'): AudioProject {
  return {
    schemaVersion: 'forgeax-audio-project/1',
    projectId: 'demo',
    revision: 5,
    status: 'draft',
    updatedAt: '2026-08-03T03:00:00.000Z',
    bindings: [{
      eventId: 'ui.confirm',
      label: 'Confirm "special"',
      enabled: true,
      kind: 'sfx',
      assets: [{ assetId: 'ui-ok', file, name: 'Confirm' }],
      variation: { mode: 'single' },
      trigger: { delayMs: 0, cooldownMs: 50, probability: 1 },
      playback: {
        volume: 0.7,
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

describe('audio runtime compiler', () => {
  test('writes deterministic build-safe bindings, runtime and public entry module', async () => {
    const root = await tempGame();
    await writeFile(join(root, 'audio/ui/confirm sound.wav'), 'RIFF');
    await writeFile(join(root, 'audio/manifest.json'), JSON.stringify({
      tracks: [{
        assetId: 'ui-ok',
        shaping: {
          gainDb: 2,
          pitchSemitones: -1,
          highpassHz: 80,
          lowpassHz: 14000,
          eqLowDb: 1,
          eqMidDb: 2,
          eqHighDb: 3,
        },
      }],
    }));
    const runtimeSource = 'export function createForgeaxAudioRuntime(project: unknown) { return project; }\n';

    const first = await compileAudioRuntime(root, project(), runtimeSource);
    const generated = await readFile(join(root, 'src/forgeax-audio/generated-bindings.ts'), 'utf8');
    const runtime = await readFile(join(root, 'src/forgeax-audio/runtime.ts'), 'utf8');
    const generatedModule = await import(`${pathToFileURL(join(root, 'src/forgeax-audio/generated-bindings.ts')).href}?v=1`);
    const indexModule = await import(`${pathToFileURL(join(root, 'src/forgeax-audio/index.ts')).href}?v=1`);
    await compileAudioRuntime(root, project(), runtimeSource);

    expect(first.files).toEqual([
      'src/forgeax-audio/runtime.ts',
      'src/forgeax-audio/generated-bindings.ts',
      'src/forgeax-audio/index.ts',
    ]);
    expect(generatedModule.forgeaxAudioProject).toMatchObject({
      schemaVersion: 'forgeax-audio-runtime/1',
      projectId: 'demo',
      revision: 5,
      bindings: [{
        eventId: 'ui.confirm',
        label: 'Confirm "special"',
        assets: [{
          assetId: 'ui-ok',
          file: 'ui/confirm sound.wav',
          shaping: { gainDb: 2, pitchSemitones: -1, highpassHz: 80, lowpassHz: 14000 },
          url: pathToFileURL(await realpath(join(root, 'audio/ui/confirm sound.wav'))).href,
        }],
      }],
    });
    expect(indexModule.gameAudio).toEqual(generatedModule.forgeaxAudioProject);
    expect(runtime).toBe(runtimeSource);
    expect(await readFile(join(root, 'src/forgeax-audio/generated-bindings.ts'), 'utf8')).toBe(generated);
  });

  test('validates every enabled asset before creating runtime files', async () => {
    const root = await tempGame();

    await expect(compileAudioRuntime(root, project('missing.wav'), 'runtime')).rejects.toMatchObject({
      code: 'asset_missing',
      message: "audio asset 'missing.wav' does not exist",
    });
    await expect(stat(join(root, 'src/forgeax-audio'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('accepts the game-relative audio path returned by attach-audio without duplicating audio', async () => {
    const root = await tempGame();
    await writeFile(join(root, 'audio/ui/confirm sound.wav'), 'RIFF');

    await compileAudioRuntime(
      root,
      project('audio/ui/confirm sound.wav'),
      'export function createForgeaxAudioRuntime(project: unknown) { return project; }\n',
    );
    const generatedModule = await import(
      `${pathToFileURL(join(root, 'src/forgeax-audio/generated-bindings.ts')).href}?prefixed=1`,
    );

    const generatedAsset = generatedModule.forgeaxAudioProject.bindings[0]!.assets[0];
    expect(generatedAsset.file).toBe('ui/confirm sound.wav');
    expect(generatedAsset.url).toEndWith('/audio/ui/confirm%20sound.wav');
    expect(generatedAsset.url).not.toContain('/audio/audio/');
  });

  test('compiles event EQ and game-value sound mappings with nested asset URLs', async () => {
    const root = await tempGame();
    await writeFile(join(root, 'audio/ui/confirm sound.wav'), 'RIFF');
    await writeFile(join(root, 'audio/ui/grass.wav'), 'RIFF');
    const dynamic = project();
    dynamic.bindings[0]!.shaping = {
      gainDb: 0,
      pitchSemitones: 0,
      highpassHz: 20,
      lowpassHz: 12_000,
      eqLowDb: 2,
      eqMidDb: 0,
      eqHighDb: -1,
    };
    dynamic.bindings[0]!.follow = {
      field: 'surface.material',
      defaultValue: '',
      cases: [{
        value: 'grass',
        assets: [{ assetId: 'grass', file: 'ui/grass.wav', name: '草地' }],
      }],
    };

    await compileAudioRuntime(root, dynamic, 'export function createForgeaxAudioRuntime(project: unknown) { return project; }\n');
    const generatedModule = await import(`${pathToFileURL(join(root, 'src/forgeax-audio/generated-bindings.ts')).href}?dynamic=1`);

    expect(generatedModule.forgeaxAudioProject.bindings[0]).toMatchObject({
      shaping: { eqLowDb: 2, eqHighDb: -1, lowpassHz: 12_000 },
      follow: {
        field: 'surface.material',
        cases: [{
          value: 'grass',
          assets: [{ assetId: 'grass', url: expect.stringContaining('/audio/ui/grass.wav') }],
        }],
      },
    });
  });
});
