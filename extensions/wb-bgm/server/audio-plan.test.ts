import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyAudioPlan } from './apply-audio-plan.ts';
import { verifyAudioProject } from './audio-project-verify.ts';
import { BgmError, type BgmConfig } from './core.ts';
import {
  deleteCustomAudio,
  importCustomAudio,
  resolveCustomAudio,
} from './custom-audio-library.ts';
import { localAudioLibrary } from './local-audio-library.ts';
import { resolveAudioPlan } from './resolve-audio-plan.ts';
import toolHandlers from './tool-handlers.ts';
import type { AudioProject } from '../shared/audio-project.ts';

const cfg: BgmConfig = {
  depot: 'builtin',
};

const originalFetch = globalThis.fetch;
const originalResolveAsset = localAudioLibrary.resolveAsset;
const temporaryRoots: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  localAudioLibrary.resolveAsset = originalResolveAsset;
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function gameProject(slug = 'demo'): Promise<{
  projectRoot: string;
  gameRoot: string;
  audioRoot: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wb-bgm-audio-plan-'));
  temporaryRoots.push(projectRoot);
  const gameRoot = resolve(projectRoot, '.forgeax', 'games', slug);
  const audioRoot = resolve(gameRoot, 'audio');
  await mkdir(gameRoot, { recursive: true });
  return { projectRoot, gameRoot, audioRoot };
}

function resolvedItem(
  eventId: string,
  assetId: string,
  resUrl: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventId,
    status: 'exact',
    familyId: `family.${eventId}`,
    selectedFamily: {
      familyId: `family.${eventId}`,
      variants: [{ assetId, name: `${eventId}.wav`, version: 'v1', resUrl }],
    },
    ...overrides,
  };
}

async function packagedVariants(limit: number) {
  const { assets } = await localAudioLibrary.findAssets({
    kind: 'sfx',
    page: 1,
    pageSize: limit,
  });
  return assets.map((asset) => ({
    assetId: asset.asset_id ?? '',
    name: asset.name ?? asset.asset_id ?? '',
    version: asset.versions?.[0]?.version_name ?? '',
    resUrl: asset.versions?.[0]?.res_url ?? '',
  }));
}

describe('resolve-audio-plan', () => {
  test('batch resolves exact, fallback, gap and item-level errors without a score gate', async () => {
    const result = await resolveAudioPlan(cfg, {
      projectId: 'default',
      dryRun: true,
      items: [
        {
          eventId: 'combat.hit',
          playerGoal: '确认金属命中',
          cue: 'combat.attack.impact',
          targetMaterial: 'metal',
        },
        {
          eventId: 'footstep.generic',
          playerGoal: '反馈木地板移动',
          cue: 'movement.footstep',
          targetMaterial: 'wood',
        },
        {
          eventId: 'unknown.event',
          playerGoal: '覆盖未知事件',
          cue: 'unknown.event',
        },
        {
          eventId: 'missing.cue',
          playerGoal: '验证坏输入隔离',
        },
      ],
    });

    expect(result.summary).toEqual({
      requested: 4,
      exact: 1,
      fallback: 1,
      gap: 1,
      error: 1,
    });
    expect(result.items.map((item) => item.status)).toEqual([
      'exact',
      'fallback',
      'gap',
      'error',
    ]);
    expect(result.items[0]?.selectedFamily?.score).toBeGreaterThan(0);
  });

  test('rejects duplicate event IDs instead of creating ambiguous bindings', async () => {
    await expect(
      resolveAudioPlan(cfg, {
        projectId: 'default',
        dryRun: true,
        items: [
          {
            eventId: 'combat.hit',
            playerGoal: '确认命中',
            cue: 'combat.attack.impact',
          },
          {
            eventId: 'combat.hit',
            playerGoal: '反馈挥动',
            cue: 'combat.attack.swing',
          },
        ],
      }),
    ).rejects.toThrow('duplicate eventId');
  });
});

describe('AI audio tool routing', () => {
  test('rejects SFX attempts through the legacy BGM search', async () => {
    await expect(
      toolHandlers['search-audio'](
        { query: 'hit', kind: 'sfx' },
        { caller: { kind: 'ai' }, toolId: 'search-audio' },
      ),
    ).rejects.toMatchObject({ code: 'sfx-audio-plan-required' });
  });
});

describe('apply-audio-plan', () => {
  test('uses a registered custom SFX immediately and keeps the game valid after library deletion', async () => {
    const { projectRoot, gameRoot } = await gameProject();
    const bytes = Buffer.from('ID3-custom-impact-sword-metal-heavy');
    const imported = await importCustomAudio({
      kind: 'sfx',
      fileName: 'impact_sword_metal_heavy.mp3',
      mimeType: 'audio/mpeg',
      base64: bytes.toString('base64'),
    }, projectRoot);
    await mkdir(resolve(projectRoot, '.forgeax/assets/audio-custom/sfx/loose'), { recursive: true });
    await writeFile(
      resolve(projectRoot, '.forgeax/assets/audio-custom/sfx/loose/unregistered-impact.mp3'),
      'ID3-unregistered',
    );

    const plan = await resolveAudioPlan(cfg, {
      projectId: 'demo',
      slug: 'demo',
      topK: 3,
      items: [{
        eventId: 'combat.hit',
        playerGoal: '重剑击中金属',
        cue: 'combat.attack.impact',
        source: 'sword',
        targetMaterial: 'metal',
        intensity: 'heavy',
      }],
    }, projectRoot);

    expect(plan.items[0]?.selectedFamily).toMatchObject({
      reviewStatus: '用户明确导入',
      variants: [{ assetId: imported.asset.assetId }],
    });
    expect(JSON.stringify(plan)).not.toContain('unregistered-impact');

    const applied = await applyAudioPlan(cfg, {
      slug: 'demo',
      planId: plan.planId,
      items: plan.items,
    }, projectRoot);
    const attached = applied.items[0]!.assets[0]!;
    expect(await readFile(resolve(gameRoot, attached.file))).toEqual(bytes);

    await deleteCustomAudio(projectRoot, imported.asset.assetId);
    expect(await resolveCustomAudio(projectRoot, imported.asset.assetId)).toBeNull();
    expect(await readFile(resolve(gameRoot, attached.file))).toEqual(bytes);

    await mkdir(resolve(gameRoot, 'src'), { recursive: true });
    await writeFile(resolve(gameRoot, 'src/combat.ts'), "gameAudio.emit('combat.hit');");
    const project: AudioProject = {
      schemaVersion: 'forgeax-audio-project/1',
      projectId: 'demo',
      revision: 1,
      status: 'draft',
      updatedAt: '2026-08-07T00:00:00.000Z',
      bindings: [{
        eventId: 'combat.hit',
        label: '命中',
        enabled: true,
        kind: 'sfx',
        assets: [{ assetId: attached.assetId, file: attached.file }],
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
    expect(await verifyAudioProject(gameRoot, project, { requireRuntime: false })).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  test('copies packaged variants by assetId without fetching the preview URL', async () => {
    const { projectRoot, audioRoot } = await gameProject();
    const { assets } = await localAudioLibrary.findAssets({
      kind: 'sfx',
      query: 'rpg turn confirm',
      page: 1,
      pageSize: 1,
    });
    const assetId = assets[0]?.asset_id ?? '';
    const resUrl = assets[0]?.versions?.[0]?.res_url ?? '';
    const resolved = await localAudioLibrary.resolveAsset(assetId);
    expect(resolved).not.toBeNull();

    globalThis.fetch = (async () => {
      throw new Error('packaged audio must not use fetch');
    }) as typeof fetch;

    const result = await applyAudioPlan(
      cfg,
      {
        slug: 'demo',
        planId: 'plan-packaged',
        items: [resolvedItem('ui.confirm', assetId, resUrl)],
      },
      projectRoot,
    );

    expect(result.summary.applied).toBe(1);
    expect(result.items[0]?.errors).toEqual([]);
    expect(
      await readFile(resolve(audioRoot, result.items[0]!.assets[0]!.file.replace(/^audio\//, ''))),
    ).toEqual(await readFile(resolved!.absolutePath));
  });

  test('creates manifest/cues, preserves cue fields, and reuses files on repeat', async () => {
    const { projectRoot, audioRoot } = await gameProject();
    const [variant] = await packagedVariants(1);
    await mkdir(audioRoot, { recursive: true });
    await writeFile(
      resolve(audioRoot, 'cues.json'),
      JSON.stringify({
        schemaVersion: 'audio-cue-graph/1',
        kind: 'audio-cue-graph',
        buses: { sfx: { volume: 0.8 } },
      }),
    );

    globalThis.fetch = (async () => {
      throw new Error('packaged audio must not use fetch');
    }) as typeof fetch;

    const options = {
      slug: 'demo',
      planId: 'plan-1',
      items: [
        resolvedItem('combat.hit', variant!.assetId, variant!.resUrl),
      ],
    };
    const first = await applyAudioPlan(cfg, options, projectRoot);
    const second = await applyAudioPlan(cfg, options, projectRoot);

    expect(first.summary.applied).toBe(1);
    expect(second.summary.reused).toBe(1);
    expect(second.pendingBindings).toEqual(['combat.hit']);

    const manifest = JSON.parse(
      await readFile(resolve(audioRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.tracks).toHaveLength(1);
    expect(manifest.tracks[0]).toMatchObject({
      assetId: variant!.assetId,
      kind: 'sfx',
      addedBy: 'ai',
    });

    const cues = JSON.parse(await readFile(resolve(audioRoot, 'cues.json'), 'utf8'));
    expect(cues).toMatchObject({
      schemaVersion: 'audio-cue-graph/1',
      kind: 'audio-cue-graph',
      buses: { sfx: { volume: 0.8 } },
    });
    expect(cues.assetBindings['combat.hit'].assets).toHaveLength(1);
  });

  test('fails before downloading when an existing manifest is invalid', async () => {
    const { projectRoot, audioRoot } = await gameProject();
    await mkdir(audioRoot, { recursive: true });
    const invalidManifest = '{"slug":"demo","tracks":';
    await writeFile(resolve(audioRoot, 'manifest.json'), invalidManifest);

    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;

    try {
      await applyAudioPlan(
        cfg,
        {
          slug: 'demo',
          planId: 'plan-invalid',
          items: [
            resolvedItem('combat.hit', 'asset-hit-1', 'https://assets.test/hit.wav'),
          ],
        },
        projectRoot,
      );
      throw new Error('expected applyAudioPlan to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BgmError);
      expect((error as BgmError).code).toBe('manifest-invalid');
    }

    expect(fetchCount).toBe(0);
    expect(await readFile(resolve(audioRoot, 'manifest.json'), 'utf8')).toBe(
      invalidManifest,
    );
  });

  test('rejects a manifest for another slug without overwriting it', async () => {
    const { projectRoot, audioRoot } = await gameProject();
    await mkdir(audioRoot, { recursive: true });
    const mismatched = JSON.stringify({ version: 1, slug: 'other', tracks: [] });
    await writeFile(resolve(audioRoot, 'manifest.json'), mismatched);

    await expect(
      applyAudioPlan(
        cfg,
        {
          slug: 'demo',
          planId: 'plan-mismatch',
          items: [
            resolvedItem('combat.hit', 'asset-hit-1', 'https://assets.test/hit.wav'),
          ],
        },
        projectRoot,
      ),
    ).rejects.toMatchObject({ code: 'manifest-slug-mismatch' });

    expect(await readFile(resolve(audioRoot, 'manifest.json'), 'utf8')).toBe(
      mismatched,
    );
  });

  test('isolates missing packaged assets and never processes gap items', async () => {
    const { projectRoot } = await gameProject();
    const [validVariant] = await packagedVariants(1);
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error('packaged audio must not use fetch');
    }) as typeof fetch;

    const result = await applyAudioPlan(
      cfg,
      {
        slug: 'demo',
        planId: 'plan-partial',
        items: [
          resolvedItem('ui.confirm', validVariant!.assetId, validVariant!.resUrl),
          resolvedItem('combat.hit', 'asset-broken', 'https://assets.test/broken.wav'),
          {
            eventId: 'unknown.event',
            status: 'gap',
          },
        ],
      },
      projectRoot,
    );

    expect(result.items.map((item) => item.status)).toEqual([
      'applied',
      'failed',
      'failed',
    ]);
    expect(result.pendingBindings).toEqual(['ui.confirm']);
    expect(fetchCount).toBe(0);
  });

  test('copies packaged variants concurrently without losing manifest tracks', async () => {
    const { projectRoot, audioRoot } = await gameProject();
    let active = 0;
    let peak = 0;
    localAudioLibrary.resolveAsset = async (assetId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      try {
        return await originalResolveAsset.call(localAudioLibrary, assetId);
      } finally {
        active -= 1;
      }
    };

    const variants = await packagedVariants(8);
    const result = await applyAudioPlan(
      cfg,
      {
        slug: 'demo',
        planId: 'plan-concurrent',
        items: [{
          eventId: 'combat.combo.hit',
          status: 'exact',
          familyId: 'combat.combo',
          selectedFamily: { familyId: 'combat.combo', variants },
        }],
      },
      projectRoot,
    );

    expect(result.summary.applied).toBe(1);
    expect(result.items[0]?.assets).toHaveLength(8);
    expect(peak).toBe(6);
    const manifest = JSON.parse(
      await readFile(resolve(audioRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.tracks).toHaveLength(8);
    expect(new Set(manifest.tracks.map((track: { assetId: string }) =>
      track.assetId)).size).toBe(8);
  });
});
