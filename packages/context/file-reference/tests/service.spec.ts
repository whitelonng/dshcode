/** The Remote face delegates to the provider's discovery contract unchanged. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReferenceService } from '../src/index.ts'
import type { FileReferenceCandidate } from '../src/types.ts'

describe('FileReferenceService', () => {
  it('serves the Remote face through the abstract discovery member', async () => {
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn((_agent: Agent, _query: string, _signal: AbortSignal) => Promise.resolve(candidates))
    class StubProvider extends FileReferenceService {
      list = list
    }
    const provider = new StubProvider(new Context())
    const agent = { id: 'target' } as unknown as Agent
    const signal = new AbortController().signal
    await expect(provider.remoteExportList(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })
})
