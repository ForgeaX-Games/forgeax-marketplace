#!/usr/bin/env node
/**
 * Module boundary lint for wb-game-video (protocol §12.1):
 *   runtime ↛ graph, ↛ editor
 *   graph   ↛ editor
 *
 * Tests under src/<module>/__tests__ and *.test.ts may import editor demo fixtures.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

const importRe = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

function isTest(file) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  return rel.includes('/__tests__/') || /\.test\.(ts|tsx)$/.test(rel)
}

/** True if relative import clearly targets a top-level src module. */
function targetsModule(spec, moduleName) {
  if (!spec.startsWith('.')) return false
  // normalize: strip query (?url) and extension for matching
  const s = spec.split('?')[0]
  const parts = s.split('/')
  // look for .../moduleName/... or ends with /moduleName
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === moduleName) {
      // preceding segment must be '..' or start of path after dots
      const prev = parts[i - 1]
      if (prev === '..' || prev === '.') return true
      if (i === 0) return true
    }
  }
  return false
}

const violations = []

function check(fromDir, forbidden) {
  const base = join(SRC, fromDir)
  let files
  try {
    files = walk(base)
  } catch {
    return
  }
  for (const file of files) {
    if (isTest(file)) continue
    const text = readFileSync(file, 'utf8')
    let m
    importRe.lastIndex = 0
    while ((m = importRe.exec(text))) {
      const spec = m[1] || m[2]
      if (!spec) continue
      for (const mod of forbidden) {
        if (targetsModule(spec, mod)) {
          violations.push({
            file: relative(ROOT, file).replace(/\\/g, '/'),
            from: fromDir,
            import: spec,
            forbidden: mod,
          })
        }
      }
    }
  }
}

// component-host lives under runtime/ (runtime-level infra) → covered by the runtime rule.
check('runtime', ['graph', 'editor'])
check('graph', ['editor'])

if (violations.length) {
  console.error('Module boundary violations (protocol §12.1):')
  for (const v of violations) {
    console.error(`  [${v.from} ↛ ${v.forbidden}] ${v.file}\n    import '${v.import}'`)
  }
  process.exit(1)
}
console.log('Module boundaries OK (runtime↛graph/editor, graph↛editor; tests exempt).')
