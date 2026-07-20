import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pluginRoot = resolve(import.meta.dir);
const repoRoot = resolve(pluginRoot, '../../../../..');

function text(path: string): string {
  return readFileSync(resolve(pluginRoot, path), 'utf8');
}

describe('visual presentation architecture boundaries', () => {
  test('keeps gameplay vocabulary out of the evaluator and presenter', () => {
    const core = [text('behavior-evaluator.ts'), text('presenter.ts'), text('projector.ts')].join('\n');
    for (const forbidden of ['ju' + 'mp', 'cro' + 'uch', 'Key' + 'C', 'Sp' + 'ace']) {
      expect(core).not.toContain(forbidden);
    }
  });

  test('keeps Provider wire commands out of the shared game contract', () => {
    const contract = readFileSync(
      resolve(repoRoot, 'packages/contracts/types/src/visual-generation.ts'),
      'utf8',
    );
    for (const forbidden of ['set_' + 'camera_pose', 'set_' + 'prompt', 'ch' + 'unk_size', 'la' + 'tent']) {
      expect(contract).not.toContain(forbidden);
    }
  });
});
