#!/usr/bin/env node
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'serve-dist.mjs')
const source = readFileSync(scriptPath, 'utf8')

describe('serve-dist cold start contract', () => {
  it('builds frontend/dist before serving when the dist bundle is missing', () => {
    assert.match(source, /\[ -d frontend\/dist \] \|\| pnpm -C frontend build|pnpm.*-C.*frontend.*build/s)
    assert.doesNotMatch(source, /missing frontend\/dist\/index\.html; run `pnpm build` first/)
  })
})
