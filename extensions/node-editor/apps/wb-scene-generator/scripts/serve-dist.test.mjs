#!/usr/bin/env node
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  FILTER_ARGS,
  ensureWorkspacePackages,
  findMonorepoRoot,
} from '../../../scripts/ensure-workspace-packages.mjs'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const rendererSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'headless-renderer.mjs'),
  'utf8',
)

describe('serve-dist cold start contract', () => {
  it('builds workspace packages from the monorepo root, not the app cwd', () => {
    const calls = []
    const root = ensureWorkspacePackages(appRoot, {
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd })
        return { status: 0 }
      },
      exit: false,
      stdio: 'pipe',
    })
    assert.equal(root, findMonorepoRoot(appRoot))
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args, FILTER_ARGS)
    assert.equal(calls[0].cwd, root)
    assert.notEqual(calls[0].cwd, appRoot)
  })
})

describe('headless renderer Studio routing contract', () => {
  it('uses the Studio plugin proxy when an interface origin is available', () => {
    assert.match(rendererSource, /FORGEAX_INTERFACE_PORT/)
    assert.match(rendererSource, /__fx-plugin\/wb-scene-generator\/\?pane=renderer/)
  })
})
