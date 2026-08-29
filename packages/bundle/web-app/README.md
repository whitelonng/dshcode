# `@deepseek-ai/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, the always-on client-plugin reload chain ([`dsh-client-hmr`](../../client/hmr/README.md), idle until a rebuild watcher rewrites client bundles), and mounts this package's `web-runtime` glue plugin (config `{openBrowser, printUrl, surfaceContext, trustedHosts}`). That plugin resolves the built frontend dist through `@deepseek-ai/dsh-web-frontend`'s exports, samples bind-dependent LAN trust once, provides it as `webRuntime` to the browser-trust fence and client roster, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, and registers the harness-source and web-surface prompt sections plus the bash-visible `DSH_WEB_URL` runtime variable when `surfaceContext` is true. After its Loader tree settles, it prints the `dsh web:` URL line when `printUrl` is true and opens the canonical host URL in the default browser when `openBrowser` is true and the inherited `SSH_CONNECTION` and `SSH_TTY` are blank or absent. An SSH launch keeps the URL line but suppresses browser handoff because the SSH client or editor owns the local forwarded address. Immediately before a handoff, the runtime prints `dsh web: opening the default browser; pass --no-open to disable`. A short-lived Node helper runs the maintained platform opener with the canonical scrubbed child environment. On Windows it stays alive until the short-lived PowerShell launcher exits, because `open` reports spawn before that launcher has handed the URL to the shell; elsewhere the helper stops after the opener accepts spawn. A helper failure writes a diagnostic with its reason and the manual URL to stderr without stopping the server, and no path waits for the browser to exit. This bundle also owns the app command line: the ordinary `web-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses `--host`, `--port`, repeatable `--trusted-host`, `--no-open`, and the app's `--help`, then provides `webStartup`; browser opening defaults on for local launches, and `--no-open` turns it off for this invocation. It rejects `--host 0.0.0.0` before publishing that service because the CLI intentionally does not support all-interfaces binding yet. Flag-configured rows inject the service and read it directly from lazy config, so nothing binds a port before argument resolution and `dsh --profile web --help` starts no server. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle.

## Model retry defaults

Web uses the shared bounded normal default of five eligible retries after the initial request. The `deepseek-official` route and settings-added pi-ai routes use that default when they omit `retryPolicy`; explicit provider policies still win. Web adds no retry-specific composition override, so the same omission behavior applies to non-Web profiles.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (order −98) orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **Only handoff startup is observable** — observation ends when the platform opener accepts spawn, except that Windows waits for its short-lived PowerShell launcher to exit; a later browser exit is not reported, and the printed URL remains the manual fallback.
- **SSH forwarding owns the browser URL** — the printed canonical URL names the remote host's loopback endpoint; automatic handoff is suppressed, and the SSH client or editor must expose and open its local forwarded address.
- **Browser command overrides are launch-only** — a discovered `.env` may not set `BROWSER`; only an inherited value may reach an opener path that honors the variable, so a checkout cannot choose an executable for automatic handoff.
