/** System-pnpm delegation: detect, run, and reconcile profile installs. */

import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isGitSpec, parseNpmSpec } from './registry.ts'

const execFileAsync = promisify(execFile)

/** Bounded tail of pnpm output folded into failure diagnostics. */
const OUTPUT_TAIL_BYTES = 8 * 1024

/** pnpm progress output can be large; capture it whole, then keep the tail. */
const OUTPUT_BUFFER_BYTES = 16 * 1024 * 1024

/** Hard deadline for one pnpm invocation. */
const PNPM_TIMEOUT_MS = 10 * 60_000

/** pnpm's placeholder for an unapproved build script in `allowBuilds`. */
const BUILD_APPROVAL_PLACEHOLDER = 'set this to true or false'

/** The profile manifest slice the installer reads and writes. */
export interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** Detected pnpm availability, memoized for the process lifetime. */
let availability: Promise<boolean> | undefined

/**
 * Absolute pnpm locations probed when `pnpm` is not on PATH. GUI apps on
 * macOS do not inherit the shell PATH, so a terminal-visible pnpm (Homebrew,
 * npm-global, or a version-manager install) needs its absolute path to be
 * found; these are the common install locations across platforms.
 */
const PNPM_STATIC_PATHS = [
  '/opt/homebrew/bin/pnpm', // macOS Apple Silicon Homebrew
  '/usr/local/bin/pnpm', // macOS Intel Homebrew
  join(homedir(), 'Library', 'pnpm', 'pnpm'), // npm install -g pnpm (macOS)
  join(homedir(), '.local', 'share', 'pnpm', 'pnpm'), // standalone installer (Linux/macOS)
  join(homedir(), '.volta', 'bin', 'pnpm'), // Volta
  join(homedir(), '.local', 'bin', 'pnpm'), // user-local bin
  join(homedir(), 'bin', 'pnpm'), // ~/bin
]

/** pnpm paths under one version-manager node-versions directory (newest first). */
function managedVersionBins(root: string): string[] {
  try {
    return readdirSync(root)
      .sort()
      .reverse()
      .map(version => join(root, version, 'bin', 'pnpm'))
  } catch {
    return []
  }
}

/** pnpm paths under the fnm node-versions directory (newest first). */
function fnmVersionBins(): string[] {
  const root = join(homedir(), 'Library', 'Application Support', 'fnm', 'node-versions')
  try {
    return readdirSync(root)
      .sort()
      .reverse()
      .map(version => join(root, version, 'installation', 'bin', 'pnpm'))
  } catch {
    return []
  }
}

/**
 * The complete pnpm probe order: `pnpm` on PATH first, then static absolute
 * paths, then every node version under the nvm and fnm version directories.
 * @returns the candidate list probed by `pnpmBinary`.
 */
export function pnpmCandidatePaths(): string[] {
  return [
    'pnpm',
    ...PNPM_STATIC_PATHS,
    ...managedVersionBins(join(homedir(), '.nvm', 'versions', 'node')),
    ...fnmVersionBins(),
  ]
}

/**
 * A spawn environment whose PATH carries the candidate pnpm directories.
 * pnpm's shebang resolves `node` through PATH, so a GUI process (whose PATH
 * hides both) can locate the pnpm binary yet still fail to execute it — the
 * augmented PATH lets the discovered binary and its shebang resolve.
 */
function augmentedEnv(): NodeJS.ProcessEnv {
  const dirs = pnpmCandidatePaths().map(path => dirname(path)).filter(dir => dir !== '.')
  const PATH = `${[...new Set(dirs)].join(':')}:${process.env.PATH ?? ''}`
  return { ...process.env, PATH }
}

/** The resolved pnpm binary path, memoized for the process lifetime. */
let binary: Promise<string | undefined> | undefined

/**
 * Resolve the pnpm binary path: `pnpm` on PATH first, then the absolute
 * fallbacks, each probed under the augmented PATH. The result is memoized
 * for the process lifetime.
 * @returns the working binary path, or `undefined` when none runs.
 */
export function pnpmBinary(): Promise<string | undefined> {
  binary ??= (async () => {
    const env = augmentedEnv()
    for (const candidate of pnpmCandidatePaths()) {
      try {
        await execFileAsync(candidate, ['--version'], { timeout: 10_000, env })
        return candidate
      } catch {
        // Probe the next candidate.
      }
    }
    return undefined
  })()
  return binary
}

/**
 * Whether a system `pnpm` binary can run. The first probe tries `pnpm` on
 * PATH and then the absolute fallbacks; the result (including a failure) is
 * cached, so the gateway flips to its self-rolled paths permanently when
 * pnpm is absent.
 * @returns whether delegation is available.
 */
export function pnpmAvailable(): Promise<boolean> {
  availability ??= pnpmBinary().then(resolved => resolved !== undefined)
  return availability
}

/** The tail of combined pnpm output for diagnostics. */
function tailOf(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`.trim()
  return combined.length > OUTPUT_TAIL_BYTES ? `${combined.slice(-OUTPUT_TAIL_BYTES)}…` : combined
}

/**
 * Run one pnpm command in the profile directory. When a binary was resolved
 * through `pnpmBinary` (the gateway always probes before delegating), that
 * path is used — a GUI process whose PATH hides pnpm still runs the
 * discovered absolute binary; otherwise the plain `pnpm` name runs as before.
 * @param args - pnpm arguments (`add`, `remove`, …).
 * @param profileDir - the profile directory (pnpm workspace root).
 * @returns the exit code and a bounded output tail.
 * @throws when pnpm cannot be spawned at all (binary vanished mid-flight).
 */
export async function runPnpm(args: string[], profileDir: string): Promise<{ exitCode: number; tail: string }> {
  try {
    const executable = (await binary) ?? 'pnpm'
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd: profileDir,
      timeout: PNPM_TIMEOUT_MS,
      maxBuffer: OUTPUT_BUFFER_BYTES,
      env: augmentedEnv(),
    })
    return { exitCode: 0, tail: tailOf(stdout, stderr) }
  } catch (error: unknown) {
    // execFile rejects on a non-zero exit; pnpm's refused-build exit is a
    // normal outcome the approval flow handles, so fold it back into a result.
    const failure = error as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof failure.code === 'number') {
      return { exitCode: failure.code, tail: tailOf(failure.stdout ?? '', failure.stderr ?? '') }
    }
    throw error
  }
}

/**
 * Approve the build scripts pnpm just refused: pnpm ≥10 exits non-zero with
 * `ERR_PNPM_IGNORED_BUILDS` and leaves `allowBuilds: { <pkg>: <placeholder> }`
 * entries in the profile's `pnpm-workspace.yaml`. Filling them in is the
 * pnpm-blessed approval flow; the user explicitly ran an install, so the
 * requested package tree's builds get the pre-v10 default behavior.
 * Existing (user-set) entries stay untouched.
 * @param profileDir - the profile directory owning the workspace file.
 * @returns whether any placeholder was approved.
 */
export function approvePendingBuilds(profileDir: string): boolean {
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  let text: string
  try {
    text = readFileSync(workspacePath, 'utf8')
  } catch {
    return false
  }
  let parsed: { allowBuilds?: unknown } | null
  try {
    parsed = parse(text) as { allowBuilds?: unknown } | null
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
  writeFileSync(workspacePath, stringify(parsed), 'utf8')
  return true
}

/**
 * Read the profile manifest.
 * @param profileDir - the profile directory.
 * @returns the parsed manifest (an empty shape when absent or unreadable).
 */
export function readProfileManifest(profileDir: string): ProfileManifest {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as ProfileManifest
  } catch {
    return {}
  }
}

/**
 * Write the profile manifest back (2-space JSON, trailing newline).
 * @param profileDir - the profile directory.
 * @param manifest - the manifest value to persist.
 */
export async function writeProfileManifest(profileDir: string, manifest: ProfileManifest): Promise<void> {
  await mkdir(profileDir, { recursive: true })
  await writeFileAtomic(join(profileDir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n', { mode: 0o600 })
}

/**
 * The profile's bundle layer list (empty when absent).
 * @param profileDir - the profile directory.
 * @returns the recorded bundle layer package names.
 */
export function readProfileBundles(profileDir: string): string[] {
  return [...(readProfileManifest(profileDir).dsh?.profile?.bundles ?? [])]
}

/**
 * Join one package name to the profile bundle layer list (idempotent).
 * @param profileDir - the profile directory.
 * @param packageName - the package name to append.
 * @returns resolution after the atomic write settles.
 */
export async function addProfileBundle(profileDir: string, packageName: string): Promise<void> {
  const manifest = readProfileManifest(profileDir)
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  if (bundles.includes(packageName)) return
  await writeProfileManifest(profileDir, {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, packageName] } },
  })
}

/**
 * Drop one package name from the profile bundle layer list (no-op when absent).
 * @param profileDir - the profile directory.
 * @param packageName - the package name to remove.
 * @returns resolution after the atomic write settles.
 */
export async function removeProfileBundle(profileDir: string, packageName: string): Promise<void> {
  const manifest = readProfileManifest(profileDir)
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  if (!bundles.includes(packageName)) return
  await writeProfileManifest(profileDir, {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: bundles.filter(name => name !== packageName) } },
  })
}

/**
 * Install one spec through pnpm in the profile workspace, approving refused
 * build scripts and retrying once. pnpm resolves the registry, transitive
 * dependencies, git sources (including monorepo `#…&path:` selectors), and
 * the lockfile — the self-rolled paths remain the fallback when pnpm is
 * unavailable. Re-adding an already-present dependency reports the existing
 * dependency's name (pnpm succeeds without adding a new key).
 * @param profileDir - the profile directory (pnpm workspace root).
 * @param spec - npm name/spec or git repository spec.
 * @returns the dependency names newly added to the profile manifest (or the
 * matched existing name for a re-install).
 * @throws with the bounded pnpm output tail when the install fails, or when
 * pnpm reports success yet no dependency corresponds to the spec.
 */
export async function installViaPnpm(profileDir: string, spec: string): Promise<{ names: string[]; tail: string }> {
  const before = new Set(Object.keys(readProfileManifest(profileDir).dependencies ?? {}))
  let run = await runPnpm(['add', spec], profileDir)
  if (run.exitCode !== 0 && approvePendingBuilds(profileDir)) {
    run = await runPnpm(['add', spec], profileDir)
  }
  if (run.exitCode !== 0) {
    const detail = run.tail.includes('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND')
      ? `${run.tail}\nplugin-installer: the package still declares "workspace:"-protocol dependencies; `
        + 'a standalone install needs concrete published versions, and its harness peer dependencies marked optional '
        + 'so pnpm does not auto-install stale published copies over the healed module fallback'
      : run.tail
    throw new Error(`plugin-installer: pnpm add failed for ${JSON.stringify(spec)}: ${detail}`)
  }
  const dependencies = readProfileManifest(profileDir).dependencies ?? {}
  const names = Object.keys(dependencies).filter(name => !before.has(name))
  if (names.length > 0) return { names, tail: run.tail }
  // pnpm succeeded without adding a key: the dependency already existed (an
  // "Already up to date" re-install). Match it by its recorded spec — pnpm
  // stores the git spec verbatim — or, for npm specs, by the parsed name.
  const matched = Object.entries(dependencies).find(([, value]) => value === spec)
  const name = matched?.[0] ?? (isGitSpec(spec) ? undefined : parseNpmSpec(spec).name)
  if (name === undefined || dependencies[name] === undefined) {
    throw new Error(`plugin-installer: pnpm reported success but no package was added for ${JSON.stringify(spec)}`)
  }
  return { names: [name], tail: run.tail }
}

/**
 * Remove one package through pnpm (no-op when it is not a profile dependency).
 * @param profileDir - the profile directory.
 * @param packageName - the package name to remove.
 * @returns the exit code and a bounded output tail.
 * @throws with the bounded tail when the removal fails.
 */
export async function removeViaPnpm(profileDir: string, packageName: string): Promise<void> {
  const dependencies = readProfileManifest(profileDir).dependencies ?? {}
  if (dependencies[packageName] === undefined) return
  const run = await runPnpm(['remove', packageName], profileDir)
  if (run.exitCode !== 0) {
    throw new Error(`plugin-installer: pnpm remove failed for ${JSON.stringify(packageName)}: ${run.tail}`)
  }
}

/**
 * The installed package dir under the profile's hoisted node_modules.
 * @param profileDir - the profile directory.
 * @param packageName - the installed package name.
 * @returns the absolute package directory.
 */
export function profileModuleDir(profileDir: string, packageName: string): string {
  return join(profileDir, 'node_modules', packageName)
}

/**
 * Read the installed package identity from the profile workspace.
 * @param profileDir - the profile directory.
 * @param packageName - the installed package name.
 * @returns the package name, version, and raw manifest.
 * @throws a labelled diagnostic when the installed directory is a pnpm
 * placeholder (a git repository whose root has no `package.json`) or its
 * manifest carries no name.
 */
export async function readProfileIdentity(profileDir: string, packageName: string): Promise<{
  name: string
  version: string
  manifest: Record<string, unknown>
}> {
  const manifest = JSON.parse(await readFile(join(profileModuleDir(profileDir, packageName), 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
    _pnpmPlaceholder?: unknown
  }
  if (typeof manifest._pnpmPlaceholder === 'string') {
    throw new Error(
      `plugin-installer: ${packageName} resolved to a git repository whose root has no package.json `
      + '(pnpm installed a placeholder manifest); the plugin lives in a subdirectory — reinstall with a '
      + '"#&path:" selector naming it, e.g. github:owner/repo#&path:packages/<group>/<name>',
    )
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`plugin-installer: pnpm-installed package ${packageName} has no valid package.json name`)
  }
  return {
    name: manifest.name,
    version: typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0-pnpm',
    manifest: manifest as unknown as Record<string, unknown>,
  }
}

/**
 * The profile directory a patch path lives in (the pnpm workspace root).
 * @param patchPath - absolute path of the profile patch file.
 * @returns the profile directory.
 */
export function profileDirOf(patchPath: string): string {
  return dirname(patchPath)
}
