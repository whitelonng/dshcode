# Agent Note: Incubate Agent Teams as private experimental packages

Status: implemented

English | [中文](2026-08-18-experimental-agent-teams-packages.zh.md)

## Problem

Agent Teams needs the real Session log, subagent lifecycle, tools, examples, snapshots, and repository checks while its service and tool contracts continue to change. Placing those packages in a product-role group makes them members of the dsh release family and gives them the same publication expectation as stable packages.

An experimental directory without a current package previously imposed placement, dependency, promotion, and release rules on no consumer. Agent Teams supplies the concrete consumer, but the directory needs mechanical release exclusion and dependency isolation rather than a documentation-only status.

## Decision

`packages/experimental/agent-team` and `packages/experimental/tool-agent-team` are private workspace packages. The [experimental package naming decision](2026-08-19-experimental-package-name-prefix.md) owns their npm names and promotion rename; this note owns their placement, release exclusion, and dependency isolation.

The dsh pack and publish set and the local baseline publisher exclude every manifest below `packages/experimental/`. `release:dsh` still advances their manifest versions with the shared dsh version without creating release tags. Workspace constraints require each experimental package to set `private: true` and omit `publishConfig`. The same top-level check rejects `dependencies`, `optionalDependencies`, and `peerDependencies` from release packages, release apps, or the Python runtime to an experimental package. Experimental packages may depend on release packages and each other; tests may use them through `devDependencies`, and examples may load them explicitly.

The generic caller-reserved continuable child identity and selective direct-child drain remain in the stable Subagent service. They own Subagent identity and Activation lifecycle without importing or naming Agent Teams; the experimental Team service consumes them in the permitted direction.

Experimental status changes publication and compatibility expectations only. The packages retain the repository's ordinary documentation, invariant, lifecycle, security, unit, real-composition, and snapshot requirements. Promotion requires review of the public contracts, limitations, test evidence, release payload, runtime dependents, and a named owner accepting stable-package obligations.

## Alternatives considered

**Keep Agent Teams in a product-role group and describe it as opt-in.** Opt-in composition controls model behavior but does not exclude packages from publication or prevent stable packages from taking runtime dependencies on them.

**Reserve an empty experimental group.** A directory without a current package has no owner or release mechanism to test. The group exists only while concrete packages need its enforced treatment.

**Move the Subagent prerequisites into the experimental directory.** Child identity allocation and Activation teardown belong to the Subagent owner and contain no Team-specific contract. Moving or duplicating them would invert the dependency or split one lifecycle across packages.

## Consequences

Agent Teams can use the full repository graph and quality checks without entering official tarballs or becoming a supported runtime dependency. A release package cannot expose Team until the Team packages are promoted, so CLI and Web experiments use explicit example or experimental compositions instead of the shipped base bundles.

The product-role grouping is less direct while the packages incubate. Promotion creates path and npm-name churn as specified by the experimental package naming decision.
