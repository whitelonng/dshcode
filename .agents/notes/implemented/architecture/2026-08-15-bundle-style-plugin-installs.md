# Agent Note: Bundle-style plugin installs and git identity diagnostics

Status: implemented

English | [中文](2026-08-15-bundle-style-plugin-installs.zh.md)

## Problem

The installer's single-tarball contract could not mount aggregator packages: `@linxin666/dsh-web-ui-all` (the "全家桶" bundle) installs as an entry whose host body is a no-op and whose client half is a DOM shim — every feature rides its `dsh.bundle.patch` rows and its twelve npm dependencies, none of which the installer provided. The desktop's own web-ui preset family stayed at the app-shipped 0.1.2, so installing or updating the aggregator produced zero visible UI and "updating didn't help". Separately, git-source installs cloned a repository and then read `<staging>/package.json` with no guard: a repository whose root has no manifest (monorepo, empty repo) failed with a raw `ENOENT: … open …/.staging-<ts>/package.json`, and a workspace root that does carry a manifest would have been installed under the wrong identity.

## Decision

`packages/host/plugin-installer` now installs a bundle-style package's full support surface (both npm and git sources):

- **Dependency tree** (`src/dependencies.ts`, `installPackageDependencies`): walks the installed manifest's transitive npm `dependencies` into the flat fallback, each resolved against the registry and extracted like the root package. An existing fallback copy is replaced only when its version differs from the resolved target — that single rule upgrades an app-shipped dependency (a symlink into the application closure, per the [fallback healing](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) and Fix 5) to the aggregated version, while matching copies and the app closure stay untouched. The walk terminates on a visited set, so cycles and diamonds install once; the plugin's own name is excluded from recursion. Progress reuses the existing `status` download percent per tarball; the wire is unchanged.
- **Bundle patch merge** (`src/bundle.ts`, `mergeBundleRows` / `removeBundleRows` / `setBundleRowsEnabled`, marker `# dsh-plugin-bundle: <id>`; the shared patch-file helpers live in `src/patch-document.ts`): the installed package's `dsh.bundle.patch` items merge into the profile user patch layer under the file lock, preserving every unowned node, comment, and `!!js` expression (bundle nodes are cloned, not re-created from JS values, so tags survive). Insert rows whose ids the profile patch already claims — a preset product row (`dsh-plugin-control`), the plugin's own installer row, or an earlier merged row — are skipped, because the user layer composes by push and a duplicate id would mount the entry twice; the existing row stays the single authority. Bare override rows append verbatim (they patch by id; the last row wins). A re-install or update first drops the plugin's earlier merged rows, so the new version's patch replaces the old.
- **Lifecycle integration** (`src/index.ts`): `uninstall` removes the merged bundle rows (installed dependency packages remain in the fallback as untracked support files, reused or refreshed by a later install); `set-enabled` mirrors the plugin's flag onto its merged rows, so the family switch controls the whole group; a missing declared bundle patch fails loud with the path.
- **Git URL normalization** (`src/git-source.ts`, `normalizeGitUrl`): the `github:user/repo` shorthand expands to `https://github.com/user/repo.git` and the `git+` prefix is stripped before `git clone`/`ls-remote`, so a pasted shorthand clones without depending on the machine's insteadOf/ssh aliasing.
- **Git identity diagnostics** (`src/git-source.ts`, `validateGitIdentity`; `readInstalledIdentity` gains the source context): the cloned checkout's manifest is validated before anything is written — no root `package.json` → typed error naming the URL; `private: true` or declared `workspaces` → "multi-package workspace root, not an installable plugin package; install the published npm package instead"; invalid package name → typed error. Both helpers are exported from the package entry for the desktop shell's recovery reuse, alongside the existing shared helpers.

The CLI completes the picture: `dsh plugin --profile web add <pkg>` forwards to pnpm in the profile, and pnpm ≥10 refuses dependency build scripts with a non-zero exit (`ERR_PNPM_IGNORED_BUILDS`) leaving `allowBuilds` placeholders — `apps/cli/src/plugin.ts` (`approvePendingBuilds`) fills those placeholders and retries the exact command once, then the existing reconciliation joins the aggregator to `dsh.profile.bundles`, where its patch applies as a bundle layer at boot (duplicate entry ids across layers are replaced in place, last layer wins, so preset product rows keep their saved state over the colliding bundle rows).

Verified end to end against the live registry: installing `@linxin666/dsh-web-ui-all` into a temp home lands the aggregator plus all twelve `@linxin666/*` children at the resolved version in the fallback and merges all twelve bundle rows.

## Alternatives considered

**Boot-time bundle layers for installed plugins.** The profile launcher already composes `dsh.bundle.patch` layers for `dsh.profile.bundles` packages, so an installed aggregator could join as an extra layer. Rejected: the effective entry list is assembled once at boot by pushing layers in order, and the profile user patch layer already carries preset rows for nine of the aggregator's ids — the duplicate entries would collide at activation (or silently shadow the preset state), and `set-enabled`/`uninstall` would need a parallel boot-side source of truth. Merging into the patch layer keeps one authority: the user layer, which the loader already composes and the plugin list already rewrites.

**Install dependencies for every plugin, not just bundle-style ones.** The tree with version-replacement can override app-shipped packages with versions satisfying a plugin's range but incompatible with the app's shared module graph (duplicate React is the canonical breakage). Scoping the tree to packages declaring `dsh.bundle.patch` keeps the blast radius opt-in; ordinary plugins keep resolving their dependencies from the application's shipped closure.

**Untracked dependency files recorded in `plugins.json`.** Rejected: dependency packages are support files, not user plugins — recording them would surface them in the plugin list, and removal would need ownership tracking across shared deps. They stay untracked in the fallback; a later install reuses or refreshes a matching copy, and uninstall never removes a package another plugin may use.

## Consequences

- Installing the aggregator now delivers its promise: the family mounts at the aggregated version after restart, upgrading the built-in web-ui family without a preset catalog bump, and the plugin-list switch controls the whole group.
- Dependency packages accumulate in the fallback after uninstall — a bounded, documented cost (they are files, not state); the app-shipped closure is never deleted, only shadowed by same-named real directories that the [fallback healing](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) keeps at boot.
- Git installs of monorepo URLs now fail with an actionable message instead of `ENOENT`, and the workspace-root mis-install (the aggregator's own repository would have installed as `dsh-web-ui@0.1.1`) is rejected.
- A bundle patch whose insert ids collide with preset rows still mounts the preset rows (with their saved state), not the bundle's copies — the preset group remains the user-visible switch for those entries.

## Related

- [User plugin install and update](../../implemented/architecture/2026-08-14-user-plugin-install-and-update.md) owns the install pipeline, the fallback layout, and the managed patch-row formats this change extends; [profile plugin bundles](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) owns the bundle-layer semantics the merge mirrors.
