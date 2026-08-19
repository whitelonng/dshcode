/**
 * Test-only direct-agent turn driver shared by assembled Loader fixtures.
 * @module @deepseek-ai/dsh-loader-smoke/agent-turn
 */
import type { Context } from '@deepseek-ai/cordis';
import { type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Result envelope consumed only by snapshot and composition tests. */
export interface FixtureTurnResult {
    readonly type: 'result';
    readonly sessionId: string;
    readonly output: string;
    readonly usage?: TokenUsage;
}
/** Options for one fixture turn against exactly one configured root agent. */
export interface FixtureTurnOptions {
    readonly task: string;
    readonly onEvent?: (sessionId: string, event: SessionEvent) => void;
}
/**
 * Drive one task from its durable inbox receipt through whole-agent idle.
 * @param ctx - settled Loader context with exactly one configured root agent.
 * @param options - task and optional canonical-event observer.
 * @returns the final assistant text and accumulated model usage.
 */
export declare function runFixtureTurn(ctx: Context, options: FixtureTurnOptions): Promise<FixtureTurnResult>;
//# sourceMappingURL=agent-turn.d.ts.map