# credentials/ — credentials and authorization

English | [中文](README.zh.md)

The credential capability family separates reference resolution from its provider, and separates both from obtaining a credential that has to be asked for:

| Package | Role | ctx key |
|---|---|---|
| [`credentials/`](credentials/README.md) | Credential-reference and credential-record seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | Environment and local-file provider | registers `ctx.credentials` |
| [`authorization/`](authorization/README.md) | Plugin-owned flows that obtain a credential by asking a human | `ctx.authorization` |

Configuration carries references, not secret values. Consumers resolve those references at their operation boundary; the child READMEs own mutation, precedence, and storage semantics. An authorization flow writes a credential record and is keyed by it, so the two seams meet at the record and nowhere else.

The subsystem reference — `CredentialRef`, per-operation resolution, UI-safe `CredentialInfo`, provider layers — is [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md).
