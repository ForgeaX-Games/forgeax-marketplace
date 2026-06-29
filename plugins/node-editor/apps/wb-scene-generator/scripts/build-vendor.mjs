// Compile the vendored shared/types TS source into ESM .js so that the
// battery .ts files (loaded raw by the kernel via Node type-stripping) can
// resolve their `shared/types/index.js` imports at runtime. Node's
// type-stripping does not map .js specifiers to .ts, so this lib must be
// emitted as real .js. Output lives under vendor/dist (gitignored).
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// app root = this script's dir (scripts/) up one level — cwd-independent so this
// works whether invoked from the app root or as the backend's prebuild step.
const appRoot = resolve(import.meta.dirname, '..')

rmSync(resolve(appRoot, 'vendor/dist/shared/types'), { recursive: true, force: true })

const tsc = 'pnpm exec tsc'
const cmd = [
  tsc,
  '--module nodenext --moduleResolution nodenext --target es2022',
  '--skipLibCheck --declaration false --noEmitOnError false',
  '--rootDir vendor/shared/types --outDir vendor/dist/shared/types',
  'vendor/shared/types/index.ts',
].join(' ')

execSync(cmd, { stdio: 'inherit', cwd: appRoot })
console.log('[build-vendor] OK — vendor/dist/shared/types compiled')

// Vendor the renderer's PURE sprite resolver so the scene-export backend can
// call the SAME pickFaceSprite the browser renderer uses (one implementation,
// no parallel re-derivation). We compile the barrel (renderer/server/
// spriteResolver.ts) + its pure transitive deps (pickFaceSprite, neighborKey)
// directly from the frontend SOURCE — there is NO copy of the resolver, the
// frontend file stays the single source of truth. The frontend uses `bundler`
// module resolution (extensionless relative imports), so we compile with that,
// then post-rewrite the emitted relative specifiers to add `.js` so plain Node
// (the backend / tsx) can import the output. Type-only imports (ruleCache/types)
// are erased, so the emitted .js pulls in no browser/DOM code.
const resolverOut = resolve(appRoot, 'vendor/dist/renderer-resolve')
rmSync(resolverOut, { recursive: true, force: true })
const resolverCmd = [
  tsc,
  '--module esnext --moduleResolution bundler --target es2022',
  '--skipLibCheck --declaration false --noEmitOnError false --verbatimModuleSyntax',
  '--rootDir frontend/src --outDir vendor/dist/renderer-resolve',
  'frontend/src/renderer/server/spriteResolver.ts',
].join(' ')
execSync(resolverCmd, { stdio: 'inherit', cwd: appRoot })

// Add `.js` to emitted relative import/export specifiers (bundler emit keeps
// them extensionless; Node ESM needs explicit extensions). Only rewrites
// specifiers starting with './' or '../' that lack an extension.
const addJsExtensions = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) { addJsExtensions(full); continue }
    if (!entry.name.endsWith('.js')) continue
    const src = readFileSync(full, 'utf8')
    const fixed = src.replace(
      /((?:from|import)\s*\(?\s*['"])(\.\.?\/[^'"]*?)(['"])/g,
      (m, pre, spec, post) => (/\.[a-zA-Z0-9]+$/.test(spec) ? m : `${pre}${spec}.js${post}`),
    )
    if (fixed !== src) writeFileSync(full, fixed)
  }
}
addJsExtensions(resolverOut)
// Mark the emitted tree as ESM so Node parses the .js as modules without the
// MODULE_TYPELESS_PACKAGE_JSON reparse warning.
writeFileSync(resolve(resolverOut, 'package.json'), JSON.stringify({ type: 'module' }) + '\n')
console.log('[build-vendor] OK — vendor/dist/renderer-resolve compiled')
