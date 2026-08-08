import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  changeCustomAudioKind,
  deleteCustomAudio,
  importCustomAudio,
  listCustomAudio,
  resolveCustomAudio,
} from './custom-audio-library.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-custom-audio-'));
  temporaryRoots.push(root);
  return root;
}

const oggBytes = Buffer.from('OggS-custom-bgm');
const mp3Bytes = Buffer.from('ID3-custom-sfx');

describe('custom audio catalog', () => {
  test('requires explicit BGM/SFX kind and stores registered content by hash', async () => {
    const root = await projectRoot();
    const bgm = await importCustomAudio({
      kind: 'bgm',
      fileName: '玩家主题.ogg',
      mimeType: 'audio/ogg',
      base64: oggBytes.toString('base64'),
    }, root);
    const sfx = await importCustomAudio({
      kind: 'sfx',
      fileName: '确认.mp3',
      mimeType: 'audio/mpeg',
      base64: mp3Bytes.toString('base64'),
    }, root);

    expect(bgm.asset.assetId).toMatch(/^custom:bgm:sha256:[a-f0-9]{64}$/);
    expect(sfx.asset.assetId).toMatch(/^custom:sfx:sha256:[a-f0-9]{64}$/);
    expect(bgm.asset.kind).toBe('bgm');
    expect(sfx.asset.kind).toBe('sfx');
    expect(await readFile(bgm.absolutePath)).toEqual(oggBytes);
    expect(await readFile(sfx.absolutePath)).toEqual(mp3Bytes);
    expect((await listCustomAudio(root)).assets.map((asset) => asset.kind)).toEqual(['bgm', 'sfx']);
  });

  test('deduplicates within a kind and preserves the original registered record', async () => {
    const root = await projectRoot();
    const first = await importCustomAudio({
      kind: 'sfx', fileName: 'first.wav', mimeType: 'audio/wav',
      base64: Buffer.from('RIFF-custom').toString('base64'),
    }, root);
    const second = await importCustomAudio({
      kind: 'sfx', fileName: 'renamed.wav', mimeType: 'audio/wav',
      base64: Buffer.from('RIFF-custom').toString('base64'),
    }, root);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.asset).toEqual(first.asset);
    expect((await listCustomAudio(root, 'sfx')).assets).toHaveLength(1);
  });

  test('keeps a valid catalog unchanged when a later file fails', async () => {
    const root = await projectRoot();
    await importCustomAudio({
      kind: 'bgm', fileName: 'safe.ogg', mimeType: 'audio/ogg',
      base64: oggBytes.toString('base64'),
    }, root);
    const indexFile = resolve(root, '.forgeax/assets/audio-custom/index.json');
    const before = await readFile(indexFile);

    await expect(importCustomAudio({
      kind: 'sfx', fileName: 'bad.mp3', mimeType: 'audio/mpeg', base64: 'not base64!',
    }, root)).rejects.toMatchObject({ code: 'invalid-audio-data' });

    expect(await readFile(indexFile)).toEqual(before);
    expect((await listCustomAudio(root)).assets).toHaveLength(1);
  });

  test('rejects traversal, unsupported formats, and kind inference', async () => {
    const root = await projectRoot();
    await expect(importCustomAudio({
      kind: 'sfx', fileName: '../escape.mp3', mimeType: 'audio/mpeg',
      base64: mp3Bytes.toString('base64'),
    }, root)).rejects.toMatchObject({ code: 'invalid-file-name' });
    await expect(importCustomAudio({
      kind: 'sfx', fileName: 'clip.aac', mimeType: 'audio/aac',
      base64: mp3Bytes.toString('base64'),
    }, root)).rejects.toMatchObject({ code: 'unsupported-audio-format' });
    await expect(importCustomAudio({
      kind: 'auto' as 'sfx', fileName: 'clip.mp3', mimeType: 'audio/mpeg',
      base64: mp3Bytes.toString('base64'),
    }, root)).rejects.toMatchObject({ code: 'invalid-kind' });
    expect(existsSync(resolve(root, '.forgeax/assets/audio-custom/index.json'))).toBe(false);
  });

  test('deletes registrations and treats missing files as unavailable', async () => {
    const root = await projectRoot();
    const imported = await importCustomAudio({
      kind: 'bgm', fileName: 'delete-me.ogg', mimeType: 'audio/ogg',
      base64: oggBytes.toString('base64'),
    }, root);

    expect(await resolveCustomAudio(root, imported.asset.assetId)).not.toBeNull();
    expect(await deleteCustomAudio(root, imported.asset.assetId)).toBe(true);
    expect(await deleteCustomAudio(root, imported.asset.assetId)).toBe(false);
    expect(await resolveCustomAudio(root, imported.asset.assetId)).toBeNull();
    expect((await listCustomAudio(root)).assets).toHaveLength(0);

    const missing = await importCustomAudio({
      kind: 'sfx', fileName: 'missing.mp3', mimeType: 'audio/mpeg',
      base64: mp3Bytes.toString('base64'),
    }, root);
    await unlink(missing.absolutePath);
    expect(await resolveCustomAudio(root, missing.asset.assetId)).toBeNull();
  });

  test('changes category only when explicitly requested and preserves bytes', async () => {
    const root = await projectRoot();
    const imported = await importCustomAudio({
      kind: 'sfx', fileName: '可循环音效.mp3', mimeType: 'audio/mpeg',
      base64: mp3Bytes.toString('base64'),
    }, root);

    const changed = await changeCustomAudioKind(root, imported.asset.assetId, 'bgm');

    expect(changed.asset.kind).toBe('bgm');
    expect(changed.asset.assetId).toMatch(/^custom:bgm:sha256:/);
    expect(await resolveCustomAudio(root, imported.asset.assetId)).toBeNull();
    const resolved = await resolveCustomAudio(root, changed.asset.assetId);
    expect(await readFile(resolved!.absolutePath)).toEqual(mp3Bytes);
  });
});
