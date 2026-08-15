/** Wire-protocol tests for the plugin-installer tab. */

import { describe, expect, it } from 'vitest'
import {
  parseFailuresSnapshot,
  parseInstalledPlugin,
  parseInstallStatus,
  parsePluginControlSnapshot,
  parsePluginList,
  parseUpdateList,
} from '../src/client/protocol.ts'

const PLUGIN = {
  id: '@scope/demo',
  name: '@scope/demo',
  version: '1.0.0',
  source: { kind: 'npm', spec: '@scope/demo' },
  installedAt: '2026-08-14T00:00:00.000Z',
  enabled: true,
}

describe('plugin-installer protocol', () => {
  it('parses plugin lists and single installs, dropping absent commit fields', () => {
    expect(parsePluginList({ plugins: [PLUGIN] })).toEqual([PLUGIN])
    expect(parsePluginList({ plugins: [] })).toEqual([])
    expect(parseInstalledPlugin({ plugin: { ...PLUGIN, commit: 'abc123' } }).commit).toBe('abc123')
    expect(parseInstalledPlugin({ plugin: PLUGIN }).commit).toBeUndefined()
    expect(parseInstalledPlugin({ plugin: { ...PLUGIN, enabled: false } }).enabled).toBe(false)
  })

  it('parses update lists', () => {
    expect(parseUpdateList({ updates: [{ id: 'a', current: '1', latest: '2' }] }))
      .toEqual([{ id: 'a', current: '1', latest: '2' }])
    expect(parseUpdateList({ updates: [] })).toEqual([])
  })

  it('parses plugin-control snapshots and rejects malformed rows', () => {
    expect(parsePluginControlSnapshot({ controls: [{ id: 'genui', name: 'dsh-genui', repository: 'https://github.com/a/b', state: 'disabled' }] }))
      .toEqual([{ id: 'genui', name: 'dsh-genui', repository: 'https://github.com/a/b', state: 'disabled' }])
    expect(parsePluginControlSnapshot({ controls: [] })).toEqual([])
    expect(() => parsePluginControlSnapshot(null)).toThrow('controls array')
    expect(() => parsePluginControlSnapshot({ controls: [{ id: 'x' }] })).toThrow('control row')
    expect(() => parsePluginControlSnapshot({ controls: [{ id: 'x', name: 'y', repository: 'https://github.com/a/b', state: 'broken' }] }))
      .toThrow('control row')
  })

  it('parses install progress states', () => {
    expect(parseInstallStatus({ progress: { kind: 'idle', stage: 'fetch' } }))
      .toEqual({ kind: 'idle', stage: 'fetch' })
    expect(parseInstallStatus({ progress: { kind: 'install', stage: 'download', percent: 42 } }))
      .toEqual({ kind: 'install', stage: 'download', percent: 42 })
    expect(() => parseInstallStatus({ progress: { kind: 'install', stage: 'nope' } })).toThrow('progress')
    expect(() => parseInstallStatus({ progress: { kind: 'repair', stage: 'fetch' } })).toThrow('progress')
    expect(() => parseInstallStatus({ progress: { kind: 'install', stage: 'fetch', percent: 'half' } })).toThrow('progress')
    expect(() => parseInstallStatus({})).toThrow('progress')
  })

  it('rejects malformed rows and shapes', () => {
    expect(() => parsePluginList(null)).toThrow('must contain a plugins array')
    expect(() => parsePluginList({ plugins: [{ id: 'x' }] })).toThrow('is invalid')
    expect(() => parsePluginList({ plugins: [{ ...PLUGIN, source: { kind: 'tarball', spec: 'x' } }] })).toThrow('is invalid')
    expect(() => parsePluginList({ plugins: [{ ...PLUGIN, enabled: 'yes' }] })).toThrow('is invalid')
    expect(() => parseInstalledPlugin({ plugin: 'nope' })).toThrow('must contain a plugin row')
    expect(() => parseUpdateList({ updates: [{ id: 'a' }] })).toThrow('is invalid')
    expect(() => parseUpdateList({})).toThrow('must contain an updates array')
  })

  it('parses failures snapshots', () => {
    const snapshot = {
      items: [{
        pluginId: '@scope/broken',
        kind: 'load-failure',
        message: 'boom',
        stack: 'at boom',
        installPath: '/x/@scope/broken',
        at: '2026-08-14T00:00:00.000Z',
      }],
      pluginRoot: '/home/.dsh/profiles',
      safeMode: false,
    }
    expect(parseFailuresSnapshot(snapshot)).toEqual(snapshot)
    expect(parseFailuresSnapshot({ items: [], pluginRoot: '/x', safeMode: true }).safeMode).toBe(true)
  })

  it('rejects malformed failures snapshots', () => {
    const base = { items: [], pluginRoot: '/x', safeMode: false }
    expect(() => parseFailuresSnapshot(null)).toThrow('failures snapshot')
    expect(() => parseFailuresSnapshot({ ...base, items: 'nope' })).toThrow('failures snapshot')
    expect(() => parseFailuresSnapshot({ ...base, pluginRoot: 5 })).toThrow('failures snapshot')
    expect(() => parseFailuresSnapshot({ ...base, safeMode: 'yes' })).toThrow('failures snapshot')
    expect(() => parseFailuresSnapshot({ items: [{ pluginId: 'x' }], pluginRoot: '/x', safeMode: false }))
      .toThrow('failure row 0 is invalid')
    expect(() => parseFailuresSnapshot({
      items: [{ pluginId: 'x', kind: 'crashed', message: 'm', stack: 's', installPath: '/x', at: 't' }],
      pluginRoot: '/x',
      safeMode: false,
    })).toThrow('failure row 0 is invalid')
  })
})
