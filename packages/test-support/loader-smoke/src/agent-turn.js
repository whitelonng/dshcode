/**
 * Test-only direct-agent turn driver shared by assembled Loader fixtures.
 * @module @deepseek-ai/dsh-loader-smoke/agent-turn
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
function addUsage(total, step) {
    const next = {
        inputTokens: (total?.inputTokens ?? 0) + step.inputTokens,
        outputTokens: (total?.outputTokens ?? 0) + step.outputTokens,
    };
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
        if (total?.[key] !== undefined || step[key] !== undefined)
            next[key] = (total?.[key] ?? 0) + (step[key] ?? 0);
    }
    return next;
}
function assistantText(event) {
    const blocks = event.data.message.content.filter(block => block.type === 'text');
    return blocks.length === 0 ? undefined : blocks.map(block => block.text).join('');
}
function onlyRootAgent(ctx) {
    const agents = ctx.get('agents')?.roots() ?? [];
    const [agent] = agents;
    if (agent === undefined || agents.length !== 1) {
        throw new Error(`fixture turn requires exactly one top-level agent, found ${agents.length}`);
    }
    return agent;
}
/**
 * Drive one task from its durable inbox receipt through whole-agent idle.
 * @param ctx - settled Loader context with exactly one configured root agent.
 * @param options - task and optional canonical-event observer.
 * @returns the final assistant text and accumulated model usage.
 */
export async function runFixtureTurn(ctx, options) {
    const agent = onlyRootAgent(ctx);
    await agent.whenIdle();
    const message = createUserMessage({
        content: [{ type: 'text', text: options.task }],
        source: { kind: 'user' },
    });
    let received = false;
    let output = '';
    const usageByStep = new Map();
    const disposeListener = ctx.on('session/event', (session, event) => {
        if (session !== agent.session)
            return;
        if (!received) {
            if (event.type !== 'agent/inbox/spliced'
                || !event.data.inserted.some(inserted => inserted.id === message.id))
                return;
            received = true;
        }
        options.onEvent?.(session.id, event);
        if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
            usageByStep.set(`${event.data.turn}/${event.data.step}`, event.data.chunk.usage);
        }
        if (event.type === 'assistant/message') {
            output = assistantText(event) ?? output;
            if (event.data.usage !== undefined) {
                usageByStep.set(`${event.data.turn}/${event.data.step}`, event.data.usage);
            }
        }
    });
    try {
        agent.followup(message);
        await agent.whenIdle();
    }
    finally {
        disposeListener();
    }
    await ctx.sessions.flush(agent.session);
    const usage = [...usageByStep.values()].reduce(addUsage, undefined);
    return {
        type: 'result',
        sessionId: agent.session.id,
        output,
        ...usage === undefined ? {} : { usage },
    };
}
//# sourceMappingURL=agent-turn.js.map