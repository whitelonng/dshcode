/** Release the gated background SDK child only after job_output starts waiting. */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'subagent-dsh-sdk-release-on-job-output'
export const inject = ['tools']

/**
 * Register the test-only execution-order barrier.
 * @param ctx - parent runtime context carrying the tool execution waterfall.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next) => {
    const delegated = next()
    if (exec.name === 'job_output') {
      writeFileSync('.dsh-sdk-background-release', 'release\n')
    }
    return delegated
  }, { prepend: true })
}
