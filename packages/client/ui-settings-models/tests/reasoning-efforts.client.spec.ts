/** Reasoning-efforts declaration parsing, formatting, validation, and checkbox toggling. */

import { describe, expect, it } from 'vitest'
import {
  defaultWireSpelling,
  formatReasoningEfforts,
  INVALID_EFFORTS,
  parseReasoningEfforts,
  suggestedReasoningLevels,
  toggleReasoningLevel,
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

  it('mirrors the adapter rule that a map offering only off must be spelled false', () => {
    expect(validReasoningEfforts({ off: null })).toBe(false)
    expect(validReasoningEfforts({})).toBe(false)
  })
})

describe('defaultWireSpelling', () => {
  it('spells every new level as its own name, and off as the empty spelling', () => {
    expect(defaultWireSpelling('off')).toBeNull()
    expect(defaultWireSpelling('minimal')).toBe('minimal')
    expect(defaultWireSpelling('low')).toBe('low')
    expect(defaultWireSpelling('medium')).toBe('medium')
    expect(defaultWireSpelling('high')).toBe('high')
    expect(defaultWireSpelling('xhigh')).toBe('xhigh')
    expect(defaultWireSpelling('max')).toBe('max')
  })
})

describe('toggleReasoningLevel', () => {
  it('adds a level with its existing wire spelling, or the default when newly offered', () => {
    expect(toggleReasoningLevel({ high: 'ultra' }, 'max')).toEqual({ high: 'ultra', max: 'max' })
    expect(toggleReasoningLevel(undefined, 'high')).toEqual({ high: 'high' })
    expect(toggleReasoningLevel({ high: 'ultra' }, 'off')).toEqual({ high: 'ultra', off: null })
  })

  it('removes a level on uncheck and yields false when the last one goes', () => {
    expect(toggleReasoningLevel({ high: 'high', max: 'max' }, 'high')).toEqual({ max: 'max' })
    expect(toggleReasoningLevel({ max: 'max' }, 'max')).toBe(false)
    expect(toggleReasoningLevel({ high: 'ultra' }, 'high')).toBe(false)
    expect(toggleReasoningLevel(false, 'high')).toEqual({ high: 'high' })
    // The invalid sentinel is not a map; toggling starts from nothing.
    expect(toggleReasoningLevel(INVALID_EFFORTS as never, 'high')).toEqual({ high: 'high' })
  })
})

describe('suggestedReasoningLevels', () => {
  it('maps protocol families to their common spans and leaves others unmapped', () => {
    expect(suggestedReasoningLevels('openai-completions')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(suggestedReasoningLevels('openai-responses')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(suggestedReasoningLevels('anthropic-messages')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(suggestedReasoningLevels(undefined)).toBeUndefined()
  })
})
