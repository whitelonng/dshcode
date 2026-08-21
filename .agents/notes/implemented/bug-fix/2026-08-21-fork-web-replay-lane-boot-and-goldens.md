# Agent Note: fork web replay lane boot, branding, and golden fixes

Status: implemented

English | [中文](2026-08-21-fork-web-replay-lane-boot-and-goldens.zh.md)

## Problem

The fork's `web browser replay` lane was red on master for four independent reasons, three of them masked: every assembled-jsdom snapshot file died at import (`TypeError: The URL must be of scheme file` from `readProductVersion`), so the tests behind them never ran. Behind that mask sat the settings Plugins section showing two identically labeled tabs, a replay build without the official client profile (breaking `built-boot`'s official-branding pins), and the whole lane's goldens drifting on the message-feedback buttons.

## Decision

**Product version reads use `import.meta.dirname`.** Vitest 4's module runner serves in-root dependency modules over the dev server's HTTP URL, so `import.meta.url` inside `@deepseek-ai/dsh-client-modules` is `http://localhost:<port>/packages/client/modules/src/index.ts` in the jsdom lane and `fileURLToPath(new URL(…))` throws. `import.meta.dirname` is the real filesystem directory in both the runner and a built Node runtime, so the same one-hop `../package.json` read works everywhere.

**The fork replay lane builds with the official profile.** The web job now sets `DSH_BUILD_CLIENT_PROFILE: official` (matching upstream's compatibility smokes), so `ui-brand-official` registers and `built-boot`'s wordmark/`DSH Local Build` assertions hold.

**The Plugins section's two tabs get distinct labels.** Upstream's `ui-settings-plugin-inventory` (runtime fiber inventory) and the fork's `ui-settings-plugin-installer` (merged manage list) both registered `settings.plugins.tab` with the label 插件列表 / Plugin list. The inventory tab is renamed 插件状态 / Plugin status; the installer keeps 插件列表 because the settings e2e pins it as the manage surface.

**Scenario timing is hardened, not the product.** `message-feedback-layout`'s `settleAt` now requires three identical column-width reads at 150 ms spacing — two adjacent reads agreed both before the narrow-state flip lands and inside the track ease's zero-velocity plateau. `settings-chrome`'s boot-theme scenario holds only the async plugin bundles: the modules and runtime rows are parser-blocking head preloads the boot queue needs, and holding them hid `<body>` so the loading page never appeared.

The drifted goldens were refreshed under `DSH_SNAPSHOT=refresh` and carry the Good response / Bad response buttons on the assistant IconActions row.

## Alternatives considered

**Patch `import.meta.url` through a vitest plugin.** A test-runner-specific transform inside production code to keep `fileURLToPath` would mask the real contract — that vitest's runner does not guarantee `file:` URLs — and still break the next loader that serves modules over HTTP.

**Drop the fork's inventory tab.** Removing an upstream package's registration diverges from the upstream package and deletes the runtime-status surface the fork ships; disambiguating the label keeps both surfaces and the upstream merge-forward.

**Let the boot-theme scenario hold no bundles and assert after boot.** That abandons the scenario's whole point — proving the persisted dark preference applies at first paint, before plugins load — for a quieter test.

## Consequences

Any future runtime `package.json` read in `client/modules` follows the `import.meta.dirname` pattern; code added there must not assume `import.meta.url` is `file:`. The fork web lane requires the official profile, and goldens now encode the feedback buttons, so re-recording them needs the same profile. The two plugin tabs are distinguishable by role: 插件列表 manages, 插件状态 inspects.
