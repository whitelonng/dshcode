/** Internal React bindings for the renderer host and active session provide bundle. */
import { type ReactNode } from 'react';
import type { HostObservable, MaybeSnapshotSelectorHook, SessionMaybeProvideInfo, SessionProvideInfo, SlotRendererHost, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
/**
 * A missing-provider assembly error: the shell wired the tree wrong. The slot
 * error boundary rethrows this class so misassembly stays fail-loud while
 * registrant errors (inject factories, entry components) are contained
 * per entry.
 */
export declare class SlotAssemblyError extends Error {
}
/** In-package renderer host context. */
export declare const HostContext: import("react").Context<SlotRendererHost | null>;
/**
 * Read the installed renderer host; throws outside the rendered root tree
 * (framework components must not render detached from the renderer).
 * @returns the host API.
 */
export declare function useHost(): SlotRendererHost;
/** Read the current-session-optional bundle supplied at the root. */
export declare function useSessionMaybeProvideInfo(): SessionMaybeProvideInfo;
/**
 * Read the enclosing session provide bundle; throws outside a SessionProvider
 * subtree (session slots must not render without a session).
 * @returns the enclosing bundle.
 */
export declare function useSessionProvideInfo(): SessionProvideInfo;
/**
 * Identity-stable selector hook per host observable. uSES resubscribes when
 * the subscribe reference changes, so the bound hook must be created once per
 * source — cached here by source identity (sources are host-owned singletons).
 * @param source - host-provided observable.
 * @returns the cached selector hook.
 */
export declare function observableHook<T>(source: HostObservable<T>): SnapshotSelectorHook<T>;
/** Bind a source that disappears with the current session to an optional selector hook. */
export declare function maybeObservableHook<T>(source: HostObservable<T> | undefined): MaybeSnapshotSelectorHook<T>;
/**
 * The useProjection framework seat (docs/subsystems/session-projection.md), one bound
 * function per provide bundle (cached by info identity — components may hold
 * it across renders). Key-addressed: the key resolves a per-session value
 * face off the projection store; the bound selector hook comes from the same
 * per-source cache as every other kit hook, so exactly one uSES subscription
 * runs per call and the subscribe reference stays stable per key. A key no
 * baseline or frame has carried (or a no-session bundle) reads `undefined` —
 * capability absence — keeping the hook order constant.
 */
export declare function projectionHook(info: SessionMaybeProvideInfo): (key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean) => unknown;
/**
 * Root-level binding provider. It follows current selection without a key;
 * per-entry identity is the outlet's adoption bookkeeping (SessionMaybeEntry):
 * a blank-born incarnation adopts the first session without remounting, and
 * every later transition (switch or loss) remounts like a strict entry.
 */
export declare function SessionMaybeProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** SessionProvider API: render-prop body plus the no-session branch. */
export interface SessionProviderProps {
    /** No-session body (also covers a current id whose session cannot be resolved). */
    empty?: (() => ReactNode) | undefined;
    /** Session body; remounted per session via key={sessionId}. */
    children: (sessionId: string) => ReactNode;
}
/**
 * Framework-wired session area: subscribes to the host's current provide
 * source and remounts the body under `key={sessionId}` so a session switch
 * rebuilds the session subtree. This dependency-inverted layer uses plain
 * string ids; `PropsRuntime` applies the branded type at the component
 * boundary.
 */
export declare function SessionProvider({ empty, children }: SessionProviderProps): import("react").JSX.Element;
//# sourceMappingURL=session-provider.d.ts.map