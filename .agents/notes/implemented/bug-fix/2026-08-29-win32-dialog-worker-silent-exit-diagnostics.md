# Agent Note: Win32 dialog worker silent exits report the exit code and a bounded stderr tail

Status: implemented

English | [中文](2026-08-29-win32-dialog-worker-silent-exit-diagnostics.zh.md)

## Problem

A Windows DSHCode run reported `directory picker failed: directory picker failed: win32 folder dialog worker exited before reporting a result` when opening the workspace folder picker, and the dialog could not say why. The driver's exit handler dropped the child's exit code, and the spawn inherited the child's stderr into the host's own stderr, which a GUI-subsystem Windows process has nowhere to write. Every silent-exit cause — a missing `worker.cjs`, an uncaught top-level throw, a native crash, a relaunched application losing the single-instance lock — collapsed into one undiagnosable message. The packaged smoke hit the same wall: it writes a result file because Electron on Windows never reaches the runner log.

## Decision

The spawn pipes the worker's stderr (`['ignore', 'inherit', 'pipe', 'ipc']`; stdout stays inherited), and the driver keeps the last 4096 bytes of it. A worker exit without a result rejects with `win32 folder dialog worker exited before reporting a result (code <n> | signal <s>)`, followed by the captured tail when it is non-empty. The worker protocol, the settle-once guard, and the WM_CLOSE abort path are unchanged.

## Alternatives considered

- **Keep stderr inherited and add only the exit code.** Rejected: an exit code alone cannot name a launch, module, or native crash, and GUI hosts discard inherited stderr entirely.
- **Capture the complete stderr.** Rejected: unbounded capture in a long-lived host process; the cause of a crash sits at the end of the output, so a bounded tail suffices.
- **Tee captured chunks to the host stderr.** Rejected: on GUI-subsystem hosts the parent channel is empty, so the tee adds a second surface without reaching the operator; the tail rides the rejection instead.
- **Write a worker log file.** Rejected: a new lifecycle artifact needing rotation and cleanup when the diagnostic already travels in the rejection.

## Consequences

- A silent exit now names its exit code or signal and the tail of the worker's stderr, so the failure the user reported becomes self-describing on the next attempt.
- Dev consoles lose live worker stderr: it surfaces only inside the rejection. The worker prints nothing on the success path, so the loss is confined to failure diagnostics.
- The rejection text is unpinned product-visible text; only the package tests assert it, and none beyond those.

## Verification

- `packages/host/directory-picker-native/tests/win32-dialog.spec.ts` pins the exit-code-only, exit-with-stderr, signal-only, and 4096-byte tail-bound rejections.
- `packages/host/directory-picker-native/tests/win32-dialog-host.spec.ts` pins the spawn stdio to `['ignore', 'inherit', 'pipe', 'ipc']`.

## Related

- [Win32 dialog worker source launch drops the tsx bootstrap](2026-08-19-win32-dialog-worker-source-launch.md) owns the launch arms whose silent failures this note makes reportable.
- The packaged smoke's result-file workaround (`apps/desktop/scripts/smoke-packaged-win32-picker.mjs`) records the same GUI-subsystem opacity this decision addresses at the driver level.
