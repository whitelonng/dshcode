/** Wire-protocol tests for the archived-sessions page. */

import { describe, expect, it } from 'vitest'
import { parseArchivedSessionList } from '../src/client/protocol.ts'

describe('parseArchivedSessionList', () => {
  it('parses a valid items array and drops absent optional fields', () => {
    expect(parseArchivedSessionList({ items: [
      { sessionId: 's1', title: '标题', createdAt: 1234 },
      { sessionId: 's2' },
    ] })).toEqual([
      { sessionId: 's1', title: '标题', createdAt: 1234 },
      { sessionId: 's2' },
    ])
  })

  it('rejects a non-object response, a missing items array, and malformed rows', () => {
    expect(() => parseArchivedSessionList(null)).toThrow('must contain an items array')
    expect(() => parseArchivedSessionList({})).toThrow('must contain an items array')
    expect(() => parseArchivedSessionList({ items: [{ title: 'no-id' }] })).toThrow('must carry a sessionId')
    expect(() => parseArchivedSessionList({ items: [{ sessionId: 's1', title: 7 }] })).toThrow('title must be a string')
    expect(() => parseArchivedSessionList({ items: [{ sessionId: 's1', createdAt: -1 }] }))
      .toThrow('createdAt must be a non-negative safe integer')
    expect(() => parseArchivedSessionList({ items: [{ sessionId: 's1', createdAt: 1.5 }] }))
      .toThrow('createdAt must be a non-negative safe integer')
  })
})
