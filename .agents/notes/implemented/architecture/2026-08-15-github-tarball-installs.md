# Agent Note: GitHub plugin installs ride codeload tarballs and the GitHub API

Status: implemented

English | [中文](2026-08-15-github-tarball-installs.zh.md)

## Problem

The self-rolled git path (machines without pnpm) installed every GitHub plugin with `git clone --depth 1` (120 s cap) followed by `git ls-remote` (30 s cap). GitHub's smart-HTTP clones stall easily on poor routes, the machine needs a `git` binary at all (common gap on Windows), and the panel's catalog entries are all GitHub repositories, so every install from the list paid the full clone cost. Timeouts during install were the dominant field complaint.

## Decision

**GitHub tarball + API path (`src/git-source.ts`).** `parseGithubUrl` extracts `owner`/`repo`/`ref` from the normalized URL; `normalizeGitUrl` now expands `github:owner/repo#ref` shorthands preserving the pin, and `isGitSpec` accepts pasted `https://github.com/owner/repo#ref` URLs. `installFromGithub` downloads `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref|HEAD>` — codeload is a CDN serving the source tree without git pack negotiation, and `HEAD` resolves the default branch — and extracts it with `tar.x({ strip: 1 })`, the same layout contract as the npm path. `githubCommitSha` resolves the recorded commit through `https://api.github.com/repos/<owner>/<repo>/commits/<ref|HEAD>`, which also works for `HEAD`; `GITHUB_TOKEN`/`GH_TOKEN` from the environment lifts the unauthenticated core rate limit (60 requests/hour, one lookup per install and per check-update). GitHub installs now need no `git` binary at all.

**Fallbacks, not silent switches.** A GitHub URL whose tarball path fails falls back to the existing shallow clone only when a `git --version` probe succeeds; without git the tarball failure is the final error. A codeload 404 (the repository does not exist or is private) is final in both cases — a clone would hang on the same miss. `gitRemoteHead` tries the API first and falls back to `git ls-remote` on API failure. Non-GitHub hosts keep the clone path byte-for-byte. Hard timeouts are sized for slow, rate-limited networks (a plain git clone through pnpm was observed completing in ~90 s on one): 30 s API, 300 s tarball, 60 s ls-remote, 300 s clone.

**Mirror prefix and GUI-PATH pnpm discovery.** Two field follow-ups for restricted networks: (1) the gateway `Config` gains an optional `githubMirror` (an http(s) URL prefix, validated and normalized at load — a set non-http(s) value fails loud), which is prepended to the codeload and api.github.com URLs only; the web-app bundle wires it as `!!js process.env.DSH_GITHUB_MIRROR`, so the packaged app reads it from `~/.dsh/.env` — the same layered-env seam the rest of the profile uses. The mirror operator sees the transferred content, so it stays opt-in and documented as such. (2) `pnpmAvailable` no longer probes PATH only: when `pnpm` is not found it probes static absolute paths (`/opt/homebrew/bin/pnpm`, `/usr/local/bin/pnpm`, `~/Library/pnpm/pnpm`, `~/.local/share/pnpm/pnpm`, `~/.volta/bin/pnpm`, `~/.local/bin/pnpm`, `~/bin/pnpm`) and then every node version under the nvm and fnm directories — GUI apps on macOS do not inherit the shell PATH, so the packaged desktop app could not see a terminal-working pnpm and silently took the self-rolled path; with the resolved binary, `runPnpm` delegates to the same pnpm that a terminal `dsh plugin add` proves works on the machine. Pasting a whole shell command into the install box is likewise rejected with a dedicated hint.

**Identity validation unchanged, plus sole-package promotion.** The typed errors for repositories without a root `package.json` (shell-installer distributions like `dsh-api-balance`), workspace roots, and invalid package names stay exactly as before — the tarball path just reaches that verdict faster. One field extension: a monorepo shell around exactly one package (root without `package.json`, a single manifest anywhere below it) installs as that package — `promoteSolePackage` walks the extracted tree (skipping `node_modules`/`.git`), moves the sole manifest's directory to the root, and fails loud naming the paths when several manifests exist. Another field extension: the declared entry point (string `exports`, string `exports["."]`, `main`, default `index.js`) must exist in the installed directory — `assertPackageEntry` runs on all three install surfaces (self-rolled npm, self-rolled git, pnpm-delegated), so a repository that does not commit its build output fails at install time with the build-and-commit advice instead of crashing the Loader at boot (the ecosystem convention is committing `lib/`). The install still records the HEAD commit so `check-updates` and `update` keep their existing semantics (a `#ref`-pinned tag install never reports an update, which is correct).

## Alternatives considered

**GitHub API tarball endpoint (`api.github.com/repos/o/r/tarball`).** One extra redirect and one extra rate-limited hop per download; codeload direct URLs avoid both and were verified to accept `HEAD`.

**Converting the spec before pnpm.** On pnpm machines, rewriting `github:owner/repo` into a codeload URL before `pnpm add` would speed up the delegated path too, but it changes what pnpm records in the profile manifest and its lockfile. Deferred: the reported failures all came from the self-rolled path.

**Monorepo subdirectory support.** The tarball could search depth-1 for a single `package.json` and install from it. Rejected: the workspace-root validation deliberately rejects multi-package repositories, and silently guessing a package root would mount the wrong package under a guessed name; installing the published npm package remains the documented answer.

**jsDelivr as the mirror.** jsDelivr has China nodes but serves files, not repository tarballs, and its file listing API cannot rebuild a source tree — so the mirror seam is a proxy-prefix (`https://gh-proxy.com/` style), which forwards the real codeload/API URLs. The ghproxy-family services are third-party and unstable; the seam accepts any http(s) prefix so users can point it at whichever mirror their network reaches.

## Consequences

- GitHub plugin installs from the catalog no longer time out on clone stalls, work on machines without git, and download only the source tree (no history, no pack negotiation).
- One new network dependency surface: api.github.com (rate-limited, token-liftable) and codeload.github.com (unlimited, unauthenticated); both degrade to the git clone path when git exists, and both can ride a configured mirror prefix on restricted networks.
- The packaged desktop app finds a Homebrew/npm-global pnpm by absolute path, so GitHub installs delegate to the pnpm path the terminal proves works — the self-rolled tarball path is now genuinely a fallback, not the GUI's only route.
- The git-source test suite now covers the tarball extraction fixtures, the API/fallback matrix, mirror URL routing, and mirror validation; the gateway end-to-end git test stubs codeload and the commits API and asserts no clone runs.
- Machines behind firewalls that allow git clone but block codeload keep working through the clone fallback.

## Related

- [pnpm delegation, SRI integrity, and the plugin discovery layer](2026-08-15-pnpm-delegation-and-plugin-discovery.md) owns the delegated path this change leaves alone; [bundle-style plugin installs and git identity diagnostics](2026-08-15-bundle-style-plugin-installs.md) owns the identity validation the tarball path still runs.
