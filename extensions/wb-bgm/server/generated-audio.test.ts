import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { attachGeneratedAudio, BgmError } from './core.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectWithGame(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wb-bgm-generated-'));
  temporaryRoots.push(projectRoot);
  await mkdir(resolve(projectRoot, '.forgeax', 'games', 'demo'), { recursive: true });
  return projectRoot;
}

describe('generated audio persistence', () => {
  test('writes decoded bytes and an idempotent generated manifest entry', async () => {
    const projectRoot = await projectWithGame();
    const input = {
      projectRoot,
      slug: 'demo',
      assetId: 'generated:voice:1',
      name: '守卫警告',
      kind: 'sfx' as const,
      base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      mimeType: 'audio/mpeg',
      filename: 'guard-warning.mp3',
      provider: 'litellm',
      model: 'doubao-tts',
      addedBy: 'human' as const,
    };

    const first = await attachGeneratedAudio(input);
    const second = await attachGeneratedAudio(input);
    expect(first.file).toBe('audio/generated/guard-warning.mp3');
    expect(second.reused).toBe(true);
    expect(await readFile(resolve(projectRoot, '.forgeax/games/demo', first.file)))
      .toEqual(Buffer.from([1, 2, 3, 4]));

    const manifest = JSON.parse(
      await readFile(resolve(projectRoot, '.forgeax/games/demo/audio/manifest.json'), 'utf8'),
    );
    expect(manifest.tracks).toHaveLength(1);
    expect(manifest.tracks[0]).toMatchObject({
      assetId: 'generated:voice:1',
      kind: 'sfx',
      file: 'audio/generated/guard-warning.mp3',
      source: 'generated:litellm',
      version: 'doubao-tts',
      addedBy: 'human',
    });
  });

  test('rejects invalid base64 before creating audio files', async () => {
    const projectRoot = await projectWithGame();
    await expect(attachGeneratedAudio({
      projectRoot,
      slug: 'demo',
      assetId: 'generated:bad',
      name: 'bad',
      kind: 'sfx',
      base64: 'not base64!',
    })).rejects.toMatchObject<BgmError>({ code: 'invalid-audio-data' });
  });
});
