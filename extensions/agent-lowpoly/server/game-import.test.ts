import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Document, WebIO } from '@gltf-transform/core';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gameImportStatus, importLowpolyAsset } from './game-import.ts';
import { tools } from './tool-handlers.ts';

let root: string;
let sourceDir: string;
let sourcePath: string;

async function buildGlb(name: string, offset = 0): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([offset, 0, 0, 1 + offset, 0, 0, offset, 1, 0]))
    .setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION', position);
  const mesh = document.createMesh(name).addPrimitive(primitive);
  const scene = document.createScene('Scene');
  scene.addChild(document.createNode(name).setMesh(mesh));
  return new WebIO().writeBinary(document);
}

function gameDir(game = 'case-game'): string {
  return join(root, '.forgeax', 'games', game);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'forgeax-lowpoly-import-'));
  sourceDir = join(root, '.forgeax', 'workbench', 'wb-3d-lowpoly', 'assets', '3d');
  sourcePath = join(sourceDir, 'treasure_chest.glb');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(gameDir(), { recursive: true });
  writeFileSync(sourcePath, await buildGlb('TreasureChest'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('lowpoly game delivery', () => {
  test('imports a real GLB, cooks engine identity, and reports model-readable status', async () => {
    const destinationDir = join(gameDir(), 'assets', '3d', 'props');
    const stateDir = join(root, '.forgeax', 'agent-lowpoly', 'imports');
    const before = await gameImportStatus(root, 'case-game', sourcePath);
    expect(before).toMatchObject({ ok: true, imported: false, assetPath: 'assets/3d/props/treasure_chest.glb' });
    expect(existsSync(destinationDir)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);

    const imported = await importLowpolyAsset(root, 'case-game', sourcePath);
    expect(imported).toMatchObject({
      ok: true,
      imported: true,
      game: 'case-game',
      assetPath: 'assets/3d/props/treasure_chest.glb',
      engineMetaPath: 'assets/3d/props/treasure_chest.glb.meta.json',
      normalizedDraco: false,
    });
    const destination = join(gameDir(), imported.assetPath);
    const meta = JSON.parse(readFileSync(`${destination}.meta.json`, 'utf8')) as {
      kind: string;
      source: string;
      subAssets: Array<{ kind: string }>;
    };
    expect(meta.kind).toBe('external-asset-package');
    expect(meta.source).toBe('treasure_chest.glb');
    expect(new Set(meta.subAssets.map((entry) => entry.kind))).toEqual(new Set(['mesh', 'scene']));

    const after = await gameImportStatus(root, 'case-game', sourcePath);
    expect(after).toMatchObject({ ok: true, imported: true, sourceHash: imported.sourceHash, contentHash: imported.contentHash });
  });

  test('treats a modified engine identity as stale', async () => {
    const imported = await importLowpolyAsset(root, 'case-game', sourcePath);
    const metaPath = join(gameDir(), imported.engineMetaPath);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(metaPath, `${JSON.stringify({ ...meta, tampered: true }, null, 2)}\n`);

    const status = await gameImportStatus(root, 'case-game', sourcePath);
    expect(status).toMatchObject({ imported: false, retryable: true });
    expect(status.message).toContain('engine identity changed');
  });

  test('source changes make status stale; re-import preserves existing GUIDs', async () => {
    const first = await importLowpolyAsset(root, 'case-game', sourcePath);
    const metaPath = join(gameDir(), `${first.assetPath}.meta.json`);
    const firstMeta = JSON.parse(readFileSync(metaPath, 'utf8')) as { subAssets: Array<{ kind: string; guid: string }> };
    const firstMeshGuid = firstMeta.subAssets.find((entry) => entry.kind === 'mesh')?.guid;

    writeFileSync(sourcePath, await buildGlb('TreasureChestV2', 0.25));
    const stale = await gameImportStatus(root, 'case-game', sourcePath);
    expect(stale).toMatchObject({ imported: false, retryable: true });
    expect(stale.message).toContain('changed after delivery');

    const second = await importLowpolyAsset(root, 'case-game', sourcePath);
    const secondMeta = JSON.parse(readFileSync(metaPath, 'utf8')) as { subAssets: Array<{ kind: string; guid: string }> };
    expect(second.reusedGuidCount).toBeGreaterThan(0);
    expect(secondMeta.subAssets.find((entry) => entry.kind === 'mesh')?.guid).toBe(firstMeshGuid);
    expect((await gameImportStatus(root, 'case-game', sourcePath)).imported).toBe(true);
  });

  test('detects a source change before commit and writes no game asset', async () => {
    const pending = importLowpolyAsset(root, 'case-game', sourcePath, {
      beforeSourceRecheck: async () => {
        writeFileSync(sourcePath, await buildGlb('ChangedDuringImport', 0.5));
      },
    });
    await expect(pending).rejects.toMatchObject({ code: 'asset_changed_retry', retryable: true });
    expect(existsSync(join(gameDir(), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(false);
  });

  test('state commit failure stays fail-closed and a retry recovers', async () => {
    await expect(
      importLowpolyAsset(root, 'case-game', sourcePath, {
        beforeStateCommit: () => {
          throw new Error('simulated state failure');
        },
      }),
    ).rejects.toMatchObject({ code: 'import_state_write_failed', retryable: true });
    expect(existsSync(join(gameDir(), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(true);
    expect((await gameImportStatus(root, 'case-game', sourcePath)).imported).toBe(false);

    await importLowpolyAsset(root, 'case-game', sourcePath);
    expect((await gameImportStatus(root, 'case-game', sourcePath)).imported).toBe(true);
  });

  test('partial asset commit is retryable, fail-closed, and recovers', async () => {
    await expect(
      importLowpolyAsset(root, 'case-game', sourcePath, {
        afterGlbCommit: () => {
          throw new Error('simulated meta commit failure');
        },
      }),
    ).rejects.toMatchObject({ code: 'import_asset_write_failed', retryable: true });
    expect(existsSync(join(gameDir(), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(true);
    expect((await gameImportStatus(root, 'case-game', sourcePath)).imported).toBe(false);

    await importLowpolyAsset(root, 'case-game', sourcePath);
    expect((await gameImportStatus(root, 'case-game', sourcePath)).imported).toBe(true);
  });

  test('rejects outside paths and symlink sources/targets', async () => {
    const outside = join(root, 'outside.glb');
    writeFileSync(outside, await buildGlb('Outside'));
    await expect(importLowpolyAsset(root, 'case-game', outside)).rejects.toMatchObject({ code: 'invalid_asset_path' });
    await expect(
      importLowpolyAsset(root, 'case-game', '../../../outside.glb'),
    ).rejects.toMatchObject({ code: 'invalid_asset_path' });

    const invalidName = join(sourceDir, 'bad name.glb');
    writeFileSync(invalidName, await buildGlb('InvalidName'));
    await expect(importLowpolyAsset(root, 'case-game', invalidName)).rejects.toMatchObject({
      code: 'invalid_asset_path',
    });

    const sourceLink = join(sourceDir, 'linked.glb');
    symlinkSync(sourcePath, sourceLink);
    await expect(importLowpolyAsset(root, 'case-game', sourceLink)).rejects.toMatchObject({ code: 'invalid_asset_path' });

    const targetDir = join(gameDir(), 'assets', '3d', 'props');
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, 'treasure_chest.glb');
    symlinkSync(outside, target);
    await expect(importLowpolyAsset(root, 'case-game', sourcePath)).rejects.toMatchObject({ code: 'invalid_asset_path' });
  });

  test('rejects a corrupt GLB without writing game files', async () => {
    writeFileSync(sourcePath, 'not a glb');

    await expect(importLowpolyAsset(root, 'case-game', sourcePath)).rejects.toMatchObject({
      code: 'corrupt_glb',
      retryable: false,
    });
    expect(existsSync(join(gameDir(), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(false);
  });

  test('tool handlers use the session-bound game and never a model-supplied slug', async () => {
    mkdirSync(gameDir('other-game'), { recursive: true });
    const context = {
      caller: { kind: 'ai' as const, sessionId: 'session-1', agentId: 'lowpoly' },
      toolId: 'lowpoly:import-to-game',
      projectRoot: root,
      game: 'case-game',
    };
    const result = (await tools['lowpoly:import-to-game'](
      { assetPath: sourcePath, slug: 'other-game' },
      context,
    )) as { ok: boolean; game?: string };
    expect(result).toMatchObject({ ok: true, game: 'case-game' });
    expect(existsSync(join(gameDir(), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(true);
    expect(existsSync(join(gameDir('other-game'), 'assets', '3d', 'props', 'treasure_chest.glb'))).toBe(false);
  });

  test('tool handler returns a structured failure when no session game is bound', async () => {
    const result = (await tools['lowpoly:game-import-status'](
      { assetPath: sourcePath },
      {
        caller: { kind: 'ai', sessionId: 'session-1' },
        toolId: 'lowpoly:game-import-status',
        projectRoot: root,
      },
    )) as { ok: boolean; code?: string; message?: string; retryable?: boolean };
    expect(result).toEqual({
      ok: false,
      code: 'missing_session_game',
      message: 'This session is not bound to a game.',
      retryable: false,
    });
  });
});
