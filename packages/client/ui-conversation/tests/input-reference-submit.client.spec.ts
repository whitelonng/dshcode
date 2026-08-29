/**
 * Reference-submit transaction coverage: chips serialize through their
 * owner, stay resident through Host rejection, and clear only after an
 * accepted prompt.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerController, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId } from '../src/client/input/contract.ts'

const mention = '@[Research](dsh-session:InNvdXJjZSI)'
const spacedMention = '@[Research notes](dsh-session:InNvdXJjZSI)'
const commandImages = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
}

function chip(shell: SessionInputShell): void {
  shell.setDraft('@res')
  const accepted = shell.insertReference({
    source: 'reference',
    ref: mention,
    label: 'Research',
    clipboardText: mention,
  }, {
    start: 0,
    end: 4,
    draftRev: shell.snapshot.draftRev,
  })
  expect(accepted).toBe(true)
}

describe('reference submission', () => {
  it('mirrors canonical reference text so a persisted draft remains resolvable after remount', async () => {
    const mirror = vi.fn()
    const first = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: vi.fn(),
      commandImages,
    })
    first.bindMirror(mirror)
    first.setDraft('@res')
    expect(first.insertReference({
      source: 'reference',
      ref: spacedMention,
      label: 'Research notes',
      appearance: 'session',
      clipboardText: spacedMention,
    }, {
      start: 0,
      end: 4,
      draftRev: first.snapshot.draftRev,
    })).toBe(true)
    expect(first.snapshot.draft).toBe('@Research notes ')
    expect(mirror).toHaveBeenLastCalledWith(`${spacedMention} `)

    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const restored = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    restored.setDraft(mirror.mock.calls.at(-1)?.[0] as string)
    restored.submit()
    await vi.waitFor(() => {
      expect(sink).toHaveBeenCalledWith(spacedMention, [], 'queue', expect.any(AbortSignal))
    })
  })

  it('retains the chip on Host failure and clears it only after a later accepted retry', async () => {
    const serializeReference = vi.fn(() => Promise.resolve(mention))
    const sink = vi.fn<(
      _text: string,
      _imageIds: readonly DraftAttachmentId[],
      _mode: 'queue' | 'steer',
      _signal: AbortSignal,
    ) => Promise<SubmitOutcome>>()
      .mockResolvedValueOnce({ kind: 'error', text: 'snapshot unavailable' })
      .mockResolvedValueOnce({ kind: 'success' })
    const inputTriggers = {
      serializeReference,
      track: vi.fn(),
    } as unknown as InputTriggerController
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
    })
    chip(shell)
    expect(shell.snapshot).toMatchObject({
      draft: '@Research ',
      occurrences: [{ source: 'reference', ref: mention, label: 'Research', offset: 0, length: 9 }],
    })

    shell.submit('queue')
    expect(shell.snapshot.phase).toBe('submitting')
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(sink).toHaveBeenNthCalledWith(1, mention, [], 'queue', expect.any(AbortSignal))
    expect(shell.snapshot).toMatchObject({
      draft: '@Research ',
      occurrences: [{ source: 'reference', ref: mention, label: 'Research', offset: 0, length: 9 }],
    })
    expect(shell.notices.getSnapshot()).toMatchObject({
      level: 'error',
      text: 'snapshot unavailable',
    })

    shell.submit('queue')
    await vi.waitFor(() => {
      expect(shell.snapshot.draft).toBe('')
    })
    expect(sink).toHaveBeenNthCalledWith(2, mention, [], 'queue', expect.any(AbortSignal))
    expect(shell.snapshot.occurrences).toEqual([])
    expect(serializeReference).toHaveBeenCalledTimes(2)
  })

  it('blocks submission and retains the chip when its owner cannot serialize it', async () => {
    const sink = vi.fn()
    const inputTriggers = {
      serializeReference: () => Promise.reject(new Error('reference codec unavailable')),
      track: vi.fn(),
    } as unknown as InputTriggerController
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
    })
    chip(shell)
    shell.submit()
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(sink).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('@Research ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.notices.getSnapshot()).toMatchObject({
      level: 'error',
      text: 'reference codec unavailable',
    })
  })

  it('aborts Host-side preparation when the input shell is disposed', () => {
    let signal: AbortSignal | undefined
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: (_text, _imageIds, _mode, received) => {
        signal = received
        return new Promise<SubmitOutcome>(() => {})
      },
      commandImages,
    })
    shell.setDraft('send this')
    shell.submit()
    expect(signal?.aborted).toBe(false)
    shell.dispose()
    expect(signal?.aborted).toBe(true)
    expect(shell.snapshot.phase).toBe('plain')
    expect(shell.snapshot.draft).toBe('send this')
  })

  it('retains a rejected default message without duplicating its prompt error notice', async () => {
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: () => Promise.resolve({ kind: 'error' }),
      commandImages,
    })
    shell.setDraft('retry this')
    shell.submit()
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(shell.snapshot.draft).toBe('retry this')
    expect(shell.notices.getSnapshot()).toBeNull()
  })
})

describe('submit transaction hardening', () => {
  it('sends one image-only prompt per settlement, ignoring Enter during the round-trip', async () => {
    let settle!: (outcome: SubmitOutcome) => void
    const sink = vi.fn(() => new Promise<SubmitOutcome>((resolve) => { settle = resolve }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    expect(shell.addImages(['img-1' as DraftAttachmentId])).toBe(true)
    shell.submit('queue')
    shell.submit('queue')
    expect(sink).toHaveBeenCalledTimes(1)
    settle({ kind: 'success' })
    await vi.waitFor(() => {
      expect(shell.snapshot.imageIds).toEqual([])
    })

    expect(shell.addImages(['img-2' as DraftAttachmentId])).toBe(true)
    shell.submit('queue')
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('retains an image-only rejection without duplicating its prompt error notice', async () => {
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'error' }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    const imageId = 'img-1' as DraftAttachmentId
    shell.addImages([imageId])
    shell.submit()
    await Promise.resolve()
    await Promise.resolve()
    expect(shell.snapshot.imageIds).toEqual([imageId])
    expect(shell.notices.getSnapshot()).toBeNull()
  })

  it('re-tracks at the caret when a continuing insert-text splice lands (directory descent)', () => {
    const track = vi.fn()
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => ({ track } as unknown as InputTriggerController),
      defaultSink: vi.fn(),
      commandImages,
    })
    shell.setDraft('@sr')
    const applied = shell.insertText('@src/', { start: 0, end: 3, draftRev: shell.snapshot.draftRev }, true)
    expect(applied).toBe(true)
    expect(shell.snapshot.draft).toBe('@src/')
    expect(track).toHaveBeenCalledWith('@src/', 5, { tier: 'plain' }, shell.snapshot.draftRev)

    track.mockClear()
    shell.insertText(' plain ', { start: 0, end: 0, draftRev: shell.snapshot.draftRev })
    expect(track).not.toHaveBeenCalled()
  })
})
