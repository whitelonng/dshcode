/**
 * Maintain the deployment-owned skins tree the bundled skin center reads:
 * `<workspace>/node_modules/skins/<id>` links to the installed
 * `@linxin666/dsh-client-ui-skin-<id>` package directories. The patched
 * `@linxin666/dsh-client-ui-skin-center` walks ancestors of its own location
 * for a `skins/` directory, so this canonical workspace-level tree serves
 * source launches (`pnpm dsh web`) without touching pnpm's virtual store.
 * The desktop packaging assembles the same tree into the app bundle at
 * stage time (apps/desktop/scripts/prepare-package.mjs), so this script is
 * never used by the packaged product.
 *
 * Idempotent: correct links are kept, wrong or dangling links are replaced,
 * and a real directory in the way fails loudly. Missing packages (partial
 * installs) are skipped silently so a fresh checkout's install never fails.
 * @module scripts/link-community-skins
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** The web bundle owns the community plugin roster; its manifest names the skin packages. */
const BUNDLE_ANCHOR = resolve(import.meta.dirname, '..', 'packages/bundle/web-app/package.json')

/** Package-name prefix of every skin in the shipped community set. */
const SKIN_PACKAGE_PREFIX = '@linxin666/dsh-client-ui-skin-'

/** The skins aggregate whose dependency list carries the bundle-wired skins. */
const SKINS_AGGREGATE = '@linxin666/dsh-skins'

/** The web-ui aggregate whose dependency closure carries the skins aggregate. */
const WEB_UI_AGGREGATE = '@linxin666/dsh-web-ui-all'

/** Maximum parent hops while probing a package directory from an anchor. */
const PROBE_HOP_LIMIT = 16

/**
 * Find a package's directory from an anchor manifest the way Node resolves
 * imports: probe `node_modules` parents without requiring the package to
 * export `./package.json`.
 * @param anchor - absolute path of a manifest file inside the anchor package.
 * @param packageName - the package name to resolve.
 * @returns the real package directory, or `undefined` when not installed.
 */
function packageDirFromAnchor(anchor, packageName) {
  const require = createRequire(anchor)
  for (const searchPath of require.resolve.paths(packageName) ?? []) {
    let current = searchPath
    for (let hop = 0; hop < PROBE_HOP_LIMIT; hop += 1) {
      const candidate = join(current, packageName)
      if (existsSync(join(candidate, 'package.json'))) {
        return realpathSync(candidate)
      }
      current = dirname(current)
    }
  }
  return undefined
}

/** Read one manifest's dependencies object. */
function readDependencies(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = parsed.dependencies
  if (typeof dependencies !== 'object' || dependencies === null) return {}
  return dependencies
}

/**
 * Replace `link` with a symlink to `target`, or keep a correct link.
 * @param link - absolute link path.
 * @param target - absolute target path.
 */
function ensureLink(link, target) {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`link-community-skins: ${link} exists and is not a symlink; remove it so the skins tree can be maintained`)
    }
    if (readlinkSync(link) === target) return
    unlinkSync(link)
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'junction')
}

/** Resolve the shipped skin packages: aggregate chains plus the web bundle's own extras. */
function resolveSkinPackages() {
  const pending = new Map()
  for (const [name, range] of Object.entries(readDependencies(BUNDLE_ANCHOR))) {
    if (name.startsWith(SKIN_PACKAGE_PREFIX)) pending.set(name, BUNDLE_ANCHOR)
  }
  // The wired skins are nested dependencies: they resolve from the web-ui
  // aggregate's own node_modules, and the skins aggregate's manifest carries
  // their names. Each resolution anchors at the manifest that declares them.
  const webUiAggregateDir = packageDirFromAnchor(BUNDLE_ANCHOR, WEB_UI_AGGREGATE)
  if (webUiAggregateDir !== undefined) {
    const webUiManifest = join(webUiAggregateDir, 'package.json')
    const skinsAggregateDir = packageDirFromAnchor(webUiManifest, SKINS_AGGREGATE)
    if (skinsAggregateDir !== undefined) {
      const skinsManifest = join(skinsAggregateDir, 'package.json')
      for (const name of Object.keys(readDependencies(skinsManifest))) {
        if (name.startsWith(SKIN_PACKAGE_PREFIX)) pending.set(name, skinsManifest)
      }
    }
  }
  const skins = new Map()
  for (const [name, anchor] of pending) {
    const dir = packageDirFromAnchor(anchor, name)
    // The skin-center plugin itself shares the package-name prefix but is not
    // a skin; only packages carrying a skin.json belong in the skins tree.
    if (dir !== undefined && existsSync(join(dir, 'skin.json'))) {
      skins.set(name.slice(SKIN_PACKAGE_PREFIX.length), dir)
    }
  }
  return skins
}

/** Assemble `<workspace>/node_modules/skins/<id>` links and report changes. */
export function linkCommunitySkins(workspaceRoot = resolve(import.meta.dirname, '..')) {
  const skinsRoot = join(workspaceRoot, 'node_modules', 'skins')
  const skins = resolveSkinPackages()
  let created = 0
  for (const [id, target] of skins) {
    ensureLink(join(skinsRoot, id), target)
    created += 1
  }
  return { skinsRoot, count: created }
}

// Standalone execution: postinstall hook.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = linkCommunitySkins()
  if (result.count > 0) {
    console.log(`link-community-skins: ${result.count} skin link(s) ready at ${result.skinsRoot}`)
  }
}
