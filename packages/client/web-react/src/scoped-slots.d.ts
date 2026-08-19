import { type SlotRenderer } from '@deepseek-ai/dsh-client-ui-slots';
/**
 * Build the renderer the shell installs into the runtime SlotRegistry
 * (ctx.slots.install(createSlotRenderer()) at boot; the service owns the
 * install/renderSlot contract and the double-install/not-installed throws).
 * @returns the renderer.
 */
export declare function createSlotRenderer(): SlotRenderer;
//# sourceMappingURL=scoped-slots.d.ts.map