import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import manifest from '../forgeax-extension.json';
import tools from './tool-handlers.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('custom audio tools', () => {
  test('imports once, lists immediately for Agent, attaches by ID, and deletes for the user', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'forgeax-custom-audio-tools-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.forgeax', 'games', 'demo'), { recursive: true });
    const env = { FORGEAX_PROJECT_ROOT: projectRoot };

    const imported = await tools['import-custom-audio']({
      kind: 'sfx',
      fileName: '玩家确认.mp3',
      mimeType: 'audio/mpeg',
      base64: Buffer.from('ID3-player-custom').toString('base64'),
    }, { caller: { kind: 'user' }, toolId: 'import-custom-audio', env });
    expect(imported.duplicate).toBe(false);
    expect(imported.asset.assetId).toMatch(/^custom:sfx:sha256:/);
    expect(imported).not.toHaveProperty('absolutePath');

    const listed = await tools['list-custom-audio'](
      { kind: 'sfx' },
      { caller: { kind: 'ai' }, toolId: 'list-custom-audio', env },
    );
    expect(listed.assets).toHaveLength(1);
    expect(listed.assets[0]?.assetId).toBe(imported.asset.assetId);

    const attached = await tools['attach-audio']({
      assetId: imported.asset.assetId,
      kind: 'sfx',
      slug: 'demo',
    }, { caller: { kind: 'user' }, toolId: 'attach-audio', env });
    expect(await readFile(join(projectRoot, '.forgeax', 'games', 'demo', attached.file)))
      .toEqual(Buffer.from('ID3-player-custom'));

    expect(await tools['delete-custom-audio'](
      { assetId: imported.asset.assetId },
      { caller: { kind: 'user' }, toolId: 'delete-custom-audio', env },
    )).toEqual({ deleted: true, assetId: imported.asset.assetId });
    expect((await tools['list-custom-audio'](
      {}, { caller: { kind: 'ai' }, toolId: 'list-custom-audio', env },
    )).assets).toHaveLength(0);
  });

  test('publishes import/delete only to humans and list to both humans and Agent', () => {
    const byId = new Map(manifest.contributes.tools.map((tool) => [tool.id, tool]));
    expect(byId.get('import-custom-audio')).toMatchObject({ exposedToAI: false });
    expect(byId.get('delete-custom-audio')).toMatchObject({ exposedToAI: false });
    expect(byId.get('change-custom-audio-kind')).toMatchObject({ exposedToAI: false });
    expect(byId.get('list-custom-audio')).toMatchObject({ exposedToAI: true });
    expect(Object.keys(tools)).toEqual(expect.arrayContaining([
      'import-custom-audio', 'list-custom-audio', 'delete-custom-audio',
      'change-custom-audio-kind',
    ]));
  });
});
