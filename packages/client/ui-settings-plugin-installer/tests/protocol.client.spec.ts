/** Wire-protocol tests for the plugin-installer tab. */

import { describe, expect, it } from 'vitest'
import { parseInstalledPlugin, parsePluginList, parseUpdateList } from '../src/client/protocol.ts'

const PLUGIN = {
  id: '@scope/demo',
  name: '@scope/demo',
  version: '1.0.0',
  source: { kind: 'npm', spec: '@scope/demo' },
  installedAt: '2026-08-14T00:00:00.000Z',
}

describe('plugin-installer protocol', () => {
  it('parses plugin lists and single installs, dropping absent commit fields', () => {
    expect(parsePluginList({ plugins: [PLUGIN] })).toEqual([PLUGIN])
    expect(parsePluginList({ plugins: [] })).toEqual([])
    expect(parseInstalledPlugin({ plugin: { ...PLUGIN, commit: 'abc123' } }).commit).toBe('abc123')
    expect(parseInstalledPlugin({ plugin: PLUGIN }).commit).toBeUndefined()
  })

  it('parses update lists', () => {
    expect(parseUpdateList({ updates: [{ id: 'a', current: '1', latest: '2' }] }))
      .toEqual([{ id: 'a', current: '1', latest: '2' }])
    expect(parseUpdateList({ updates: [] })).toEqual([])
  })

  it('rejects malformed rows and shapes', () => {
    expect(() => parsePluginList(null)).toThrow('must contain a plugins array')
    expect(() => parsePluginList({ plugins: [{ id: 'x' }] })).toThrow('is invalid')
    expect(() => parsePluginList({ plugins: [{ ...PLUGIN, source: { kind: 'tarball', spec: 'x' } }] })).toThrow('is invalid')
    expect(() => parseInstalledPlugin({ plugin: 'nope' })).toThrow('must contain a plugin row')
    expect(() => parseUpdateList({ updates: [{ id: 'a' }] })).toThrow('is invalid')
    expect(() => parseUpdateList({})).toThrow('must contain an updates array')
  })
})
