import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '../skills/forgeax-game-audio/scripts/audit-audio-bindings.ts',
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(instrumented = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeax-game-audio-audit-'));
  roots.push(root);
  const game = join(root, '.forgeax/games/demo');
  await mkdir(join(game, 'audio'), { recursive: true });
  await mkdir(join(game, 'src/forgeax-audio'), { recursive: true });
  await writeFile(join(game, 'audio/hit.wav'), 'RIFF');
  await writeFile(join(game, 'audio/project.json'), JSON.stringify({
    schemaVersion: 'forgeax-audio-project/1',
    projectId: 'demo',
    revision: 2,
    status: 'applied',
    updatedAt: '2026-08-03T00:00:00.000Z',
    bindings: [{
      eventId: 'combat.hit',
      label: '命中',
      enabled: true,
      kind: 'sfx',
      assets: [{ assetId: 'hit', file: 'hit.wav' }],
      variation: { mode: 'single' },
      trigger: { delayMs: 0, cooldownMs: 0, probability: 1 },
      playback: {
        volume: 1,
        bus: 'sfx',
        spatial: '3d',
        mode: 'one-shot',
        fadeInMs: 0,
        fadeOutMs: 0,
      },
      conditions: [],
    }],
  }));
  for (const file of ['runtime.ts', 'generated-bindings.ts', 'index.ts']) {
    await writeFile(join(game, 'src/forgeax-audio', file), `// ${file}`);
  }
  await writeFile(
    join(game, 'src/combat.ts'),
    instrumented ? "gameAudio.emit('combat.hit', { damage: 20 });" : 'resolveDamage();',
  );
  return root;
}

async function runAudit(root: string): Promise<{ exitCode: number; result: any }> {
  const proc = Bun.spawn([
    process.execPath,
    script,
    '--project-root',
    root,
    '--slug',
    'demo',
  ], { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  return { exitCode, result: JSON.parse(stdout) };
}

describe('ForgeaX game audio skill audit', () => {
  test('accepts an applied project with generated runtime and literal game event instrumentation', async () => {
    const audited = await runAudit(await fixture());
    expect(audited.exitCode).toBe(0);
    expect(audited.result).toMatchObject({
      ok: true,
      slug: 'demo',
      summary: { bindings: 1, errors: 0 },
    });
  });

  test('fails when an enabled binding has no real event call site', async () => {
    const audited = await runAudit(await fixture(false));
    expect(audited.exitCode).toBe(1);
    expect(audited.result.errors).toContain(
      "event 'combat.hit' has no literal gameAudio.emit('combat.hit') call",
    );
  });
});
