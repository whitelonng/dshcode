/** Transitive npm dependency installation for bundle-style plugins. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchPackument, installNpmPackage, resolveNpmVersion } from './registry.ts'

/** The slice of an installed package manifest the dependency tree reads. */
interface DependencyManifest {
  name?: unknown
  dependencies?: Record<string, string>
}

/**
 * Read the installed version of one package in the flat fallback.
 * @param packageDir - the candidate package directory under the fallback.
 * @returns the installed version, or undefined when nothing is installed there.
 */
async function installedVersion(packageDir: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : undefined
  } catch {
    // A missing or unparsable manifest means nothing is installed there.
    return undefined
  }
}

/**
 * Install the transitive npm `dependencies` of one installed package into the
 * flat module fallback, so bundle-style plugins (packages declaring
 * `dsh.bundle.patch`) can mount the plugin family they aggregate. Every
 * declared dependency resolves against the registry, is extracted into the
 * fallback, and is walked recursively. An existing fallback copy is replaced
 * only when its version differs from the resolved target — that rule is what
 * upgrades a shipped dependency (a symlink into the application closure) to
 * the aggregated version, while leaving matching copies untouched. Packages
 * already installed at the target version are skipped; the walk terminates on
 * a visited set, so dependency cycles and diamond shapes install once.
 * @param manifest - the installed package's manifest (its `dependencies`).
 * @param fallbackDir - the flat module fallback directory.
 * @param registry - npm registry base.
 * @param signal - optional cancellation for registry and tarball requests.
 * @param onProgress - per-tarball download completion callback (0–100 percent).
 * @throws when a declared dependency is unresolvable or its tarball fails.
 */
export async function installPackageDependencies(
  manifest: DependencyManifest,
  fallbackDir: string,
  registry: string,
  signal?: AbortSignal,
  onProgress?: (name: string, percent: number) => void,
): Promise<void> {
  const visited = new Set<string>()
  const queue: Array<{ name: string; range: string | undefined }> = []
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) queue.push({ name, range })
  while (queue.length > 0) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the length check above guarantees a head
    const { name, range } = queue.shift()!
    if (visited.has(name)) continue
    visited.add(name)
    const existing = await installedVersion(join(fallbackDir, name))
    const packument = await fetchPackument(name, registry, signal)
    const version = resolveNpmVersion(range, packument)
    if (existing === version) continue
    const targetDir = join(fallbackDir, name)
    await installNpmPackage(name, version, packument, targetDir, signal, (percent) => {
      onProgress?.(name, percent)
    })
    const child = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as DependencyManifest
    for (const [childName, childRange] of Object.entries(child.dependencies ?? {})) {
      if (childName !== name && !visited.has(childName)) queue.push({ name: childName, range: childRange })
    }
  }
}
