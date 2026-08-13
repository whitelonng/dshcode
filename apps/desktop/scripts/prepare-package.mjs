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

/** Create a production deployment outside the source workspace for electron-builder. */
export function preparePackage() {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const verified = spawnSync(pnpm, ['run', 'verify-desktop-runtime-closure'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  if (verified.error !== undefined) throw verified.error
  if (verified.status !== 0) process.exit(verified.status ?? 1)

  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })

  const deployed = spawnSync(pnpm, [
    '--filter', '@dshcode/desktop',
    'deploy', '--prod',
    '--config.inject-workspace-packages=true',
    '--config.ignore-scripts=true',
    stageRoot,
  ], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  // pnpm deploy records its production-only filter in the source workspace
  // state. Restore the already-installed full workspace so later commands do
  // not attempt an interactive dependency purge.
  const restored = spawnSync(pnpm, [
    'install', '--prod=false', '--frozen-lockfile', '--ignore-scripts',
  ], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  if (deployed.error !== undefined) throw deployed.error
  if (restored.error !== undefined) throw restored.error
  if (deployed.status !== 0) process.exit(deployed.status ?? 1)
  if (restored.status !== 0) process.exit(restored.status ?? 1)

  const buildRoot = resolve(stageRoot, 'build')
  const licenseRoot = resolve(stageRoot, 'licenses')
  mkdirSync(buildRoot, { recursive: true })
  mkdirSync(licenseRoot, { recursive: true })
  copyFileSync(resolve(appRoot, 'electron-builder.yml'), resolve(stageRoot, 'electron-builder.yml'))
  copyFileSync(resolve(workspaceRoot, 'apps/web/public/favicon.svg'), resolve(buildRoot, 'icon.svg'))
  copyFileSync(resolve(workspaceRoot, 'LICENSE'), resolve(licenseRoot, 'LICENSE'))
  copyFileSync(resolve(workspaceRoot, 'THIRD_PARTY_NOTICES.md'), resolve(licenseRoot, 'THIRD_PARTY_NOTICES.md'))
}

preparePackage()
