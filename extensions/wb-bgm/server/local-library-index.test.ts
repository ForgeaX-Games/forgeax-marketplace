import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('local audio library index builder', () => {
  test('builds stable entries only for safe supported audio files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeax-local-audio-index-'));
    temporaryRoots.push(root);
    await mkdir(join(root, 'bgm', '09_results'), { recursive: true });
    await mkdir(join(root, 'sfx', '1_ui', 'common'), { recursive: true });
    await writeFile(join(root, 'bgm', '09_results', 'Victory_Loop_02.ogg'), 'OggSfixture');
    await writeFile(join(root, 'sfx', '1_ui', 'common', 'click_00.mp3'), 'ID3fixture');

    const module = await import('../scripts/build-local-library-index.ts').catch(() => null);
    expect(module?.buildLocalLibraryIndex).toBeFunction();

    const index = await module!.buildLocalLibraryIndex(root);

    expect(index).toEqual({
      schemaVersion: 'forgeax-local-audio-library/1',
      libraryVersion: '2026-08-07',
      assetCount: 2,
      assets: [
        {
          assetId: 'local:bgm:sha256:287da1a9172fdf74fa3649c81af7427a214e5c46f0c1fa0ac8aacb7eef217f3a',
          kind: 'bgm',
          relativePath: 'bgm/09_results/Victory_Loop_02.ogg',
          fileName: 'Victory_Loop_02.ogg',
          displayName: 'Victory Loop 02',
          mimeType: 'audio/ogg',
          extension: '.ogg',
          bytes: 11,
          sha256: '287da1a9172fdf74fa3649c81af7427a214e5c46f0c1fa0ac8aacb7eef217f3a',
          source: 'builtin',
          version: '287da1a9172f',
          loopFromName: true,
          variantGroup: 'Victory_Loop',
          variantIndex: 2,
        },
        {
          assetId: 'local:sfx:sha256:7f330705156c04c2a1ca7638e7868c95263af09c9befbc92d3422e4f7aec686a',
          kind: 'sfx',
          relativePath: 'sfx/1_ui/common/click_00.mp3',
          fileName: 'click_00.mp3',
          displayName: 'click 00',
          mimeType: 'audio/mpeg',
          extension: '.mp3',
          bytes: 10,
          sha256: '7f330705156c04c2a1ca7638e7868c95263af09c9befbc92d3422e4f7aec686a',
          source: 'builtin',
          version: '7f330705156c',
          loopFromName: false,
          variantGroup: 'click',
          variantIndex: 0,
        },
      ],
    });
  });

  test('rejects unsupported files instead of silently omitting them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeax-local-audio-unsupported-'));
    temporaryRoots.push(root);
    await writeFile(join(root, 'README.txt'), 'not audio');

    const module = await import('../scripts/build-local-library-index.ts');

    await expect(module.buildLocalLibraryIndex(root)).rejects.toThrow(
      'unsupported local audio file: README.txt',
    );
  });

  test('rejects symbolic links instead of silently omitting unsafe entries', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'forgeax-local-audio-symlink-'));
    temporaryRoots.push(temporaryRoot);
    const root = join(temporaryRoot, 'library');
    await mkdir(join(root, 'bgm'), { recursive: true });
    const outside = join(temporaryRoot, 'outside.ogg');
    await writeFile(outside, 'OggSoutside');
    await symlink(outside, join(root, 'bgm', 'escape.ogg'));

    const module = await import('../scripts/build-local-library-index.ts');

    await expect(module.buildLocalLibraryIndex(root)).rejects.toThrow(
      'unsafe audio library entry: bgm/escape.ogg',
    );
  });

  test('sorts relative paths by deterministic code-unit order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeax-local-audio-sort-'));
    temporaryRoots.push(root);
    await mkdir(join(root, 'bgm'), { recursive: true });
    await writeFile(join(root, 'bgm', 'Z.ogg'), 'OggSupper');
    await writeFile(join(root, 'bgm', 'a.ogg'), 'OggSlower');

    const module = await import('../scripts/build-local-library-index.ts');
    const index = await module.buildLocalLibraryIndex(root);

    expect(index.assets.map((asset) => asset.relativePath)).toEqual([
      'bgm/Z.ogg',
      'bgm/a.ogg',
    ]);
  });

  test('committed index describes exactly the packaged 30 BGM and 100 SFX files', async () => {
    const pluginRoot = resolve(import.meta.dir, '..');
    const indexBytes = await readFile(
      join(pluginRoot, 'data', 'local-library-index.json'),
    ).catch(() => null);
    expect(indexBytes).not.toBeNull();
    if (!indexBytes) return;

    const index = JSON.parse(indexBytes.toString()) as {
      schemaVersion: string;
      libraryVersion: string;
      assetCount: number;
      assets: Array<{
        assetId: string;
        kind: 'bgm' | 'sfx';
        relativePath: string;
        extension: string;
        bytes: number;
        sha256: string;
      }>;
    };
    const bgm = index.assets.filter((asset) => asset.kind === 'bgm');
    const sfx = index.assets.filter((asset) => asset.kind === 'sfx');

    expect(index.schemaVersion).toBe('forgeax-local-audio-library/1');
    expect(index.libraryVersion).toBe('2026-08-07');
    expect(index.assetCount).toBe(130);
    expect(bgm).toHaveLength(30);
    expect(sfx).toHaveLength(100);
    expect(new Set(index.assets.map((asset) => asset.assetId)).size).toBe(130);
    expect(index.assets.some((asset) => asset.relativePath.includes('.DS_Store'))).toBe(false);

    for (const asset of index.assets) {
      const bytes = await readFile(join(pluginRoot, 'public', 'library', 'builtin', asset.relativePath));
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(asset.extension).toBe(asset.kind === 'bgm' ? '.ogg' : '.mp3');
    }
  });

  test('rejects a committed index after an audio file changes', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'forgeax-local-audio-drift-'));
    temporaryRoots.push(temporaryRoot);
    const root = join(temporaryRoot, 'library');
    await mkdir(join(root, 'bgm'), { recursive: true });
    const audioFile = join(root, 'bgm', 'theme.ogg');
    const indexFile = join(temporaryRoot, 'local-library-index.json');
    await writeFile(audioFile, 'OggSfixture');

    const module = await import('../scripts/build-local-library-index.ts');
    expect(module.verifyLocalLibraryIndex).toBeFunction();
    const index = await module.buildLocalLibraryIndex(root);
    await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
    await expect(module.verifyLocalLibraryIndex(root, indexFile)).resolves.toBeUndefined();

    await writeFile(audioFile, 'OggSchanged');

    await expect(module.verifyLocalLibraryIndex(root, indexFile)).rejects.toThrow(
      'local audio library index is out of date',
    );
  });
});
