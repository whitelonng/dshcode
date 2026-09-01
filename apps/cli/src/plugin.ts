/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** pnpm's placeholder for an unapproved build script in `allowBuilds`. */
const BUILD_APPROVAL_PLACEHOLDER = 'set this to true or false'

/**
 * Approve the build scripts pnpm just refused: pnpm ≥10 exits non-zero with
 * `ERR_PNPM_IGNORED_BUILDS` and leaves `allowBuilds: { <pkg>: 'set this to
 * true or false' }` placeholders in the profile's `pnpm-workspace.yaml`.
 * Filling them in is the pnpm-blessed approval flow; the user explicitly ran
 * an install, so the requested package tree's builds get the pre-v10 default
 * behavior. Existing (user-set) approvals stay untouched.
 * @param dir - the profile directory owning the workspace file.
 * @returns whether any placeholder was approved.
 */
export function approvePendingBuilds(dir: string): boolean {
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  let text: string
  try {
    text = readFileSync(workspacePath, 'utf8')
  } catch {
    return false
  }
  let parsed: { allowBuilds?: unknown } | null
  try {
    parsed = yaml.load(text) as { allowBuilds?: unknown } | null
  } catch {
    // A malformed workspace file is pnpm's error to report, not ours to crash on.
    return false
  }
  const allowBuilds = parsed?.allowBuilds
  if (typeof allowBuilds !== 'object' || allowBuilds === null) return false
  let approved = false
  for (const [packageName, value] of Object.entries(allowBuilds)) {
    if (value === BUILD_APPROVAL_PLACEHOLDER) {
      ;(allowBuilds as Record<string, unknown>)[packageName] = true
      approved = true
    }
  }
  if (!approved) return false
  writeFileSync(workspacePath, yaml.dump(parsed), 'utf8')
  return true
}

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
    return 0
  }
  // pnpm ≥10 refuses build scripts with a non-zero exit and leaves approval
  // placeholders behind; approve them and retry the exact command once.
  if (approvePendingBuilds(dir)) {
    const retry = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if ((retry.status ?? 1) === 0) {
      reconcilePlugins(before, dir)
      return 0
    }
  }
  // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
  // one; the profile owns it. The retry already covered the build-approval
  // case, so a remaining failure is a real pnpm error.
  process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
  if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
    process.stderr.write(
      `${NAME}: git-hosted plugins build on install via their prepare script; a rejected build script may need `
      + `an explicit allowBuilds entry in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
    )
  }
  return exitCode
}
