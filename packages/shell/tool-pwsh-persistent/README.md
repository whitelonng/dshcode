# @deepseek-ai/dsh-tool-pwsh-persistent

English | [中文](README.zh.md)

Model-facing `pwsh(command)` backed by one owner-scoped `ctx.terminals` shell. The package owns the tool contract and shell reuse; deployments select the terminal backend (a `terminal-bash` instance configured with `shellDialect: pwsh`) and sandbox policy. It is the Windows counterpart of `tool-bash-persistent`: same persistent-state contract, PowerShell dialect.

## Config

| Key | Default | Meaning |
|---|---:|---|
| `backendType` | `shell` | Registered terminal backend used for each Agent shell. |
| `timeoutMs` | `300000` | Wall-clock limit for one command; timeout closes the shell. |
| `maxOutputChars` | `16000` | Maximum retained command-output characters; fixed diagnostics are added afterward. |
| `description` | Persistent-shell description | Model-facing environment contract. |

## Model Experience

### Tool schema

#### What the model sees

The generated [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh-persistent), including the configured `description`. The plugin contributes no standalone system-prompt section; the deployment owns persona and environment guidance.

#### Token effect

Fixed schema cost while `pwsh` is visible.

#### KV Cache effect

Prefix-stable while the configured description and schema remain unchanged.

### Tool results

#### What the model sees

Commands share one shell per Agent, so cwd, `$env:` variables, functions, and background jobs persist across calls. Results exclude private completion markers, the shell prompt, and the echoed input line (PSReadLine renders submitted input back into the stream; the marker-anchored extraction and the wrapper-source strip remove it). A nonzero wrapped command appends `[exit code: N]` — the exact native exit code when the command ran a native program, `1` for a terminating PowerShell error. A shell that exits before reporting that status instead appends `[shell exited: code N]`, `[shell killed by signal: SIG]`, or `[shell exited]` when the backend supplies neither (Windows forced termination reports exit 1 without a signal), then resets and tells the model that the next call starts fresh. Long output keeps the earliest retained prefix plus a clipping notice; if the terminal has already dropped that prefix, the result says so explicitly. Timeout returns bounded partial output, closes the uncertain shell, and reports the reset.

#### Token effect

Data-dependent. `maxOutputChars` bounds retained command output; fixed clipping, lost-prefix, status, timeout, and reset diagnostics can extend the result.

#### KV Cache effect

Append-only tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

- The tool requires an owning Agent and a real terminal backend with a pwsh dialect (Windows ConPTY or a POSIX pwsh).
- **Input echo is unavoidable**: PowerShell's PSReadLine renders submitted input back into the terminal stream, and there is no `stty -echo` equivalent. The marker-anchored extraction excludes the echo in complete results; the wrapper-source strip covers fallback paths, but a wrapper that wraps across the terminal width may leave a partial echo in partial-output results, bounded by `maxOutputChars`.
- Raw ESC characters inside model commands are unsupported: PSReadLine consumes them before execution. The wrapper escapes the control bytes it needs (`[char]27`-built OSC markers, backtick escapes for the body).
- A model redefinition of the `prompt` function removes the readiness marker; the shell then settles on the silence tier instead of the marker fast path.
- There is no interactive stdin during a command: a foreground command that reads input blocks until the readiness timeout, which resets the shell.
- SIGTSTP/SIGHUP are unavailable on Windows (backend-rejected); SIGINT is delivered as a console-wide Ctrl-C input write, which at a prompt cancels the pending line instead of signalling a process.
- Under the Windows ACL sandbox's read-only mode, pwsh starts in ConstrainedLanguage, which may deny the bootstrap's `[Console]::` encoding pin and prompt marker. Commands can still settle through the printable prompt and silence tier, but non-ASCII output may follow the host code page.
- The BEL-terminated OSC marker remains a readiness signal only; a BEL event channel to the model stays deferred, aligned with the current implementation.
