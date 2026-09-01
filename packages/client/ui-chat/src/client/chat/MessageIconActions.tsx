// Shared IconActions chrome for user and assistant messages: copy
// live, optional branch wiring, and an optional date-aware clock.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutline16, IconCheckOutline16, IconCopyOutline16, IconEditOutline16, IconTrashOutline16, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /**
   * Delete this message from the transcript; resolves false when the host
   * refused. Omission hides the delete action.
   */
  onDelete?: (() => Promise<boolean>) | undefined
  /** The message's turn is still running, so delete stays visible but unavailable. */
  deleteUnavailable?: boolean | undefined
  /** Open the inline editor for this message; omission hides the edit action. */
  onEdit?: (() => void) | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * branch control at the end of the icon cluster.
   */
  usageAction?: ReactNode
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, className,
  onDelete, deleteUnavailable = false, onEdit, extraActions, t,
  text, time, clock, onBranch, branchUnavailable = false, className,
  extraActions, usageAction, t,
}: MessageIconActionsProps) {
  const day = useCalendarDay()
  const reasonId = useId()
  const deleteReasonId = useId()
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const [deletePending, setDeletePending] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const onDeleteClick = useCallback(() => {
    if (onDelete === undefined || deletePending || deleteUnavailable) return
    setDeletePending(true)
    setDeleteFailed(false)
    void onDelete().then((ok) => {
      setDeletePending(false)
      if (!ok) setDeleteFailed(true)
    })
  }, [onDelete, deletePending, deleteUnavailable])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
      {extraActions}
      {onDelete !== undefined && (
        <Tooltip
          label={deleteFailed ? t('message.deleteFailed') : deleteUnavailable ? t('message.deleteUnavailable') : t('message.delete')}
          side="bottom"
        >
          <button
            type="button"
            className={css.action}
            aria-label={t('message.delete')}
            aria-disabled={deleteUnavailable || deletePending || undefined}
            aria-describedby={deleteUnavailable ? deleteReasonId : undefined}
            data-unavailable={deleteUnavailable || undefined}
            onClick={onDeleteClick}
          >
            <IconTrashOutline16 />
          </button>
        </Tooltip>
      )}
      {onDelete !== undefined && deleteUnavailable && (
        <span id={deleteReasonId} className={css.visuallyHidden}>{t('message.deleteUnavailable')}</span>
      )}
      {onEdit !== undefined && (
        <Tooltip label={t('message.edit')} side="bottom">
          <button type="button" className={css.action} aria-label={t('message.edit')} onClick={onEdit}>
            <IconEditOutline16 />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.branch')}
            aria-disabled={branchUnavailable || undefined}
            aria-describedby={branchUnavailable ? reasonId : undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutline16 />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>{t('message.branchUnavailable')}</span>
      )}
      {usageAction}
      {clock === 'end' ? clockEl : null}
    </div>
  )
}
