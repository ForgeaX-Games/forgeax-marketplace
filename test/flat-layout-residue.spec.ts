/**
 * Static guard: Marketplace stays on flat `extensions/<slug>/` after the
 * kind-layout rollback. Active guidance / permissions / vite comments must not
 * revive kind-bucket path shapes (`extensions/workbench/…`, `extensions/agent/…`,
 * dead `@forgeax/types/plugin-layout` references).
 *
 * Run: bun test packages/marketplace/test/flat-layout-residue.spec.ts
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MARKETPLACE_ROOT = join(import.meta.dirname, '..');

/** Kind-bucket or other post-rollback dead path shapes. */
const FORBIDDEN = [
  /packages\/marketplace\/extensions\/(?:agent|skill|workbench|tool|cli|model)\//,
  /extensions\/(?:agent|skill|workbench|tool|cli|model)\/[A-Za-z0-9_.-]+\//,
  /extensions\/<kind>\//,
  /@forgeax\/types\/plugin-layout/,
  /fs:(?:read|write):packages\/marketplace\/extensions\/agent\/\*/,
] as const;

const ACTIVE_BASENAMES = new Set([
  'README.md',
  'AGENTS.md',
  'SKILL.md',
  'forgeax-extension.json',
  'vite.config.ts',
]);

/** Skip historical / vendored trees — only active operational guidance. */
function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === 'docs' ||
    name === 'adr' ||
    name === 'superpowers' ||
    name === '.git'
  );
}

function shouldSkipFile(rel: string, base: string): boolean {
  if (base.startsWith('CHANGELOG') || base.startsWith('HANDOFF') || base.startsWith('PLAN')) {
    return true;
  }
  // Allow marketplace root README historical sections only via basename allowlist —
  // still scanned; content must not teach kind buckets as current layout.
  if (!ACTIVE_BASENAMES.has(base) && !rel.startsWith('src/')) {
    return true;
  }
  return false;
}

function collectActiveFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (shouldSkipDir(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectActiveFiles(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    const rel = relative(MARKETPLACE_ROOT, full).replaceAll('\\', '/');
    if (shouldSkipFile(rel, name)) continue;
    out.push(full);
  }
  return out;
}

describe('flat Marketplace layout residue guard', () => {
  it('active README/AGENTS/SKILL/manifests/vite + src guidance have no kind-bucket paths', () => {
    const files = collectActiveFiles(MARKETPLACE_ROOT);
    expect(files.length).toBeGreaterThan(20);

    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(MARKETPLACE_ROOT, file).replaceAll('\\', '/');
      const text = readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) {
        if (re.test(text)) {
          hits.push(`${rel} matches ${re}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  it('wb-agent-persona permissions use flat agent-* globs only', () => {
    const manifest = join(
      MARKETPLACE_ROOT,
      'extensions/wb-agent-persona/forgeax-extension.json',
    );
    const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
      permissions?: string[];
    };
    const perms = json.permissions ?? [];
    expect(perms.some((p) => p.includes('extensions/agent/*/'))).toBe(false);
    expect(perms.some((p) => p.includes('extensions/agent-*/'))).toBe(true);
  });
});
