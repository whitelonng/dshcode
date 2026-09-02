// @ts-nocheck -- alpha.4 sync: product approval keyboard surface migrated to the ui-approval carrier
// ApprovalPanel: the composer-takeover approval prompt, registered as a
// selector-routed entry of the conversation-declared composer chain. While an
// approval question is pending, this panel occupies the composer slot in place
// of the InputBar: an amber "Waiting for approval" strip on the card top, the
// model's justification as the headline, the paired command in muted code
// text, and a right-aligned refuse/allow action row. Justification and command
// are unbounded model text, so they scroll inside the card at the shared
// composer cap (`data-approval-scroll`) and the action row stays outside it —
// the buttons must be reachable no matter how long the command is. One-shot:
// the buttons disable after a click and the panel leaves (the InputBar
// returns) on the broadcast resolved frame.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ApprovalPanel.module.css'

/**
 * Structural face of the ui-approval carrier this panel renders. Declared
 * locally: ui-approval imports this package's composer-chain types, so a
 * real import here would close a project-reference cycle.
 */
interface ApprovalCarrier {
  /** Opaque render identity and one-shot remount axis. */
  readonly key: string
  /** Tool requesting the decision. */
  readonly toolName: string
  /** Correlated Tool call, when supplied by the asker. */
  readonly callId: string | undefined
  /** Human-readable reason supplied by the asker. */
  readonly reason: string | undefined
  /** Resolve the Host waterfall with the user's decision. */
  answer(outcome: 'allowed-once' | 'rejected'): Promise<void>
}

/** Props this panel consumes off the ui-approval composer entry. */
interface ApprovalPanelProps {
  /** Selector-matched pending approval carrier. */
  matched: ApprovalCarrier
  /** Localized copy from the approval namespace. */
  t: (key: string, params?: Record<string, unknown>) => string
  /** Render the correlated Tool call's keyed detail, when registered. */
  renderSlot(name: 'conversation.approval.detail', owner: { callId: string }): ReactNode
}

/**
 * Composer takeover boundary: mints the domain face on the carrier's stable
 * identity and remounts the flow per request key, so the one-shot answered
 * latch never leaks to the next pending approval.
 * @param props - the selector-matched pending approval carrier plus the framework standard kit.
 * @returns The approval prompt for this request.
 */
export function ApprovalPanel(props: ApprovalPanelProps) {
  const approval = props.matched
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  return <ApprovalFlow key={approval.key} pending={approval} detail={detail} t={props.t} />
}

function ApprovalFlow({ pending, detail, t }: {
  pending: ApprovalCarrier
  detail: ReactNode
  t: ApprovalPanelProps['t']
}) {
  // Local one-shot latch: the panel leaves only when the resolved frame
  // lands; until then the buttons must not re-fire. An answer failure
  // (rejected receipt / transport) re-arms them for retry.
  const [answered, setAnswered] = useState(false)
  const answeredRef = useRef(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    answeredRef.current = true
    setAnswered(true)
    void pending.answer(outcome).catch(() => {
      answeredRef.current = false
      setAnswered(false)
    })
  }
  // Cmd/Ctrl+Enter confirms the pending approval (allowed-once, same as the
  // primary button). The panel occupies the composer while pending, so the
  // gesture cannot collide with the chat input; it still yields to editable
  // targets and IME composition elsewhere in the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (answeredRef.current) return
      if (event.isComposing || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      const target = event.target as HTMLElement | null
      if (target !== null && (
        target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'
        || target.isContentEditable
      )) return
      event.preventDefault()
      answer('allowed-once')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [pending])
  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('waiting')}</div>
        {/* Tab stop: the region scrolls once the command passes the cap and
            holds nothing focusable of its own, so without one a keyboard-only
            user cannot reach the command's tail before answering. */}
        <div className={css.body} data-approval-scroll="" tabIndex={0} role="group" aria-label={t('detail.aria')}>
          <div className={css.headline}>{pending.reason ?? t('escalation', { toolName: pending.toolName })}</div>
          {detail !== null && <div className={css.command}>{detail}</div>}
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={answered} onClick={() => { answer('rejected') }}>
            {t('reject')}
          </Button>
          <Button variant="primary" disabled={answered} onClick={() => { answer('allowed-once') }}>
            {t('allowOnce')}
          </Button>
          <span className={css.shortcutHint} aria-hidden>{t('confirmShortcut')}</span>
        </div>
      </div>
    </div>
  )
}
