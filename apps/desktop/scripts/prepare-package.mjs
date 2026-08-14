/** Stage a production-only workspace deployment for electron-builder. */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

/**
 * Assemble the deployment-owned skins tree the skin center reads:
 * `<stage>/skins-extras/<id>` links to the staged skin packages. The
 * patched `@linxin666/dsh-client-ui-skin-center` resolves `skins/` beside
 * an ancestor `node_modules`, and electron-builder ships this tree at
 * `app/node_modules/skins` through `extraResources` (the node-module
 * collector would drop an orphan directory inside `node_modules`).
 * pnpm's staged layout keeps the skin packages inside the virtual store,
 * so the scan walks `node_modules/.pnpm` store entries and keeps only the
 * packages carrying a `skin.json` (the skin-center plugin itself shares
 * the package-name prefix but is not a skin).
 * @returns the number of staged skins.
 */
function assembleSkinsExtras() {
  const prefix = '@linxin666+dsh-client-ui-skin-'
  const pnpmDir = join(stageRoot, 'node_modules', '.pnpm')
  const extrasRoot = join(stageRoot, 'skins-extras')
  mkdirSync(extrasRoot, { recursive: true })
  let staged = 0
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(prefix)) continue
    const rest = entry.slice(prefix.length)
    const at = rest.indexOf('@')
    const id = at === -1 ? rest : rest.slice(0, at)
    const target = join(pnpmDir, entry, 'node_modules', '@linxin666', `dsh-client-ui-skin-${id}`)
    if (!existsSync(join(target, 'skin.json'))) continue
    const link = join(extrasRoot, id)
    try {
      const stat = lstatSync(link)
      if (!stat.isSymbolicLink()) {
        throw new Error(`DSHCode packaging: ${link} exists and is not a symlink; remove it so the skins tree can be staged`)
      }
      if (readlinkSync(link) === target) continue
      unlinkSync(link)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    staged += 1
  }
  return staged
}

/**
 * Stage the dsh-web-ui compat shim from the harness-home profile fallback.
 * The shim restores the legacy data-pane / data-dsh-frame DOM hooks the
 * @linxin666 plugin family mounts through; it is not published to npm, so no
 * dependency declaration can resolve it. Bare plugin rows import from the
 * packaged app's own node_modules, so the shim must ship beside the family
 * packages: copy the profile-installed package into compat-extras, shipped by
 * extraResources to `app/node_modules/@linxin666/dsh-web-ui-compat`.
 * @returns the staged compat package directory, or undefined when not installed.
 */
function assembleCompatExtras() {
  const source = join(homedir(), '.dsh/profiles/node_modules/@linxin666/dsh-web-ui-compat')
  if (!existsSync(join(source, 'package.json'))) return undefined
  const target = join(stageRoot, 'compat-extras', 'dsh-web-ui-compat')
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
  return target
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
  const skinCount = assembleSkinsExtras()
  console.log(`DSHCode packaging: ${skinCount} skin(s) staged at skins-extras`)
  const compatDir = assembleCompatExtras()
  console.log(`DSHCode packaging: compat shim staged at ${compatDir ?? '(not installed)'}`)
  copyFileSync(resolve(appRoot, 'electron-builder.yml'), resolve(stageRoot, 'electron-builder.yml'))
  copyFileSync(resolve(appRoot, 'assets/icon.svg'), resolve(buildRoot, 'icon.svg'))
  copyFileSync(resolve(workspaceRoot, 'LICENSE'), resolve(licenseRoot, 'LICENSE'))
  copyFileSync(resolve(workspaceRoot, 'THIRD_PARTY_NOTICES.md'), resolve(licenseRoot, 'THIRD_PARTY_NOTICES.md'))
}

preparePackage()
