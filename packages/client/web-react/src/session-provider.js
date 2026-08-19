import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/** Internal React bindings for the renderer host and active session provide bundle. */
import { createContext, useContext } from 'react';
import { bindSnapshotSelector } from "./bind.js";
/**
 * A missing-provider assembly error: the shell wired the tree wrong. The slot
 * error boundary rethrows this class so misassembly stays fail-loud while
 * registrant errors (inject factories, entry components) are contained
 * per entry.
 */
export class SlotAssemblyError extends Error {
}
/** In-package renderer host context. */
export const HostContext = createContext(null);
/**
 * Read the installed renderer host; throws outside the rendered root tree
 * (framework components must not render detached from the renderer).
 * @returns the host API.
 */
export function useHost() {
    const host = useContext(HostContext);
    if (!host)
        throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree');
    return host;
}
const BindingContext = createContext(null);
/** Read the current-session-optional bundle supplied at the root. */
export function useSessionMaybeProvideInfo() {
    const info = useContext(BindingContext);
    if (!info)
        throw new SlotAssemblyError('session-aware slot rendered outside the root binding provider');
    return info;
}
/**
 * Read the enclosing session provide bundle; throws outside a SessionProvider
 * subtree (session slots must not render without a session).
 * @returns the enclosing bundle.
 */
export function useSessionProvideInfo() {
    const info = useSessionMaybeProvideInfo();
    if (info.sessionId === undefined)
        throw new SlotAssemblyError('strict session slot rendered without a session');
    return info;
}
/**
 * Identity-stable selector hook per host observable. uSES resubscribes when
 * the subscribe reference changes, so the bound hook must be created once per
 * source — cached here by source identity (sources are host-owned singletons).
 * @param source - host-provided observable.
 * @returns the cached selector hook.
 */
export function observableHook(source) {
    let hook = hookCache.get(source);
    if (hook === undefined) {
        hook = bindSnapshotSelector(source);
        hookCache.set(source, hook);
    }
    return hook;
}
const hookCache = new WeakMap();
const absentSource = {
    getSnapshot: () => undefined,
    subscribe: () => () => { },
};
/** Bind a source that disappears with the current session to an optional selector hook. */
export function maybeObservableHook(source) {
    if (source !== undefined)
        return observableHook(source);
    return useAbsentSnapshot;
}
function useAbsentSnapshot(_selector, _equal) {
    // The uSES subscription must still run (hook-order stability); the absent
    // source always snapshots undefined, returned explicitly.
    observableHook(absentSource)(() => undefined);
    return undefined;
}
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
export function projectionHook(info) {
    let hook = projectionHookCache.get(info);
    if (hook === undefined) {
        hook = (key, selector, eq) => {
            // The no-session (faceless) branch binds the shared absent source so
            // the caller's selector still runs over `undefined` (absence flows
            // through the selector) and the uSES call count stays constant.
            const useValue = observableHook(info.projections?.faceOf(key) ?? absentSource);
            // Whole values are finished wire payloads (reference changes only when
            // a frame or baseline lands), so the identity selector needs no
            // equality function.
            return useValue(selector ?? (value => value), eq);
        };
        projectionHookCache.set(info, hook);
    }
    return hook;
}
const projectionHookCache = new WeakMap();
/**
 * Root-level binding provider. It follows current selection without a key;
 * per-entry identity is the outlet's adoption bookkeeping (SessionMaybeEntry):
 * a blank-born incarnation adopts the first session without remounting, and
 * every later transition (switch or loss) remounts like a strict entry.
 */
export function SessionMaybeProvider({ children }) {
    const host = useHost();
    const info = observableHook(host.sessions.provideInfo)(s => s);
    return (_jsx(BindingContext.Provider, { value: info, children: children }));
}
/**
 * Framework-wired session area: subscribes to the host's current provide
 * source and remounts the body under `key={sessionId}` so a session switch
 * rebuilds the session subtree. This dependency-inverted layer uses plain
 * string ids; `PropsRuntime` applies the branded type at the component
 * boundary.
 */
export function SessionProvider({ empty, children }) {
    const host = useHost();
    const info = observableHook(host.sessions.provideInfo)(s => s);
    const id = info.sessionId;
    if (id === undefined)
        return _jsx(_Fragment, { children: empty?.() ?? null });
    return (_jsx(BindingContext.Provider, { value: info, children: children(id) }, id));
}
//# sourceMappingURL=session-provider.js.map