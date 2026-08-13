#!/usr/bin/env node
/**
 * Cold-start helper: Studio / a fresh clone has no packages/<pkg>/dist.
 * @forgeax/i18n exports only ./dist (no source condition), so serve-dist
 * and dev must build workspace packages from the monorepo root — never from
 * the app directory, where pnpm --filter ./packages/** matches nothing.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const FILTER_ARGS = ['--filter', './packages/**', 'run', '--if-present', 'build']

export function findMonorepoRoot(startDir) {
  let dir = resolve(startDir)
  for (let i = 0; i < 16; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`pnpm-workspace.yaml not found walking up from ${startDir}`)
}

export function ensureWorkspacePackages(startDir, options = {}) {
  const spawn = options.spawnSync ?? spawnSync
  const monorepoRoot = findMonorepoRoot(startDir)
  console.log(`[ensure-workspace-packages] pnpm ${FILTER_ARGS.join(' ')} (cwd=${monorepoRoot})`)
  const result = spawn('pnpm', FILTER_ARGS, {
    cwd: monorepoRoot,
    stdio: options.stdio ?? 'inherit',
    shell: process.platform === 'win32',
  })
  if (result?.error) {
    if (options.exit === false) throw result.error
    console.error(`[ensure-workspace-packages] spawn failed: ${result.error.message}`)
    process.exit(1)
  }
  const status = result?.status ?? 1
  if (status !== 0) {
    const error = new Error(`workspace package build failed (${status})`)
    if (options.exit === false) throw error
    process.exit(status)
  }
  return monorepoRoot
}

export { FILTER_ARGS }
