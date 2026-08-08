import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import toolHandlers from './tool-handlers.ts';

const roots: string[] = [];
const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ projectRoot: string; gameDir: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'forgeax-audio-tools-'));
  roots.push(projectRoot);
  const gameDir = join(projectRoot, '.forgeax/games/demo');
  await mkdir(join(gameDir, 'audio'), { recursive: true });
  await mkdir(join(gameDir, 'src'), { recursive: true });
  return { projectRoot, gameDir };
}

function context(projectRoot: string, kind: 'ai' | 'user') {
  return {
    caller: { kind },
    toolId: 'test',
    env: { FORGEAX_PROJECT_ROOT: projectRoot },
    cwd: pluginDir,
    projectRoot,
    game: 'demo',
  };
}

const editableBinding = {
  eventId: 'combat.hit',
  label: '命中',
  enabled: true,
  kind: 'sfx',
  assets: [{ assetId: 'hit', file: 'hit.wav' }],
  variation: { mode: 'random-no-repeat' },
  trigger: { delayMs: 20, cooldownMs: 100, probability: 0.9 },
  playback: {
    volume: 0.8,
    bus: 'sfx',
    spatial: '3d',
    mode: 'one-shot',
    fadeInMs: 0,
    fadeOutMs: 50,
  },
  conditions: [{ field: 'damage', operator: 'gte', value: 10 }],
};

describe('shared audio project plugin tools', () => {
  test('publishes every audio project operation to AI and gates apply with confirmation', async () => {
    const manifest = JSON.parse(await readFile(join(pluginDir, 'forgeax-extension.json'), 'utf8')) as {
      contributes: { tools: Array<{ id: string; exposedToAI?: boolean; requireConfirm?: string }> };
    };
    const descriptors = Object.fromEntries(manifest.contributes.tools.map((tool) => [tool.id, tool]));

    for (const id of [
      'inspect-audio-events',
      'get-audio-project',
      'patch-audio-project',
      'apply-audio-project',
      'verify-audio-project',
    ]) {
      expect(descriptors[id]?.exposedToAI).toBe(true);
    }
    expect(descriptors['apply-audio-project']?.requireConfirm).toBe('always');
  });

  test('lets AI create a draft that the user reads and protects it from stale edits', async () => {
    const { projectRoot } = await fixture();
    const handlers = toolHandlers as Record<string, (args: any, ctx: any) => Promise<any>>;

    const empty = await handlers['get-audio-project']!({ slug: 'demo' }, context(projectRoot, 'user'));
    expect(empty.project.revision).toBe(0);

    const patched = await handlers['patch-audio-project']!({
      slug: 'demo',
      expectedRevision: 0,
      upsertBindings: [editableBinding],
      removeEventIds: [],
    }, context(projectRoot, 'ai'));
    expect(patched.project.revision).toBe(1);

    const visibleToUser = await handlers['get-audio-project']!({ slug: 'demo' }, context(projectRoot, 'user'));
    expect(visibleToUser.project.bindings[0]).toMatchObject(editableBinding);

    await expect(handlers['patch-audio-project']!({
      slug: 'demo',
      expectedRevision: 0,
      removeEventIds: ['combat.hit'],
    }, context(projectRoot, 'user'))).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 1 });
  });

  test('inspects without writing and applies the expected draft into generated game files', async () => {
    const { projectRoot, gameDir } = await fixture();
    const handlers = toolHandlers as Record<string, (args: any, ctx: any) => Promise<any>>;
    await writeFile(join(gameDir, 'audio/hit.wav'), 'RIFF');
    await writeFile(join(gameDir, 'src/combat.ts'), "EventBus.instance.emit('combat:attack_hit', data);");

    const inspection = await handlers['inspect-audio-events']!({ slug: 'demo' }, context(projectRoot, 'ai'));
    expect(inspection.candidates).toEqual([
      expect.objectContaining({ eventId: 'combat:attack_hit', file: 'src/combat.ts', line: 1 }),
    ]);
    await expect(readFile(join(gameDir, 'audio/project.draft.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await handlers['patch-audio-project']!({
      slug: 'demo',
      expectedRevision: 0,
      upsertBindings: [editableBinding],
    }, context(projectRoot, 'ai'));
    const applied = await handlers['apply-audio-project']!({
      slug: 'demo',
      expectedRevision: 1,
    }, context(projectRoot, 'user'));

    expect(applied.project).toMatchObject({ revision: 1, status: 'applied' });
    expect(applied.files).toEqual([
      'src/forgeax-audio/runtime.ts',
      'src/forgeax-audio/generated-bindings.ts',
      'src/forgeax-audio/index.ts',
    ]);
    expect(JSON.parse(await readFile(join(gameDir, 'audio/project.json'), 'utf8'))).toMatchObject({
      revision: 1,
      status: 'applied',
    });
  });

  test('verifies applied instrumentation and preserves the previous applied project on invalid re-apply', async () => {
    const { projectRoot, gameDir } = await fixture();
    const handlers = toolHandlers as Record<string, (args: any, ctx: any) => Promise<any>>;
    await writeFile(join(gameDir, 'audio/hit.wav'), 'RIFF');
    await writeFile(join(gameDir, 'src/combat.ts'), "gameAudio.emit('combat.hit', { damage: 20 });");
    await handlers['patch-audio-project']!({
      slug: 'demo', expectedRevision: 0, upsertBindings: [editableBinding],
    }, context(projectRoot, 'ai'));
    await handlers['apply-audio-project']!({ slug: 'demo', expectedRevision: 1 }, context(projectRoot, 'user'));

    const verified = await handlers['verify-audio-project']!({ slug: 'demo' }, context(projectRoot, 'ai'));
    expect(verified).toMatchObject({ ok: true, instrumentedEventIds: ['combat.hit'] });

    const before = await readFile(join(gameDir, 'audio/project.json'), 'utf8');
    await handlers['patch-audio-project']!({
      slug: 'demo',
      expectedRevision: 1,
      upsertBindings: [{ ...editableBinding, assets: [{ assetId: 'missing', file: 'missing.wav' }] }],
    }, context(projectRoot, 'user'));
    await expect(handlers['apply-audio-project']!({
      slug: 'demo', expectedRevision: 2,
    }, context(projectRoot, 'user'))).rejects.toMatchObject({ code: 'asset_missing' });
    expect(await readFile(join(gameDir, 'audio/project.json'), 'utf8')).toBe(before);
  });
});
