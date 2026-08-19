/**
 * Wrap an async action into a stable invoke callback plus pending flag.
 * Concurrent invocations are counted: pending stays true until the last
 * in-flight call settles. The latest `fn` is always the one invoked.
 * @param fn - async action.
 * @returns invoke trigger and pending state.
 */
export declare function useInvoke(fn: () => Promise<unknown>): [invoke: () => void, pending: boolean];
//# sourceMappingURL=use-invoke.d.ts.map