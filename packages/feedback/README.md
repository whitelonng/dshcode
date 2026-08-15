# feedback/ — recorded human feedback

English | [中文](README.zh.md)

The feedback family exposes one contract: an immutable remark in the canonical Session log. It never enters the model conversation.

| Package | Role | ctx key |
|---|---|---|
| `command-feedback/` | Trigger-independent `feedback/record` event plus the human-facing `/feedback` producer | — |

A command feedback remark is log-only: it never enters model context or derived history. When mounted, [`dsh-session-telemetry-otel`](../session/session-telemetry-otel) observes `feedback/record` to release a pending telemetry prefix or warn that disabled telemetry leaves the feedback local; capture itself remains independent of that policy.
