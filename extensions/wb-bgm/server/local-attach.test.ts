import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { localAudioLibrary } from './local-audio-library.ts';
import tools from './tool-handlers.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('packaged local audio attachment', () => {
  test('copies registered OGG and MP3 bytes, ignores caller paths, and reuses asset IDs', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'forgeax-local-attach-'));
    temporaryRoots.push(projectRoot);
    const gameRoot = join(projectRoot, '.forgeax', 'games', 'demo');
    await mkdir(gameRoot, { recursive: true });

    const inventedSource = join(projectRoot, 'caller-controlled.mp3');
    await writeFile(inventedSource, 'must not be copied');

    const [bgm, sfx] = await Promise.all([
      localAudioLibrary.findAssets({ kind: 'bgm', page: 1, pageSize: 1 }),
      localAudioLibrary.findAssets({ kind: 'sfx', page: 1, pageSize: 1 }),
    ]);
    const bgmId = bgm.assets[0]?.asset_id ?? '';
    const sfxId = sfx.assets[0]?.asset_id ?? '';
    const resolvedBgm = await localAudioLibrary.resolveAsset(bgmId);
    const resolvedSfx = await localAudioLibrary.resolveAsset(sfxId);
    expect(resolvedBgm).not.toBeNull();
    expect(resolvedSfx).not.toBeNull();

    const context = {
      caller: { kind: 'user' },
      toolId: 'attach-audio',
      env: { FORGEAX_PROJECT_ROOT: projectRoot },
    };
    const attach = async (assetId: string, kind: 'bgm' | 'sfx') =>
      await tools['attach-audio']({
        assetId,
        kind,
        slug: 'demo',
        resUrl: 'https://caller.invalid/ignored',
        sourcePath: inventedSource,
      } as Parameters<typeof tools['attach-audio']>[0], context);

    const attachedBgm = await attach(bgmId, 'bgm');
    const attachedSfx = await attach(sfxId, 'sfx');
    const attachedSfxAgain = await attach(sfxId, 'sfx');

    const copiedBgm = await readFile(join(gameRoot, attachedBgm.file));
    const copiedSfx = await readFile(join(gameRoot, attachedSfx.file));
    expect(digest(copiedBgm)).toBe(digest(await readFile(resolvedBgm!.absolutePath)));
    expect(digest(copiedSfx)).toBe(digest(await readFile(resolvedSfx!.absolutePath)));
    expect(copiedSfx.toString()).not.toBe('must not be copied');
    expect(attachedSfxAgain.reused).toBe(true);
    expect(attachedSfxAgain.file).toBe(attachedSfx.file);

    const manifest = JSON.parse(
      await readFile(join(gameRoot, 'audio', 'manifest.json'), 'utf8'),
    ) as { tracks: Array<Record<string, unknown>> };
    expect(manifest.tracks).toHaveLength(2);
    expect(manifest.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: bgmId,
        kind: 'bgm',
        file: attachedBgm.file,
        version: resolvedBgm!.version,
        source: 'builtin',
      }),
      expect.objectContaining({
        assetId: sfxId,
        kind: 'sfx',
        file: attachedSfx.file,
        version: resolvedSfx!.version,
        source: 'builtin',
      }),
    ]));
  });

  test('rejects invented asset IDs even when the caller supplies a readable file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'forgeax-local-attach-reject-'));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, '.forgeax', 'games', 'demo'), { recursive: true });
    const inventedSource = join(projectRoot, 'invented.mp3');
    await writeFile(inventedSource, 'caller-controlled');

    await expect(tools['attach-audio']({
      assetId: 'local:sfx:sha256:not-registered',
      kind: 'sfx',
      slug: 'demo',
      sourcePath: inventedSource,
    } as Parameters<typeof tools['attach-audio']>[0], {
      caller: { kind: 'user' },
      toolId: 'attach-audio',
      env: { FORGEAX_PROJECT_ROOT: projectRoot },
    })).rejects.toMatchObject({ code: 'asset-not-found' });
  });
});
