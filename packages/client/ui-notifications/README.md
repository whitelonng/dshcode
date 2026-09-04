---
description: "Owns the Web GUI's OS-notification surface: raises approval, session-completion, and background-job-completion alerts from the client object layer, and provides the General-settings notifications row that toggles them."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notifications

English | [中文](README.zh.md)

## Summary

The Web system-notification feature owner. It raises OS notification-bar alerts for two kinds of events — a session waiting for approval, and a finished session or background job — and owns the General-settings notifications row that toggles them. The event wiring reads the client object layer only, never the DOM, and one subscription over the `sessions.list` snapshot store carries approvals, session state, and jobs together. A `NotificationSink` platform seam renders through the standard Web Notification API or the Electron preload bridge, and the two preference toggles persist in the `notifications` settings namespace. Nothing here reaches a model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package into a Web client assembly; there is no separate install step and no configuration row to write.

### When to choose it

Choose this package when the GUI must notify a human about a task blocked on approval or a session or background job that just finished. Skip it when the desktop shell already surfaces native notifications through its own channel, or when the page is always visible and the in-app completion dot is sufficient.

### Minimal configuration

No mount: the package registers its settings section and service through the ordinary client assembly. The two toggles persist with defaults `approvals: true` and `completions: true`; enabling a toggle requests web permission on first use.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`NotificationsService`](src/client/notifications-service.ts) subscribes to the `sessions.list` snapshot store (the same authoritative feed the sidebar renders) and folds three edges into notifications: a session's `pendingInteraction` flipping to `'approval'`, a session's `running` flipping to false, and a background job leaving `running`/`stopping` in the `jobsBySession` mirror. Choosing the list snapshot means sessions that were never instantiated still raise notifications — the manager tracks their interaction status list-wide — and one subscription carries approvals, session state, and jobs together. Approvals always notify; completions notify only while `document.visibilityState === 'hidden'`, because the in-app completion dot already covers the visible case.

A 5-second dedup window keyed by `(kind, id)` — the session id for approvals and session completion, the job id for job completion — keeps reconnect replays and rapid retries from spamming. Clicking a notification focuses the window and calls `sessions.open(sessionId)`, switching to the owning session. A notification whose tool name is available (the session is instantiated and its conversation snapshot carries the `PendingWait`) titles itself `需要授权：<toolName>`; otherwise it falls back to the generic approval title.

The platform seam is a [`NotificationSink`](src/client/notification-sink.ts): the standard Web Notification API in a browser, or the Electron preload bridge (main-process native notifications) inside the desktop shell, feature-detected with the bridge preferred. Environments with neither surface report `unsupported` and silently skip. The two toggles persist in the `notifications` settings namespace (`approvals`, `completions`, both default true) through the regular settings scope; a denied prompt leaves the toggle on with the settings page showing the state and a retry action. The node half registers the namespace schema when the settings service is composed.

The settings row registers `settings.general.item` (id `notifications`) inside the General section and mirrors the preference scope plus the permission state through its own store; the row and the notification copy share the package's `settings.notifications` locale namespace.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web client architecture](../../../docs/subsystems/web-client.md)
- [Conversation reference](../../../docs/subsystems/conversation.md)
- [Spaces, slots, and settings in the Web GUI](../../../packages/client/ui-settings/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package reads client-side object-layer state (the session list snapshot) and renders OS notifications for a human, touching no prompt, message, schema, stream, or tool result; it writes only the user's own preference fields through the settings wire. The model's view of approvals and background jobs stays with the interaction and jobs domains.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A reconnect re-arms a still-pending approval.** The manager clears interaction status on disconnect and replays it on reconnect, so the same approval can raise a second notification after the dedup window. This is deliberate — the approval is still blocking the task — but a flapping connection may repeat the ping.
- **The web permission prompt is browser-gated.** Browsers only present `Notification.requestPermission()` from a user gesture, so the request rides the toggle clicks (and the settings retry action); a session restored with toggles already on but permission never granted stays silent until the user enables again. The desktop shell is unaffected (native notifications need no permission).
- **Job completion without a job label reads as the session title.** Every job carries a producer label, so the generic title is only a wire-integrity fallback.
- **No e2e scenario.** Notification behavior depends on the browser Notification API and document visibility, which the headless e2e harness cannot assert reliably; the behavior is pinned by the jsdom service and component specs instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the notifications surface owns no cross-plugin runtime relation.
