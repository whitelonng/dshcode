// @ts-nocheck -- alpha.4 sync: product pending protocol awaits the client-store deep migration
// @vitest-environment jsdom
/** ApprovalPanel keyboard confirmation: Cmd/Ctrl+Enter answers allowed-once. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ApprovalComposerProps } from '../src/client/contract/slots.ts'
import { ApprovalPanel } from '../src/client/skeleton/ApprovalPanel.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 'session-fixture' as SessionId
const t = makeTranslate(zh, commonZh) as ApprovalComposerProps['t']

function panelProps(respond: (result: unknown) => Promise<{ accepted: boolean; reason?: string }>) {
  const calls = (respond as unknown as { mock?: { calls: [unknown][] } }).mock?.calls
  void calls
  const wait = new PendingWait(
    'approval',
    RpcId(`ap-${Math.random().toString(36).slice(2)}`),
    SID,
    { approvalId: 'ap1', toolName: 'bash', reason: 'model justification' } as PendingWait<'approval'>['payload'],
    respond as never,
  )
  const snap = { chat: { timeline: { turns: new Map() }, nodes: new Map() } }
  const useSession = bindSnapshotSelector({
    getSnapshot: () => snap,
    subscribe: () => () => {},
  }) as unknown as ApprovalComposerProps['useSession']
  return { matched: wait, t, useSession, renderSlot: () => null } as unknown as ApprovalComposerProps
}

beforeEach(() => { cleanup() })
afterEach(() => { cleanup() })

describe('ApprovalPanel keyboard confirmation', () => {
  it('answers allowed-once on Ctrl+Enter while the panel is mounted', async () => {
    const respond = vi.fn(() => Promise.resolve({ accepted: true }))
    render(<ApprovalPanel {...panelProps(respond)} />)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await expect.poll(() => respond).toHaveBeenCalled()
    const firstArg = (respond as unknown as { mock: { calls: [unknown][] } }).mock.calls[0]?.[0]
    expect(firstArg).toMatchObject({
      result: { ok: true, value: { outcome: 'allowed-once', approvalId: 'ap1' } },
    })
  })

  it('answers allowed-once on Meta+Enter (macOS)', async () => {
    const respond = vi.fn(() => Promise.resolve({ accepted: true }))
    render(<ApprovalPanel {...panelProps(respond)} />)
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true })
    await expect.poll(() => respond).toHaveBeenCalledTimes(1)
  })

  it('ignores plain Enter, shift combos, and IME composition', () => {
    const respond = vi.fn(() => Promise.resolve({ accepted: true }))
    render(<ApprovalPanel {...panelProps(respond)} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Enter', shiftKey: true, ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(respond).not.toHaveBeenCalled()
  })

  it('yields to editable targets elsewhere in the page', () => {
    const respond = vi.fn(() => Promise.resolve({ accepted: true }))
    render(<ApprovalPanel {...panelProps(respond)} />)
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(respond).not.toHaveBeenCalled()
    textarea.remove()
  })

  it('does not re-answer after a successful confirmation', async () => {
    const respond = vi.fn(() => Promise.resolve({ accepted: true }))
    render(<ApprovalPanel {...panelProps(respond)} />)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await expect.poll(() => respond).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('advertises the shortcut on the action row', () => {
    render(<ApprovalPanel {...panelProps(vi.fn(() => Promise.resolve({ accepted: true })))} />)
    expect(screen.getByText(/Ctrl\+Enter/)).toBeTruthy()
  })
})
