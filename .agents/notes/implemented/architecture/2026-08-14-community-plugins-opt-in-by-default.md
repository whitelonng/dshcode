# Agent Note: Community plugins ship installed but off by default

Status: implemented

English | [中文](2026-08-14-community-plugins-opt-in-by-default.zh.md)

> Scope: the shipped Web profile template and its installation-owned migration only. Reverses the template half of the [built-in community plugins note](2026-08-14-built-in-community-plugins-and-controls.md); that note stays the authority for the dependency, skin-tree, and Plugin-switch halves, which this change keeps.

## Problem

The shipped Web template mounted `@omdsh-dev/dsh-genui`, `@omdsh-dev/dsh-annotation`, and `@linxin666/dsh-web-ui-all` by default, so three third-party products loaded on every stock profile. Users who did not want them could only disable rows through the profile patch: removing the last bundle rewrites the manifest to the exact installation-owned tuple, and `loadProfile` normalizes that tuple back to the full template on the next boot — the "uninstall" silently reinstalls everything. The web-ui aggregate also pulled in its own describe-image rows that its users never chose.

## Decision

The shipped Web template is the two in-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) only. The three community products remain shipped packages — the web-app bundle keeps their pinned direct dependencies (profile module fallback resolution), the Plugin-switch cards keep them in the control catalog, and the installer stays the mounting path — so the products are installed-but-off rather than removed from the distribution.

The former five-bundle template becomes the installation-owned Web tuple: a stock profile carrying exactly that list migrates down to the two-bundle template, while any other list — including the two-bundle list itself — is user-owned and untouched. This is the existing no-surprise-layers policy applied in reverse.

Until a profile installs them, the three Plugin-switch cards render unavailable with disabled switches; mounting goes through the installer tab. The user's home patch describing the dsh-managed describe-image insert is removed as user data, not repo behavior.

## Alternatives considered

**Disable the community rows in the profile patch only.** Rejected: the products stay installed, and template normalization re-adds them whenever the manifest returns to the installation-owned tuple; the request was uninstall, not disable.

**Remove the community packages from the distribution.** Rejected: the dependency, skin-tree, and switch machinery keeps working for users who want the products, and shipping them keeps installs offline and attributed.

**Add a template flag instead of changing the list.** Rejected: a flag duplicates the bundle list the profile manifest already owns.

## Consequences

- New and migrated stock Web profiles mount only in-box plugins; the community products appear as installable cards, unavailable until installed.
- Existing profiles with exactly the former five-bundle list migrate down; customized lists stay untouched.
- The web e2e scaffold no longer composes the community bundle layers, and the plugin-controls golden records the unavailable cards.
