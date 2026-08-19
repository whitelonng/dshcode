/**
 * ACP snapshot suite kit — the shared machinery behind the keyless snapshot
 * tier (`pnpm run test:snapshot`). Four layers, composable per example: the
 * shared subprocess/client launcher ({@link launchAcpTestAgent}), the scripted
 * scenario harness ({@link runScenario}), the pure expected-output normalizers
 * ({@link normalizeStdout} / {@link normalizeSessionLog} /
 * {@link scrubRequestHeaders} / {@link scrubSystemPrompts}), and the suite
 * factory ({@link defineAcpSnapshotSuite}) that registers a scenario table as a
 * full describe/it tree. Ordinary ACP e2e tests can use the launcher directly;
 * an example's `*.snapshot.ts` supplies only its {@link AgentUnderTest} paths,
 * snapshots directory, and {@link Scenario} table.
 *
 * NOTE: ./suite.ts imports vitest, so this package is importable only inside a
 * vitest run — a support-tier constraint stated in the README.
 *
 * @module @deepseek-ai/dsh-acp-snapshot
 */
export { runScenario, } from "./harness.js";
export { launchAcpTestAgent, } from "./launcher.js";
export { extractSnapshotSpillPaths, normalizeSessionLog, normalizeStdout, scrubRequestHeaders, scrubSystemPrompts, scrubToolSchemas, tokenizeSessionFixtureCwd, } from "./normalize.js";
export { defineAcpSnapshotSuite, refreshFixtureReplacements, stabilizeFixtureMessageIds, stabilizeRefreshLog, } from "./suite.js";
//# sourceMappingURL=index.js.map