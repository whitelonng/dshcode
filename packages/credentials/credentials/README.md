# dsh-credentials

English | [中文](README.zh.md)

Credential Service Definition (`ctx.credentials`). One doctrine, three consequences:

**Configuration carries references to secrets, never the secrets.** A settings section or `cordis.yml` entry says `apiKeyEnv: DEEPSEEK_API_KEY`; the value behind that reference lives with a credential provider. So the settings document stays safe to sync and to render in a configuration UI, `describe()` can answer "is this configured, where from, can I write it" without ever holding a value, and rotating a secret touches no configuration file.

**Consumers resolve per operation.** `resolve(ref)` is called at the start of each operation (the LLM adapters resolve once per model request) and never cached across operations — that read is what makes a changed credential reach the very next request without restarting any plugin.

**An empty stored value is absent.** Everywhere: `resolve` skips it, `describe` reports it unconfigured. A blank can never masquerade as a configured secret.

## Two key spaces, two questions

A `CredentialRef` answers *what is behind this environment-variable name*, layered over the process environment, the managed store, and `.env` files. Everything above describes that half.

A `CredentialKey` answers *what credential does this plugin hold for this id*. Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and the empty-value rule does not apply: an `api-key` record carrying neither a key nor environment values states that its owner confirmed ambient authentication, which is configured.

The key is `<scope>/<id>`, where `scope` is the **owning plugin's registered name**. The scope is the owner rather than the domain because a `grant` payload is written in its owner's format: two plugins serving the same provider name would otherwise read each other's payload, and a record left behind by an uninstalled plugin could not be told apart from a live one. The `/` also keeps the two grammars disjoint, so the key spaces can never collide. A consumer whose id arrives from somewhere else — a settings dict key, a library's own provider id — asks `isCredentialKeySegment` before building a key, because an id outside the grammar can never have stored a record and should read as "nothing stored" rather than throw on the address.

## Surface

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')            // POSIX shell identifier, branded
const hit = await ctx.credentials.resolve(ref)           // { value, source } | undefined
const info = await ctx.credentials.describe(ref)         // { configured, source?, writable } — never the value
await ctx.credentials.set(ref, 'sk-…')                   // rejects while a read-only source shadows the ref
await ctx.credentials.unset(ref)                         // no-op when absent; same shadowing rule

const key = credentialKey('llm-pi-ai', 'openai-codex')   // <owner>/<id>, branded
await ctx.credentials.readRecord(key)                    // CredentialRecord | undefined
await ctx.credentials.describeRecord(key)                // { configured, kind?, writable } — never the value
await ctx.credentials.listRecords()                      // [{ key, kind }] — never values
await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { token: '…' } }))
await ctx.credentials.deleteRecord(key)                  // no-op when absent
```

`modifyRecord` is the only write path because a correct write depends on the current value: a token refresh is read-decide-replace, and the mutation must see the record as it stands at the moment the write is exclusive. Exclusion holds across processes, which is what stops two of them rotating one refresh token and losing whichever wrote first. Returning `undefined` from the mutation leaves the entry untouched and announces nothing.

`listRecords` exists even though the reference half has no enumeration by design. References are discovered from settings schemas (`apiKeyEnv` fields); records have no such path, so a surface that cannot list them cannot show what a user is authorized for, nor find an orphan left by an uninstalled plugin.

A `grant` record's `payload` is opaque: the seam never reads, validates, or reshapes it. The one constraint is that it survives a JSON round trip, which the provider enforces on the way in and on the way out — a value the store could not read back exactly as written is refused rather than stored lossily.

`credentials/reference-updated (ref)` fires after a committed change to a provider-managed source — a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Consumers do not need the event (they re-resolve per operation); it exists for configuration UIs refreshing a "configured" badge. Its declaration lives in the client-safe `./types` subpath export together with the `CredentialRef` type it names (the package root re-exports the type), so a consumer outside the Host compilation face reads the very signature the Host emits instead of restating it.

The shadowing rule on `set`/`unset` is deliberate fail-loud: when a read-only source (the live process environment, in the local provider) currently supplies the reference, a write would appear to succeed while resolution keeps returning the shadowing value — the seam rejects instead, and `describe().writable` lets a UI render the reference read-only up front.

## Providers

[`dsh-credentials-local`](../credentials-local/README.md) layers the inherited process environment over its managed `$DSH_HOME/.credentials.yaml` document, with the launcher's project and user `.env` layers as fallbacks. The seam shape leaves room for keyring-, helper-command-, and KMS-backed providers; a remote settings provider never needs to carry secrets.

## Model Experience

Indirectly, through the consuming LLM adapters: a resolved value authorizes their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **References have no enumeration** — the seam answers questions about references it is given; configuration surfaces learn them from settings schemas, so a `list()` over that half has no current consumer. Records do enumerate, for the reason above.
- **References are environment-variable-shaped** — one flat POSIX-identifier namespace, because a reference doubles as the environment name it resolves through. Records carry the richer `<owner>/<id>` addressing.
- **Process-environment changes are invisible** — no event can fire for them; a UI only re-reads `describe()` on its own navigation.
- **A record's owner is its scope, and nothing verifies the scope is mounted** — the seam stores what it is given and reports what it stores. Recognizing an orphan is the caller's join between `listRecords()` and whatever registry owns that scope; the seam has no registry of its own to check against.
