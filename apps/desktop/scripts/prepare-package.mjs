/** Stage a production-only workspace deployment for electron-builder. */

import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const appRoot = resolve(import.meta.dirname, '..')
export const workspaceRoot = resolve(appRoot, '../..')
const workspaceId = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12)
export const stageRoot = resolve(tmpdir(), `dshcode-desktop-${workspaceId}`)

function runPnpm(args) {
  const entrypoint = process.env.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('DSHCode packaging must run through a pnpm package script.')
  }
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
}

/** Create a production deployment outside the source workspace for electron-builder. */
export function preparePackage() {
  const verified = runPnpm(['run', 'verify-desktop-runtime-closure'])
  if (verified.error !== undefined) throw verified.error
  if (verified.status !== 0) process.exit(verified.status ?? 1)

  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })

  const deployed = runPnpm([
    '--filter', '@dshcode/desktop',
    'deploy', '--prod',
    '--config.inject-workspace-packages=true',
    '--config.ignore-scripts=true',
    stageRoot,
  ])
  // pnpm deploy records its production-only filter in the source workspace
  // state. Restore the already-installed full workspace so later commands do
  // not attempt an interactive dependency purge.
  const restored = runPnpm([
    'install', '--prod=false', '--frozen-lockfile', '--ignore-scripts',
  ])
  if (deployed.error !== undefined) throw deployed.error
  if (restored.error !== undefined) throw restored.error
  if (deployed.status !== 0) process.exit(deployed.status ?? 1)
  if (restored.status !== 0) process.exit(restored.status ?? 1)

  const buildRoot = resolve(stageRoot, 'build')
  const licenseRoot = resolve(stageRoot, 'licenses')
  mkdirSync(buildRoot, { recursive: true })
  mkdirSync(licenseRoot, { recursive: true })
  copyFileSync(resolve(appRoot, 'electron-builder.yml'), resolve(stageRoot, 'electron-builder.yml'))
  copyFileSync(resolve(appRoot, 'assets/icon.svg'), resolve(buildRoot, 'icon.svg'))
  copyFileSync(resolve(workspaceRoot, 'LICENSE'), resolve(licenseRoot, 'LICENSE'))
  copyFileSync(resolve(workspaceRoot, 'THIRD_PARTY_NOTICES.md'), resolve(licenseRoot, 'THIRD_PARTY_NOTICES.md'))
}

preparePackage()
