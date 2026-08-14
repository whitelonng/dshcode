# `@deepseek-ai/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, the always-on client-plugin reload chain ([`dsh-client-hmr`](../../client/hmr/README.md), idle until a rebuild watcher rewrites client bundles), and mounts this package's `web-runtime` glue plugin (config `{printUrl, surfaceContext, trustedHosts}`). That plugin resolves the built frontend dist through `@deepseek-ai/dsh-web-frontend`'s exports, samples bind-dependent LAN trust once, provides it as `webRuntime` to the browser-trust fence and client roster, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, registers the harness-source and web-surface prompt sections plus the bash-visible `DSH_WEB_URL` runtime variable when `surfaceContext` is true, and prints the `dsh web:` URL line when `printUrl` is true, after its Loader tree settles so a sibling failure cannot announce a dead app. This bundle also owns the app command line: the ordinary `web-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses `--host`, `--port`, repeatable `--trusted-host`, and the app's `--help`, then provides `webStartup`. It rejects `--host 0.0.0.0` before publishing that service because the CLI intentionally does not support all-interfaces binding yet. Flag-configured rows inject the service and read it directly from lazy config, so nothing binds a port before argument resolution and `dsh --profile web --help` starts no server. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle.

The shipped `web` profile layers only the in-box base and this bundle; [dsh-genui](https://github.com/omdsh-dev/dsh-genui), [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation), and the [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) aggregate ship as optional community products, off by default. This bundle's manifest declares the aggregate's nine entry packages plus the whale-song skin package as direct dependencies at the same pinned version so the profile module fallback can resolve their entry rows from a profile directory once a profile enables them; it also mounts the loopback-only [`plugin-control`](../../host/plugin-control/README.md) Host row whose deployment catalog can persist enablement for GenUI, Annotation, and all nine dsh-web-ui rows as one product. The browser Plugins settings surface is a single merged list tab: user plugins on top (install box, saved enablement switches, update/uninstall) and the built-in Loader entries collapsed below with switch-only enablement, served by the [`plugin-installer`](../../host/plugin-installer/README.md) and [`plugin-inventory`](../../host/plugin-inventory/README.md) gateways; changes take effect after DSH restarts.

The upstream skin center reads a `skins/` directory beside its own location, which no bundled deployment provides; the repo patches `@linxin666/dsh-client-ui-skin-center` (`patchedDependencies`) to also walk ancestor directories, to always insert the active skin's row into the managed patch section (the published aggregate wires no skin rows), and to reconcile the running Loader tree live after an apply — required because packaged Electron cannot provide Cordis HMR and the desktop does not watch patch files. `scripts/link-community-skins.mjs` (postinstall) plus the desktop packaging stage assemble the installed skin packages into that tree, so all seven skin-center cards (including whale-song) work in source and packaged deployments.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (order −98) orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

### Optional community plugins

#### What the model sees

With the community switches enabled, dsh-genui adds its `dsh-ui` output instructions and the `render_ui` and validation tools; dsh-annotation adds model-visible annotation text only when the user sends annotations; dsh-web-ui includes the SSH tool and prompt contribution alongside its browser panels, task board, Git graph, pet, live statistics, remote Web UI, settings, and skins. The upstream packages own their detailed prompts, tools, persistence, remote-access controls, and security behavior. In particular, SSH host configuration and credentials remain host data, SSH routes are loopback-only, and remote Web access requires the plugin's pairing flow.

#### Token effect

GenUI and SSH add their fixed instructions and tool schemas while enabled; Annotation adds text only to requests that carry a user annotation. Browser-only panels add no model tokens.

#### KV Cache effect

The GenUI and SSH prompt/tool contributions are stable within a process. A Plugin switch can change the next process's request prefix and tool list, which starts a new provider cache prefix after restart.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **Community switches require restart** — external plugins are not assumed to release every route, tool, or browser registration safely during live teardown, so Settings persists the desired profile state without mutating the running tree.
