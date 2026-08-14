/** Reasoning-efforts declaration parsing, formatting, and validation. */

import { describe, expect, it } from 'vitest'
import {
  formatReasoningEfforts,
  INVALID_EFFORTS,
  parseReasoningEfforts,
  validReasoningEfforts,
} from '../src/client/reasoning-efforts.ts'

describe('parseReasoningEfforts', () => {
  it('parses level: spelling pairs and empty text', () => {
    expect(parseReasoningEfforts('')).toEqual({ ok: true, value: undefined })
    expect(parseReasoningEfforts('  ')).toEqual({ ok: true, value: undefined })
    expect(parseReasoningEfforts('high: high, max: ultra'))
      .toEqual({ ok: true, value: { high: 'high', max: 'ultra' } })
    expect(parseReasoningEfforts('high:high,max:ultra'))
      .toEqual({ ok: true, value: { high: 'high', max: 'ultra' } })
  })

  it('treats off as the one level that may carry an empty spelling', () => {
    expect(parseReasoningEfforts('off')).toEqual({ ok: true, value: { off: null } })
    expect(parseReasoningEfforts('off:')).toEqual({ ok: true, value: { off: null } })
    expect(parseReasoningEfforts('off: none, high: high'))
      .toEqual({ ok: true, value: { off: 'none', high: 'high' } })
  })

  it('refuses unknown levels, empty non-off spellings, and bare non-off levels', () => {
    expect(parseReasoningEfforts('ultra: ultra').ok).toBe(false)
    expect(parseReasoningEfforts('high:').ok).toBe(false)
    expect(parseReasoningEfforts('high').ok).toBe(false)
    expect(parseReasoningEfforts('high: high,').ok).toBe(false)
    expect(parseReasoningEfforts('high: high,, max: ultra').ok).toBe(false)
  })
})

describe('formatReasoningEfforts', () => {
  it('round-trips declarations and renders empty for unset or disabled', () => {
    expect(formatReasoningEfforts(undefined)).toBe('')
    expect(formatReasoningEfforts(false)).toBe('')
    expect(formatReasoningEfforts({ high: 'high', max: 'ultra' })).toBe('high: high, max: ultra')
    expect(formatReasoningEfforts({ off: null })).toBe('off')
    const text = 'high: high, max: ultra, off:'
    const parsed = parseReasoningEfforts(text)
    if (!parsed.ok) throw new Error('fixture must parse')
    expect(formatReasoningEfforts(parsed.value)).toBe('high: high, max: ultra, off')
  })
})

describe('validReasoningEfforts', () => {
  it('accepts declarations, false, and absence; rejects the sentinel and bad shapes', () => {
    expect(validReasoningEfforts(undefined)).toBe(true)
    expect(validReasoningEfforts(false)).toBe(true)
    expect(validReasoningEfforts({ high: 'high', off: null })).toBe(true)
    expect(validReasoningEfforts(INVALID_EFFORTS)).toBe(false)
    expect(validReasoningEfforts({ ultra: 'ultra' })).toBe(false)
    expect(validReasoningEfforts({ high: '' })).toBe(false)
    expect(validReasoningEfforts({ high: 7 })).toBe(false)
    expect(validReasoningEfforts('nope')).toBe(false)
    expect(validReasoningEfforts([])).toBe(false)
  })
})
