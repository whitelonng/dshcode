/**
 * Boot-manifest wire parsing: the host version field rides the injected graph
 * and is validated like every other wire member (fail loud at the boundary).
 */
import { describe, expect, it } from 'vitest'
import { parseBootManifest } from '../src/client/index.ts'

/** A minimal valid wire graph carrying one entry. */
const wire = (version?: unknown): Record<string, unknown> => ({
  rev: 'r',
  ...(version === undefined ? {} : { version }),
  entries: [{ id: 'a', url: '/plugins/a/client.js?rev=0', rev: '0' }],
})

describe('parseBootManifest version', () => {
  it('carries the host version into the parsed manifest', () => {
    expect(parseBootManifest(wire('1.0.0')).version).toBe('1.0.0')
  })

  it('rejects a missing version', () => {
    expect(() => parseBootManifest(wire())).toThrow('boot manifest version must be a string')
  })

  it('rejects a non-string version', () => {
    expect(() => parseBootManifest(wire(1))).toThrow('boot manifest version must be a string')
  })
})
