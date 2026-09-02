// @ts-nocheck -- alpha.4 sync: product chat extension awaiting deep migration
import { memo } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, renderSlot, renderSlotChain, t, useChat,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useChat(snapshot =>
    snapshot.locations.getTurn(data.turn).at(-1) !== node.key)
  const isLatestTurn = useChat(snapshot => snapshot.timeline.turnOrder.at(-1) === data.turn)
  const anyOpenTurn = useChat(snapshot =>
    [...snapshot.timeline.turns.values()].some(turn => turn.status === 'open'))
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) return tail === null ? null : <div className={css.root}>{tail}</div>
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  // A synthetic closing node (interrupted partial) cannot address a durable
  // message; deleting it anchors the whole turn through its turn/end seq and
  // the host folds the entire interrupted turn off the surface.
  const deleteTarget = messageId === undefined ? data.seq : closing.finalNode.seq
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-actions-reveal={isLatestTurn ? 'always' : 'hover'}
    >
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        onDelete={() => deleteAt(deleteTarget)}
        deleteUnavailable={anyOpenTurn}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={(
          <>
            {data.tokenUsage !== undefined && <TurnUsagePanel usage={data.tokenUsage} t={t} />}
            {runMs !== undefined && (
              <TurnTimePanel
                runMs={runMs}
                tokensPerSecond={data.tokensPerSecond}
                ttftMs={data.ttftMs}
                t={t}
              />
            )}
          </>
        )}
        t={t}
      />
    </div>
  )
})
