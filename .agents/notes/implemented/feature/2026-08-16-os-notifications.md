# Agent Note: OS notifications for approvals and task completion

Status: implemented

English | [中文](2026-08-16-os-notifications.zh.md)

## Problem

The Web client surfaced blocking approvals and finished work only inside the page: the sidebar amber dot for a pending approval and the green "done" reminder for a finished session, both only visible while the browser tab is focused and scrolled to them. A user who switched tabs (or minimized the desktop window) had no signal that a session was blocked on an approval — work sat idle until the user happened to look — or that a long task had finished.

The Host already runs a completion-reminder machine (`SessionManager.completedNotifications`, driving the sidebar dot), and the background-job registry already pushes whole-snapshot `session/jobs` frames; what was missing was any channel that reached outside the page.

## Decision

A new client plugin, [`@deepseek-ai/dsh-client-ui-notifications`](../../../../packages/client/ui-notifications/README.md), turns object-layer edges into OS notifications, with a General-settings notifications row and a settings-namespace preference pair.

### Data plane: one snapshot subscription

The service subscribes to `sessions.list` — the manager's list snapshot store, the same authoritative feed the sidebar renders — and folds three edges between consecutive snapshots:

- `pendingInteraction` flipping to `'approval'` (approval notification);
- `running` flipping to false (session completion notification);
- a background job in `jobsBySession` leaving `running`/`stopping` (job completion notification).

The list snapshot was chosen over the per-session conversation snapshot because it covers sessions that were never instantiated (the manager tracks interaction status list-wide for the sidebar) and carries approvals, running state, and jobs in one subscription. The tool name for the approval title is read from `sessions.binding(id)?.session.getSnapshot().pending` when the session is instantiated; the title falls back to the generic form otherwise.

### Policy

- **Approvals always notify**, even while the page is visible: a blocked task deserves a ping.
- **Completions notify only while `document.visibilityState === 'hidden'`**: the in-app dot already covers the visible case, and a popup while watching the page would be noise.
- **A 5-second dedup window** keyed by `(kind, id)` — session id for approvals and session completion, job id for job completion — absorbs reconnect replays and rapid retries.
- **Clicking focuses the window and calls `sessions.open(sessionId)`**, switching to the owning session.
- **Two toggles** (`approvals`, `completions`, both default true) persist in the `notifications` settings namespace through the standard settings scope. Enabling a toggle requests web permission on first use (browsers only present the prompt from a user gesture, so the request rides the click); a denied prompt leaves the toggle on with the settings page showing the state and a retry action.

### Platform seam

The `NotificationSink` interface splits the environment: the standard Web `Notification` API in a browser, and the Electron preload bridge in the desktop shell. The desktop bridge is minimal — `notify({ id, title, body })` plus a click echo — the main process owns the native `Notification` instance, focuses the window on click, and sends the request id back so the renderer opens the target session. The renderer feature-detects the bridge and prefers it, so a desktop page never double-asks for web permission. Environments with neither surface report `unsupported` and silently skip.

## Alternatives considered

- **Subscribing to the per-session conversation snapshot for approvals.** The `PendingWait` list carries the tool name directly, but only for instantiated sessions — a session the user never opened would stay silent, which is exactly when a notification matters most. The list snapshot trades the tool name for universal coverage; the binding read recovers the name in the common case.
- **Notifying on the manager's `completedNotifications` set.** That set intentionally excludes the selected session and exists for the in-app dot; the notifications service needs the raw running→idle edge (including the selected session, since the page being hidden already proves the user is elsewhere) and drives it off the same snapshot.
- **DOM polling or a Web Worker check.** Violates the object-layer-only rule and the web layer's pure-presentation stance; the snapshot subscription is the sanctioned channel.
- **Pure Electron-side notifications.** The desktop shell runs the same web GUI; a second notification path would duplicate copy, toggles, and permission semantics. One renderer-side service with a sink keeps the feature single-sourced, and the browser path works for plain `dsh web` too.

## Testing

The jsdom service spec pins the three edges, the attach-time baseline, the dedup window, the hidden-only completion gate, the settings gating, permission request/denied/unsupported flows, and click navigation; a node-environment spec pins the no-`window`/no-`document` behavior; the sink spec stubs `window.Notification` and the desktop bridge; the apply spec proves service attachment over a real slot tree, and the Host spec proves the namespace registration. A keyless e2e was deliberately not added: notification behavior depends on the browser Notification API and document visibility, which the headless harness cannot assert reliably (recorded in the package README).

## Consequences

- **Reconnects can repeat an approval ping.** The manager clears interaction status on disconnect and replays it on reconnect, so the same approval can raise a second notification after the dedup window. Accepted: the approval is still blocking the task, and the dedup window absorbs rapid flapping.
- **Permission is browser-gesture-gated.** A session restored with toggles already on but permission never granted stays silent until the user re-enables; the settings page surfaces the state and the retry action. The desktop shell is unaffected.
- **The bridge is the desktop feature surface.** Any future renderer-driven native integration (tray badges, dock counts) extends the same preload bridge rather than adding a second channel.
