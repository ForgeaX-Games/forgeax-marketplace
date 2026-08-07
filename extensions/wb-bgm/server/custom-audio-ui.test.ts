import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

describe('explicit custom audio player UI', () => {
  test('has separate BGM/SFX import entry points and hidden multi-file/folder inputs', async () => {
    const html = await readFile(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('>导入 BGM<');
    expect(html).toContain('>导入音效<');
    expect(html).toMatch(/id="customAudioFileInput"[^>]*multiple/);
    expect(html).toMatch(/id="customAudioFolderInput"[^>]*(webkitdirectory|directory)/);
    expect(html).toContain('id="customAudioWorkspace"');
    expect(html).toContain('id="customAudioList"');
    expect(html).toContain('id="customAudioPlayer"');
    expect(html).toContain('>绑定游戏事件<');
    expect(html).not.toMatch(/id="[^"]*(authorization|autoClassify|智能分类)[^"]*"/i);
  });

  test('keeps custom assets separate from built-in search and passes an explicit kind', async () => {
    const source = await readFile(resolve(root, 'src', 'customAudio.ts'), 'utf8');
    expect(source).toContain("kind: pendingImportKind");
    expect(source).toContain("'import-custom-audio'");
    expect(source).toContain("'list-custom-audio'");
    expect(source).toContain("'delete-custom-audio'");
    expect(source).toContain("'change-custom-audio-kind'");
    expect(source).not.toContain('runHumanSearch');
    expect(source).not.toContain('fetchAllAssetsOfType');
  });
});
