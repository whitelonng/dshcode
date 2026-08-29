import { describe, expect, it } from 'vitest'
import {
  createWindowsProcessInspector,
  isInvalidHandle,
  windowsProcessTree,
  WindowsProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'
import type {
  NativePtr,
  ProcessEntry,
  WindowsProcessInspectorInternals,
  WindowsProcessState,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'

function fakeInternals() {
  const entries: ProcessEntry[] = []
  const states = new Map<number, WindowsProcessState>()
  const kills: Array<[number, boolean]> = []
  return {
    internals: {
      snapshot: () => [...entries],
      processState: pid => states.get(pid),
      taskkill: (pid: number, force: boolean) => { kills.push([pid, force]) },
    } satisfies WindowsProcessInspectorInternals,
    add(entry: ProcessEntry, started?: string, active = true): void {
      entries.push(entry)
      if (started !== undefined) states.set(entry.pid, { started, active })
    },
    kills,
  }
}

describe('windowsProcessTree', () => {
  it('walks a table children-first with readable identities only', () => {
    const started = (pid: number): string | undefined => pid === 12 ? undefined : `t${pid}`
    expect(windowsProcessTree([
      { pid: 10, parentPid: 0 },
      { pid: 11, parentPid: 10 },
      { pid: 12, parentPid: 11 },
      { pid: 13, parentPid: 11 },
      { pid: 14, parentPid: 10 },
    ], 10, started)).toEqual([
      { pid: 13, started: 't13' },
      { pid: 11, started: 't11' },
      { pid: 14, started: 't14' },
      { pid: 10, started: 't10' },
    ])
  })

  it('returns an empty walk for an absent root', () => {
    expect(windowsProcessTree([{ pid: 10, parentPid: 0 }], 99, () => 't')).toEqual([])
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    const entries = [
      { pid: 10, parentPid: 11 },
      { pid: 11, parentPid: 10 },
    ]
    expect(windowsProcessTree(entries, 10, () => 't')).toHaveLength(2)
  })
})

describe('WindowsProcessInspector (injected internals)', () => {
  it('exposes the shell pid as the pseudo foreground group and never proves stdin waits', () => {
    const fake = fakeInternals()
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.foregroundPgid(77)).toBe(77)
    expect(inspector.isStdinWaiting(77)).toBe(false)
    expect(inspector.processSession(77)).toEqual([])
  })

  it('delegates tree walks and identity checks to the internals', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, 't10')
    fake.add({ pid: 11, parentPid: 10 }, 't11')
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.processTree(10)).toEqual([
      { pid: 11, started: 't11' },
      { pid: 10, started: 't10' },
    ])
    expect(inspector.isAlive({ pid: 11, started: 't11' })).toBe(true)
    expect(inspector.isAlive({ pid: 11, started: 'stale' })).toBe(false)
    expect(inspector.isAlive({ pid: 99, started: 't99' })).toBe(false)

    fake.add({ pid: 12, parentPid: 10 }, 't12', false)
    expect(inspector.isAlive({ pid: 12, started: 't12' })).toBe(false)
  })

  it('maps SIGKILL to a forced taskkill and other signals to the grace form', () => {
    const fake = fakeInternals()
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalGroup(77, 'SIGKILL')
    inspector.signalGroup(77, 'SIGTERM')
    inspector.signalGroup(0, 'SIGKILL')
    expect(fake.kills).toEqual([[77, true], [77, false], [0, true]])
  })

  it('signals a process only while its start identity matches', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, 't10')
    fake.add({ pid: 11, parentPid: 10 }, 't11', false)
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalProcess({ pid: 10, started: 't10' }, 'SIGKILL')
    inspector.signalProcess({ pid: 11, started: 't11' }, 'SIGKILL')
    inspector.signalProcess({ pid: 10, started: 'stale' }, 'SIGTERM')
    expect(fake.kills).toEqual([[10, true]])
  })

  it('accepts an injected internals factory through the creator', () => {
    const fake = fakeInternals()
    expect(createWindowsProcessInspector(fake.internals)).toBeInstanceOf(WindowsProcessInspector)
    expect(createWindowsProcessInspector()).toBeInstanceOf(WindowsProcessInspector)
  })
})

describe('isInvalidHandle', () => {
  it('rejects null, zero, and the all-ones INVALID_HANDLE_VALUE forms', () => {
    const ptr = (value: bigint): NativePtr => value as NativePtr
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(ptr(0n))).toBe(true)
    expect(isInvalidHandle(ptr(0xFFFFFFFFFFFFFFFFn))).toBe(true)
    expect(isInvalidHandle(ptr(-1n))).toBe(true)
    expect(isInvalidHandle(ptr(1234n))).toBe(false)
  })
})

const win32 = process.platform === 'win32' ? describe : describe.skip

win32('WindowsProcessInspector over the real koffi bindings', () => {
  it('walks the live process table from the test runner itself', () => {
    const inspector = createWindowsProcessInspector()
    const tree = inspector.processTree(process.pid)
    const self = tree.find(member => member.pid === process.pid)
    expect(self).toBeDefined()
    expect(inspector.isAlive(self!)).toBe(true)
    expect(inspector.foregroundPgid(process.pid)).toBe(process.pid)
  })

  it('reports unreadable identities for absent processes and no-ops tree signalling', () => {
    const inspector = createWindowsProcessInspector()
    expect(inspector.isAlive({ pid: 0x7FFFFFFF, started: 'absent' })).toBe(false)
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGTERM') }).not.toThrow()
    expect(() => { inspector.signalGroup(0, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalProcess({ pid: 0x7FFFFFFF, started: 'absent' }, 'SIGKILL') }).not.toThrow()
  })
})
