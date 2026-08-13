import { describe, expect, it } from 'vitest'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { acpPromptToText, turnEndToStopReason } from '../src/codec.ts'

describe('ACP codec', () => {
  it.each([
    [{ kind: 'completed' }, 'end_turn'],
    [{ kind: 'max-tokens' }, 'max_tokens'],
    [{ kind: 'aborted', reason: { kind: 'user' } }, 'end_turn'],
    [{ kind: 'interrupted' }, 'cancelled'],
    [{ kind: 'blocked' }, 'end_turn'],
    [{ kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } }, 'end_turn'],
  ] satisfies Array<[TurnEndReason, string]>)('maps %o to %s', (reason, expected) => {
    expect(turnEndToStopReason(reason)).toBe(expected)
  })

  it('drops unsupported blocks from baseline text conversion', () => {
    expect(acpPromptToText([{
      type: 'image',
      data: '',
      mimeType: 'image/png',
    }])).toBe('')
  })
})
