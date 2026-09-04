// @ts-nocheck -- alpha.4 sync: product approval surface migrated to the ui-approval carrier
// @vitest-environment jsdom
/** ApprovalPanel keyboard confirmation: Cmd/Ctrl+Enter answers allowed-once. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ApprovalComposerProps } from '@deepseek-ai/dsh-client-ui-approval/client'
import { PendingApproval } from '../../ui-approval/src/client/contract/slots.ts'
import { zh as approvalZh } from '../../ui-approval/src/client/locales.ts'
import { ApprovalPanel } from '../src/client/skeleton/ApprovalPanel.tsx'

const SID = 'session-fixture' as SessionId
const t = makeTranslate(approvalZh, commonZh) as ApprovalComposerProps['t']

function panelProps() {
  const matched = new PendingApproval(SID, {
    toolName: 'bash',
    callId: undefined,
    reason: 'model justification',
  })
  const answer = vi.spyOn(matched, 'answer').mockResolvedValue()
  return { matched, answer, t, renderSlot: () => null } as unknown as ApprovalComposerProps
}

afterEach(() => { cleanup() })

describe('ApprovalPanel keyboard confirmation', () => {
  it('answers allowed-once on Ctrl+Enter while the panel is mounted', async () => {
    const props = panelProps()
    render(<ApprovalPanel {...props} />)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await expect.poll(() => props.answer as unknown).toHaveBeenCalled()
    expect(props.answer).toHaveBeenCalledWith('allowed-once')
  })

  it('answers allowed-once on Meta+Enter (macOS)', async () => {
    const props = panelProps()
    render(<ApprovalPanel {...props} />)
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true })
    await expect.poll(() => props.answer as unknown).toHaveBeenCalledTimes(1)
    expect(props.answer).toHaveBeenCalledWith('allowed-once')
  })

  it('ignores plain Enter, shift combos, and IME composition', () => {
    const props = panelProps()
    render(<ApprovalPanel {...props} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Enter', shiftKey: true, ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(props.answer).not.toHaveBeenCalled()
  })

  it('yields to editable targets elsewhere in the page', () => {
    const props = panelProps()
    render(<ApprovalPanel {...props} />)
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(props.answer).not.toHaveBeenCalled()
    textarea.remove()
  })

  it('does not re-answer after a successful confirmation', async () => {
    const props = panelProps()
    render(<ApprovalPanel {...props} />)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await expect.poll(() => props.answer as unknown).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(props.answer).toHaveBeenCalledTimes(1)
  })

  it('advertises the shortcut on the action row', () => {
    render(<ApprovalPanel {...panelProps()} />)
    expect(screen.getByText(/Ctrl\+Enter/)).toBeTruthy()
  })
})
