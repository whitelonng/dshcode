# Agent Note: Web UI abbreviates POSIX home paths as `~`

Status: implemented
Archived: 2026-08-22

English | [中文](2026-08-18-web-home-path-tilde.zh.md)

## Problem

Workspace hover cards and Tool call summaries showed full POSIX home paths. Those strings are long, repeat the same prefix on every row, and make the sidebar and transcript harder to scan. Windows paths must stay verbatim because `~` is not a Windows filesystem convention.

## Decision

`host.describe` reports the host account `home` as a required field. Client and Host ship together, so the field is required rather than optional. ApiProxy fills it from `homedir()` at describe time.

`abbreviateHomePath` in `dsh-client-runtime` is the display-only helper. It returns `~` or `~/…` when the path is the POSIX home or a descendant, and leaves the path unchanged when `home` is missing, empty, or `/`, when either value is a Windows drive or UNC path, or when the match is only a prefix (`/Users/u` does not claim `/Users/u2`). Tool summaries run workspace-relative shortening first, then this helper, so a path inside the session cwd stays short. `filePath`, Host open, and Workspace hover copy keep the authored filesystem path.

`ui-tool` and `ui-workspace` inject `connection.hostDescription` at their own slot registrations. ChatView does not grow a Host-description hook. The field is required on `ConnectionHandle`; test fakes supply a source whose snapshot may be undefined before connect.

The fixture Host home is `/home/fixture`. A second fixture Workspace at `/home/fixture/Documents/project` lets assembled replay hover `~/Documents/project` without moving the existing `/tmp/fixture` account. TerminalBlock's own prompt-label collapse is unchanged.

## Alternatives considered

**Guess `/Users` or `/home` without the real home.** Rejected because a shared prefix is not an account home, and `/Users/shared` or `/home/src` would abbreviate incorrectly.

**Abbreviate Windows `%USERPROFILE%` as `~` as well.** Rejected because the acceptance rule keeps Windows paths verbatim, and `~` is not how Explorer or `cmd` spell those paths.

**Put the helper in `dsh-home-paths`.** Rejected because that package expands configuration tildes on Node; this helper is a browser display rewrite and must not pull Node `os` into client bundles.

**Thread `home` from ChatView owner props.** Rejected because it enlarges the conversation inject face and every ChatView test harness for a display fact only Tool and Workspace cards consume.

## Consequences

POSIX home-rooted Workspace hover paths and leftover Tool path summaries display as `~`. Copy and open still use the full path. Windows drive and UNC paths never become `~`. A Host that reports `/` as home does not turn the whole filesystem into `~`. Before the first describe, or while reconnecting, the source snapshot is undefined and paths stay unabbreviated.

## Testing

Package tests cover `abbreviateHomePath`, `toolRowModel` / `readCardModel` home abbreviation, Workspace hover display versus copy, and `host.describe` schema plus live `homedir()`. Assembled replay `apps/web/tests/home-path-tilde.snapshot.ts` hovers the fixture home-descendant Workspace. Product-GUI PRs still record a real-browser GIF of the hover card.
