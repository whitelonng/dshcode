/**
 * Native file-picker tier selection: macOS osascript multi/single, Linux
 * Zenity→KDialog fallback, the abort rule, the win32 fail-loud arm, and the
 * newline-separated output parsing.
 */

type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<(
    command: string,
    args: readonly string[],
    options: { encoding: string; signal: AbortSignal; windowsHide: boolean },
    callback: ExecFileCallback,
  ) => void>(),
}))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { describe, expect, it, vi } from 'vitest'
import { pickNativeFiles, type FilePickerRunner } from '../src/native-picker.ts'

function failure(code: string | number, stderr = ''): Error {
  return Object.assign(new Error(`command failed: ${String(code)}`), { code, stderr })
}

const signal = () => new AbortController().signal

describe('native file picker', () => {
  it('uses the macOS multi chooser and parses newline-separated POSIX paths', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '/Users/a/x.txt\n/Users/a/b c.txt\n', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).resolves.toEqual({
      paths: ['/Users/a/x.txt', '/Users/a/b c.txt'],
    })
    expect(run).toHaveBeenCalledWith('osascript', expect.any(Array), expect.any(AbortSignal))
    expect(run.mock.calls[0]?.[1].join(' ')).toContain('multiple selections allowed')
  })

  it('uses the macOS single chooser without the multi flag', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '/Users/a/x.txt\n', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: false }, { platform: 'darwin', run })).resolves.toEqual({
      paths: ['/Users/a/x.txt'],
    })
    expect(run.mock.calls[0]?.[1].join(' ')).not.toContain('multiple selections allowed')
  })

  it('maps macOS user cancellation to null', async () => {
    const run = vi.fn<FilePickerRunner>(async () => { throw failure(1, 'execution error: User canceled. (-128)') })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).resolves.toBeNull()

    run.mockRejectedValueOnce(failure(2, 'permission denied'))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).rejects.toThrow('command failed')
  })

  it.each([
    ['a primitive error', 'failed'],
    ['an invalid code type', { code: true }],
    ['a missing stderr property', { code: 1 }],
    ['a non-string stderr property', { code: 1, stderr: 42 }],
  ])('does not mistake %s for macOS cancellation', async (_label, reason) => {
    const run = vi.fn<FilePickerRunner>(async () => { throw reason })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).rejects.toBe(reason)
  })

  it('fails loud on win32 with a named limitation', async () => {
    const run = vi.fn<FilePickerRunner>()
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'win32', run }))
      .rejects.toThrow('unsupported on win32')
    expect(run).not.toHaveBeenCalled()
  })

  it('uses Linux Zenity for multiple selection', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '/home/u/a.csv\n/home/u/b.csv\n', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).resolves.toEqual({
      paths: ['/home/u/a.csv', '/home/u/b.csv'],
    })
    expect(run).toHaveBeenCalledWith('zenity', expect.arrayContaining(['--multiple']), expect.any(AbortSignal))
  })

  it('falls back to KDialog when Zenity is missing', async () => {
    const run = vi.fn<FilePickerRunner>()
    run.mockRejectedValueOnce(Object.assign(new Error('no zenity'), { code: 'ENOENT', stderr: '' }))
    run.mockResolvedValueOnce({ stdout: '/home/u/a.csv\n', stderr: '' })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).resolves.toEqual({
      paths: ['/home/u/a.csv'],
    })
    expect(run).toHaveBeenLastCalledWith('kdialog', expect.arrayContaining(['--multiple']), expect.any(AbortSignal))
  })

  it('maps Linux Zenity cancellation to null', async () => {
    const run = vi.fn<FilePickerRunner>(async () => { throw failure(1) })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).resolves.toBeNull()
  })

  it('reports when no Linux picker command exists', async () => {
    const run = vi.fn<FilePickerRunner>(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run }))
      .rejects.toThrow('no supported native file picker found')
  })

  it('treats empty macOS stdout as cancellation', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).resolves.toBeNull()
  })

  it('strips a carriage return from newline-separated macOS paths', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '/a/x.txt\r\n/a/y.txt\r\n', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'darwin', run })).resolves.toEqual({
      paths: ['/a/x.txt', '/a/y.txt'],
    })
  })

  it('surfaces a non-cancellation, non-ENOENT Linux error', async () => {
    const run = vi.fn<FilePickerRunner>(async () => { throw failure(2, 'permission denied') })
    await expect(pickNativeFiles(signal(), { multiple: false }, { platform: 'linux', run })).rejects.toThrow('command failed')
  })

  it('rethrows a Linux-tier error when the signal was already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn<FilePickerRunner>(async () => { throw new Error('aborted during scan') })
    await expect(pickNativeFiles(controller.signal, { multiple: false }, { platform: 'linux', run }))
      .rejects.toThrow('aborted during scan')
  })

  it('surfaces a KDialog failure after Zenity is missing', async () => {
    const run = vi.fn<FilePickerRunner>()
    run.mockRejectedValueOnce(Object.assign(new Error('no zenity'), { code: 'ENOENT', stderr: '' }))
    run.mockRejectedValueOnce(failure(2, 'kdialog crashed'))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).rejects.toThrow('command failed')
  })

  it('runs the default command adapter when no runner is injected', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '/home/u/x.txt\n', '')
    })
    await expect(pickNativeFiles(signal(), { multiple: false }, { platform: 'linux' })).resolves.toEqual({
      paths: ['/home/u/x.txt'],
    })
  })

  it('uses the current process platform when no override is supplied', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '/default/x.txt\n', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: false }, { run })).resolves.toEqual({
      paths: ['/default/x.txt'],
    })
  })

  it('treats empty Linux Zenity stdout as cancellation', async () => {
    const run = vi.fn<FilePickerRunner>(async () => ({ stdout: '', stderr: '' }))
    await expect(pickNativeFiles(signal(), { multiple: false }, { platform: 'linux', run })).resolves.toBeNull()
  })

  it('falls back to KDialog for single selection without the multi flag', async () => {
    const run = vi.fn<FilePickerRunner>()
    run.mockRejectedValueOnce(Object.assign(new Error('no zenity'), { code: 'ENOENT', stderr: '' }))
    run.mockResolvedValueOnce({ stdout: '/home/u/a.csv\n', stderr: '' })
    await expect(pickNativeFiles(signal(), { multiple: false }, { platform: 'linux', run })).resolves.toEqual({
      paths: ['/home/u/a.csv'],
    })
    expect(run).toHaveBeenLastCalledWith('kdialog', expect.not.arrayContaining(['--multiple']), expect.any(AbortSignal))
  })

  it('treats empty KDialog stdout as cancellation', async () => {
    const run = vi.fn<FilePickerRunner>()
    run.mockRejectedValueOnce(Object.assign(new Error('no zenity'), { code: 'ENOENT', stderr: '' }))
    run.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).resolves.toBeNull()
  })

  it('maps KDialog cancellation to null after Zenity is missing', async () => {
    const run = vi.fn<FilePickerRunner>()
    run.mockRejectedValueOnce(Object.assign(new Error('no zenity'), { code: 'ENOENT', stderr: '' }))
    run.mockRejectedValueOnce(failure(1))
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'linux', run })).resolves.toBeNull()
  })

  it('fails loud on an unsupported platform', async () => {
    const run = vi.fn<FilePickerRunner>()
    await expect(pickNativeFiles(signal(), { multiple: true }, { platform: 'freebsd' as NodeJS.Platform, run }))
      .rejects.toThrow('unsupported on freebsd')
  })
})
