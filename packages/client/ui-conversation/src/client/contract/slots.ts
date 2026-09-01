/** Target-neutral Conversation slot declarations and composed component props. */
import type { ReactNode, RefObject } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  MaybeSnapshotSelectorHook, ObservableSnapshot, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-store'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ComposerBlock } from './composer-blocks.ts'
import type {
  ComposerKeyboard, DraftAttachmentId, EditSelection, InputActions, InputNotice, InputState,
} from './input.ts'
import type { createConversationStore } from '../stores.ts'
import type { ComposerSubmitGesture, InputSubmitMode } from './composer-submission.ts'
import type { ConversationSnapshot } from './snapshot.ts'
import type { ViewTab } from './views.ts'

/** Browser-owned image that has not crossed the durable Host boundary. */
export interface ComposerAttachment {
  kind: 'image'
  id: DraftAttachmentId
  file: File
  previewUrl: string
  /** Intrinsic pixel width, filled asynchronously by the intake header probe. */
  width?: number
  /** Intrinsic pixel height, filled asynchronously by the intake header probe. */
  height?: number
}

/** Input state handed to the optional attachment presentation plugin. */
export interface ComposerAttachmentsOwnerProps {
  /** Browser-owned draft images in input order. */
  attachments: readonly ComposerAttachment[]
  /** Whether a document-level file drop may add images now. */
  canAcceptDrop: boolean
  /** Add one dropped batch through the composer's validation path. */
  onAddImages: (files: readonly File[]) => void
  /** Remove one draft image through the Conversation service. */
  onRemoveImage: (id: DraftAttachmentId) => void
  /** Display-ready limits for the drop invitation. */
  dropLimits?: { readonly count: number; readonly size: string } | undefined
}

/**
 * One image inside a message record: a durable admitted reference, or the
 * local preview of a submission echo whose admission is still in flight.
 */
export type MessageImageSource =
  | { readonly attachment: ImageAttachmentRef }
  | {
    readonly preview: {
      /** Browser-owned preview URL (lifecycle stays with the submitter). */
      readonly url: string
      readonly name?: string
      /** Intrinsic pixel width, when the intake probe has resolved it. */
      readonly width?: number
      /** Intrinsic pixel height, when the intake probe has resolved it. */
      readonly height?: number
    }
  }

/** Durable image loader with an optional synchronous cache read. */
export type MessageImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
}

/** Message image group handed to the optional attachment presentation plugin. */
export interface MessageImagesOwnerProps {
  /** Durable references or submission-echo previews in source order. */
  images: readonly MessageImageSource[]
  /** Session-authorized image URL loader for the durable arm. */
  loadImage: MessageImageLoader
  /** Horizontal placement inside the owning record. */
  align: 'start' | 'end'
}

/** Slot-backed renderer used by Conversation targets without importing an attachment implementation. */
export type RenderMessageImages = (owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => ReactNode

/** Selector hook over the current Session's assembled Conversation. */
export type UseConversation = SnapshotSelectorHook<ConversationSnapshot>
/** Selector hook over the registered Conversation View roster. */
export type UseConversationViews = SnapshotSelectorHook<readonly ViewTab[]>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Strict per-Session Conversation body. */
    'conversation.session': { kind: 'single'; scope: 'session' }
    /** Strict per-Session title, actions, and View navigation. */
    'conversation.session.header': { kind: 'single'; scope: 'session' }
    /** Optional replacement for one Session breadcrumb title. */
    'conversation.session.header.lineage': {
      kind: 'single'
      scope: 'session'
      owner: ConversationHeaderLineageOwnerProps
    }
    /** Title-adjacent Session actions in ascending order. */
    'conversation.session.header.actions': {
      kind: 'list'
      scope: 'session'
      owner: ConversationHeaderActionOwnerProps
    }
    /** Right-aligned Session utilities in ascending order. */
    'conversation.session.header.utilities': {
      kind: 'list'
      scope: 'session'
      owner: ConversationHeaderActionOwnerProps
    }
    /** Registered Conversation target Views, rendered one at a time. */
    'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps }
    /** Selector-routed replacements for the current Session's resident composer. */
    'conversation.composer': { kind: 'chain'; scope: 'session'; owner: ComposerChainProps }
    /** Workspace picker shown by the blank-session Hero. */
    'conversation.hero.workspace': { kind: 'single'; scope: 'root'; owner: EmptyWorkspaceOwnerProps }
    /** Brand mark shown before the blank-session headline. */
    'conversation.hero.brand.mark': { kind: 'single'; scope: 'root'; owner: HeroBrandMarkOwnerProps }
    /** Agent-preset control staged for a New Session. */
    'conversation.hero.agentPreset': { kind: 'single'; scope: 'root'; owner: HeroAgentPresetOwnerProps }
    /** Full-width entries above the composer card. */
    'conversation.input.dock': { kind: 'list'; scope: 'session'; owner: InputZone }
    /**
     * The input selector row's context hole, rendered in every conversation
     * phase (cold start, blank-session hero, active seat) right above the
     * composer card — the seat for session-maybe chips that ride beside the
     * workspace selector (the git branch chip). The
     * owner supplies nothing; data and verbs arrive through each entry's own
     * inject face, and the session id is optional for the same reason as
     * {@link ComposerBarOwnerProps}.
     */
    'conversation.input.selector.context': { kind: 'list'; scope: 'session-maybe' }
    /**
     * The band under the composer card, inside the bar's width column — the
     * seat for an ambient readout about the conversation (the shipped stats
     * line lives here). Same {@link InputZone} owner share as the other
     * regions. Anything the user must click belongs in the tool row instead
     * (`conversation.input.left` / `.right`); anything needing its own line
     * above the card belongs in `conversation.input.dock`.
     */
    'conversation.composer.dock': { kind: 'list'; scope: 'session'; owner: InputZone }
    /**
     * The left end of the tool row INSIDE the composer card, after the
     * resident chrome (access mode, plan, attach) — the seat for a small
     * always-visible control. Entries sit beside that chrome, never replace
     * it. Same {@link InputZone} owner share; use `.right` for a control that
     * belongs next to the send button, and the docks for anything taller than
     * one row.
     */
    'conversation.input.left': { kind: 'list'; scope: 'session'; owner: InputZone }
    /**
     * The right end of the same tool row, before the primary send button —
     * the seat for a control the user reaches on the way to sending (the
     * model select sits in its own named seat just left of here). Same
     * {@link InputZone} owner share and the same one-row height budget as
     * `conversation.input.left`.
     */
    'conversation.input.right': { kind: 'list'; scope: 'session'; owner: InputZone }
    /**
     * The default composer body: a single slot rendered as the composer
     * chain's fallback (a real entry, not a chain rider, so a
     * takeover election hides rather than unmounts it and the textarea DOM
     * survives). Session-maybe: the bar stays mounted across the
     * no-session/session transition — the no-workspace hero renders the SAME
     * textarea DOM as a read-only Workspace-picker trigger instead of a
     * parallel inert tree — with the machine hooks absent until a session is
     * current. InputBar registers
     * here from this package's apply; its machine state arrives through the
     * standard provide channel (useInput + inputActions), the keyboard
     * command face through its own inject.
     */
    /** Floating entries rendered inside the resident composer card. */
    'conversation.input.overlay': { kind: 'list'; scope: 'session' }
    /** Ambient entries below the composer card. */
    'conversation.composer.dock': { kind: 'list'; scope: 'session' }
    /** Compact controls at the left of the composer tool row. */
    'conversation.input.left': { kind: 'list'; scope: 'session' }
    /** Compact controls before the composer submit action. */
    'conversation.input.right': { kind: 'list'; scope: 'session' }
    /** Resident composer body, including the no-Session inert state. */
    'conversation.composer.bar': { kind: 'single'; scope: 'session-maybe'; owner: ComposerBarOwnerProps }
    /** Optional draft-image rail and drop target. */
    'conversation.input.attachments': {
      kind: 'single'
      scope: 'session-maybe'
      owner: ComposerAttachmentsOwnerProps
    }
    /** Plan control inside the composer tool row. */
    'conversation.input.plan': { kind: 'single'; scope: 'session'; owner: InputControlOwnerProps }
    /** Model selector inside the composer tool row. */
    'conversation.input.model': { kind: 'single'; scope: 'session'; owner: InputControlOwnerProps }
  }

  interface GlobalStandardProps {
    /** Workspace selector supplied by the independently loaded Workspace UI. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }

  interface SessionStandardProps {
    /** Selector hook over target-neutral Conversation assembly. */
    useConversation: UseConversation
    /** Selector hook over the Session input machine. */
    useInput: SnapshotSelectorHook<InputState>
    /** Stable public input actions for this Session. */
    inputActions: InputActions
  }

  interface SessionMaybeStandardProps {
    /** Selector hook whose values are absent without a current Session. */
    useConversation: MaybeSnapshotSelectorHook<ConversationSnapshot>
    /** Input values are absent without a current Session. */
    useInput: MaybeSnapshotSelectorHook<InputState>
    /** Input actions are absent without a current Session. */
    inputActions: InputActions | undefined
  }
}

/** Owner share of the Hero agent-preset control. */
export interface HeroAgentPresetOwnerProps {
  /** Marker field: the occupant owns its roster and staged selection. */
  children?: never
}

/** Header actions derive their state from standard Session props. */
export interface ConversationHeaderActionOwnerProps {
  /** Marker field: entries receive no owner-specific values. */
  children?: never
}

/** Plain breadcrumb data handed to the optional lineage renderer. */
export interface ConversationHeaderLineageOwnerProps {
  /** Session represented by this breadcrumb title. */
  lineageSessionId: SessionId
  /** Display title available to a combined title/control renderer. */
  displayTitle: string
  /** Navigate to an ancestor title when present. */
  openTitle?: () => void
}

/** Point-in-time owner values for composer extension entries. */
export interface InputZone {
  readonly session: SessionSnapshot
  readonly input: InputState
}

/** Conversation View entries obtain their data from registered standard hooks. */
export interface ConvViewOwnerProps {
  /** Focus request addressed to the selected View. */
  viewRequest: import('./views.ts').ConversationViewRequest | null
  /** Select a View and address one opaque focus identity to it. */
  openView: (view: string, focus: string) => void
  /** Acknowledge the current one-shot focus request. */
  completeViewRequest: () => void
}

/**
 * Optional prose file-mention provider, consumed via `ctx.get('chatFileMentions')`
 * (optional-service convention): the chat view asks it for a closing message's
 * inline-code vocabulary and threads the result into MarkdownText. Absent
 * service — the providing plugin composed out of cordis.yml — turns the
 * surface off; the prose renders inert code.
 */
export interface ChatFileMentions {
  /**
   * Mention vocabulary for the closing message the owner currency names.
   * @param owner - Turn-tail owner currency (Turn data, closing seq, opener).
   * @returns The resolver MarkdownText consumes, or undefined when the turn
   * produced nothing worth linking.
   */
  forClosing(owner: TurnTailOwnerProps): MarkdownFileMentions | undefined
}


/**
 * Owner currency of the chat view's turn-tail hole: the engine-owned Turn and
 * the closing assistant's anchor. Registrants read their own typed Turn data
 * and open files through the same opener the tool rows use.
 */
export interface TurnTailOwnerProps {
  /** Engine-owned closing Turn boundary. */
  turn: TurnLocation
  /** The closing assistant's seq — the anchor the tail renders under. */
  seq: number
  /**
   * Open a filesystem path through the Host (tool-row semantics; the chat
   * view resolves relative paths against the session cwd).
   */
  openFile: (path: string) => void
}

/**
 * Owner currency of the assistant-message action strip: the durable identity
 * of the one finalized message the contributed actions address. Only finalized
 * messages reach this slot, so the id is always present.
 */
export interface AssistantActionOwnerProps {
  /** Stable identity carried from the `assistant/message` event. */
  messageId: MessageId
}

/** Hook constrained to business data published on the current Chat Node's Turn. */
export type UseChatNodeTurnData = <Key extends Extract<keyof ConversationTurnDataMap, string>>(
  key: Key,
) => Readonly<ConversationTurnDataMap[Key]> | undefined

/** Slot-level Hook factory used by renderers reading their Node's Turn data. */
export interface ChatNodeTurnDataInjected {
  hooks: {
    turnData: SlotHookFactory<'conversation.chat.node', UseChatNodeTurnData>
  }
}

/** Stable owner currency delivered to one keyed Chat business renderer. */
export interface ChatNodeOwnerProps {
  /** Selected Tool call, when the shared details store names one. */
  selectedCallId?: CallId | undefined
  /** Session workspace root; Tool summaries display paths relative to it. */
  cwd?: string | undefined
  openFile: (path: string) => void
  inspectCall: (callId: CallId) => void
  forkAt: (seq: number) => void
  /** Render a historical image group through the attachment slot. */
  renderMessageImages: RenderMessageImages
  /**
   * Delete one user or assistant message from the transcript and the
   * model-visible history; resolves false when the host refused (running
   * agent or an already-shadowed seq).
   */
  deleteAt: (seq: number) => Promise<boolean>
  /**
   * Edit the conversation's last user message and regenerate its turn;
   * resolves false when the host refused.
   */
  editAt?: ((seq: number, text: string) => Promise<boolean>) | undefined
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
}

/** Full props of one registered keyed Chat business renderer. */
export type ChatNodeViewProps<Kind extends ChatNodeKind = ChatNodeKind> =
  PropsRuntime<'conversation.chat.node', Kind> & PropsLocale<'conversation'>

/** Owner currency of the details panel's Tool output renderer. */
export interface DetailsToolOwnerProps {
  /** Frozen selected call slice. */
  block: ToolCallBlock
  /** Session workspace root for card cwd and relative-path display. */
  cwd?: string | undefined
}

/**
 * Owner share of the per-command row slot: the frozen {@link CommandNode}
 * slice off the snapshot (cache-stable reference — memo premise). The node
 * carries the whole lifecycle (structured name/args, pairing id, and
 * outcome-or-executing). A successful domain command may also carry the
 * explicitly linked projection node needed to fold two log records into one
 * presentation row.
 */
export interface CommandRowOwnerProps {
  /** Folded command lifecycle node (run + optional done). */
  node: CommandNode
  /** Explicitly linked compaction checkpoint for the settled `/compact` presentation. */
  compaction?: CompactionSummaryNode
}

/** Full props of a registered command-row component. */
export type CommandRowProps = PropsRuntime<'conversation.chat.commandview'>

/**
 * Base props of a conversation view entry: the framework standard kit for the
 * session-scope 'conversation.view' slot (useSession narrowed to the
 * conversation snapshot by the runtime merge, sessionId, useSessions).
 * Entries declaring the shared store or an inject face compose their shares
 * on top (the chat entry's {@link ChatViewSlotProps}); store-less pure
 * readers (ui-trajectory) take this base alone.
 */
/** Base props of one target-owned Conversation View entry. */
export type ConvViewProps = PropsRuntime<'conversation.view'>

/** Business callbacks injected into the resident Conversation shell. */
export interface ConversationInjected {
  /** Connect and open a blank Session in the selected Workspace. */
  selectWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /** Session-addressed composer block source, or the stable absent source. */
  hooks: { composerBlock: ObservableSnapshot<ComposerBlock | undefined> }
}

/** Business callbacks injected into the strict Session body. */
export interface ConversationSessionInjected {
  /** Package-owned View roster source bound only for the Conversation body. */
  readonly hooks: { readonly conversationViews: ObservableSnapshot<readonly ViewTab[]> }
  /** Bind input draft persistence to the Session-owned store instance. */
  bindDraftMirror: (write: (text: string) => void) => () => void
  /** Select and activate one View while addressing an opaque focus request to it. */
  openView: (view: string, focus: string) => void
}

/** Business callbacks injected into the strict Session header. */
export interface ConversationSessionHeaderInjected {
  /** Package-owned View roster source bound only for the Conversation header. */
  readonly hooks: { readonly conversationViews: ObservableSnapshot<readonly ViewTab[]> }
  /** Select a Session through the Session Controller. */
  open: (sessionId: SessionId) => void
  /** Select and activate one registered Conversation View. */
  selectView: (view: string) => void
}

/** Owner share of the resident composer bar. */
export interface ComposerBarOwnerProps {
  /** Hero uses centered placement; composer uses the active bottom placement. */
  variant: 'hero' | 'composer'
  /** A feature-owned reason that makes message input inert while leaving model selection live. */
  blocked?: { readonly reason: string }
  /** Lock all message actions while preserving the resident composer surface. */
  disabled?: boolean
  /** Whether the shared Workspace picker is expanded. */
  workspacePickerOpen?: boolean
  /** Open the Workspace picker from the inert composer surface. */
  onRequestWorkspace?: () => void
  placeholder?: string
  /** Optional content rendered above the composer surface. */
  accessory?: ReactNode
}

/** Package-private operations injected into the resident composer bar. */
export interface ComposerBarInjected {
  keyboard: ComposerKeyboard | undefined
  addImages: ((files: readonly File[]) => string | null) | undefined
  removeImage: ((id: DraftAttachmentId) => void) | undefined
  draftImages: ((ids: readonly DraftAttachmentId[]) => readonly ComposerAttachment[]) | undefined
  /** Open the host's native multi-file picker; resolved absolute paths are empty when the operator cancels. */
  pickFiles: (() => Promise<{ cancelled: boolean; paths: string[] }>) | undefined
  /** Resolve dragged file basenames to absolute paths inside this session's workspace (empty when no match). */
  locateFiles: ((names: string[]) => Promise<Array<{ name: string; paths: string[] }>>) | undefined
  /** Resolve one keyboard submission gesture against the current running state and persisted preference. */
  resolveSubmitMode: (
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ) => InputSubmitMode
  toggleCommandMenu: ((selection: EditSelection) => void) | undefined
  stop: (() => void) | undefined
  command: ((line: string) => Promise<boolean>) | undefined
  hooks: {
    notices: ObservableSnapshot<InputNotice | null>
    lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>>
    menuLauncher: ObservableSnapshot<string | null>
  }
}

/** Owner share of the named plan and model controls. */
export interface InputControlOwnerProps {
  /** Whether the composer currently refuses interaction. */
  locked: boolean
}

/** Full props of the resident composer bar. */
export type ComposerBarProps =
  PropsRuntime<'conversation.composer.bar'>
  & PropsRenderSlots<
    | 'conversation.input.attachments' | 'conversation.input.overlay'
    | 'conversation.input.left' | 'conversation.input.plan'
    | 'conversation.input.right' | 'conversation.input.model'
    | 'conversation.composer.dock'
  >
  & InjectFace<ComposerBarInjected>
  & PropsLocale<'conversation'>

/** Owner values used to elect a composer takeover. */
export interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}

/** Presentation props supplied to the blank-session brand mark. */
export interface HeroBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
}

/** Full props of the resident optional-Session Conversation shell. */
export type ConversationSlotProps =
  PropsRuntime<'conversation'>
  & PropsRenderSlots<
    | 'conversation.session' | 'conversation.session.header'
    | 'conversation.composer' | 'conversation.composer.bar'
    | 'conversation.input.dock'
    | 'conversation.hero.brand.mark'
    | 'conversation.input.selector.context'
    | 'conversation.hero.workspace'
    | 'conversation.hero.agentPreset'
  >
  & InjectFace<ConversationInjected>
  & PropsLocale<'conversation'>

/** Shared target-neutral Conversation store handle. */
export type ConversationStore = ReturnType<typeof createConversationStore>

/** Full props of the strict Session body. */
export type ConversationSessionSlotProps =
  PropsRuntime<'conversation.session'>
  & PropsRenderSlots<'conversation.view'>
  & PropsStore<ConversationStore>
  & InjectFace<ConversationSessionInjected>

/** Full props of the strict Session header. */
export type ConversationSessionHeaderSlotProps =
  PropsRuntime<'conversation.session.header'>
  & PropsRenderSlots<
    'conversation.session.header.lineage'
    | 'conversation.session.header.actions'
    | 'conversation.session.header.utilities'
  >
  & PropsStore<ConversationStore>
  & InjectFace<ConversationSessionHeaderInjected>
  & PropsLocale<'conversation'>

/** The pending approval carrier the owner dispatches into the composer chain. */
export type ApprovalWait = PendingWait<'approval'>

/**
 * Approval domain face over the carrier (the ui-user-questions PendingQuestion
 * pattern): render identity and question material forwarded transparently;
 * answer owns the wire encoding — the ApprovalResponsePayload value shape
 * with the audit correlation the host reconciles — and turns a rejected
 * carrier receipt into a thrown error. Minted per carrier via useMemo.
 */
export class PendingApproval {
  /**
   * @param wait - the runtime carrier for one pending approval question.
   */
  constructor(private readonly wait: ApprovalWait) {}

  /** Opaque render identity (React key / one-shot latch remount axis), forwarded from the carrier. */
  get key(): string {
    return this.wait.key
  }

  /** The tool the question is about (headline fallback), forwarded from the carrier payload. */
  get toolName(): string {
    return this.wait.payload.toolName
  }

  /** The asker's human-readable WHY (headline when present), forwarded from the carrier payload. */
  get reason(): string | undefined {
    return this.wait.payload.reason
  }

  /** The paired tool call's id when the ask names one (command-line lookup key), forwarded from the carrier payload. */
  get callId(): string | undefined {
    return this.wait.payload.callId
  }

  /**
   * Deliver the user's decision; a rejected carrier receipt throws. Panel
   * removal stays frame-driven: the broadcast `approval/resolved` settles the
   * wait and drops it from the pending list.
   * @param outcome - the only two client-answerable outcomes.
   */
  async answer(outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const receipt = await this.wait.respond({
      ok: true,
      value: { sessionId: this.wait.sessionId, approvalId: this.wait.payload.approvalId, outcome },
    })
    if (!receipt.accepted) {
      throw new Error(`approval response rejected: ${receipt.reason}`)
    }
  }
}

/**
 * Full approval-composer props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the approval carrier — plus the
 * standard locale seat. No injected share: the carrier plus the domain face
 * above carry the whole behavior surface; the paired command line derives
 * from useSession in-component.
 */
export type ApprovalComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: ApprovalWait } & PropsLocale<'conversation'>

/** In-memory reader position resilient to transcript width reflow. */
export interface ChatScrollPosition {
  /** Stable rendered node/call identity nearest the visible reading edge. */
  readonly anchorKey: string
  /** Anchor top relative to the transcript scrollport when saved. */
  readonly anchorTop: number
  /** Approximate offset used before the semantic anchor is measured. */
  readonly scrollTop: number
}

/**
 * Injected share of the chat view entry: the two callbacks whose targets live
 * outside the view (layout orchestration; the session object layer).
 */
export interface ChatViewInjected {
  /** Selection write + details panel opening in one gesture (store action + layout orchestration). */
  openDetails: (target: SelectionTarget) => void
  /**
   * Open a tool-arg filesystem path with the host OS default application
   * (relative paths resolve against the session cwd). Always returns a
   * promise: fulfills when the Host opens the path, rejects when it cannot
   * hand the path off (the chat view shows that reason and a retry).
   */
  openFile: (path: string) => Promise<void>
  loadOlder: () => void
  /** Resolve a session-authorized historical image for inline display. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Hand a call off to the trajectory view: write the one-shot inspect target and switch tabs. */
  inspectCall: (callId: CallId) => void
  /**
   * Per-session scroll memory surviving view switches (in-memory, never
   * persisted): the view saves on every scroll and restores on remount; a
   * fresh page load starts empty and keeps the open-jump-to-bottom default.
   */
  chatScroll: {
    /** Record a semantic reader position; null clears it when pinned. */
    save: (position: ChatScrollPosition | null) => void
    /** Last reader position, or null when pinned or never recorded. */
    read: () => ChatScrollPosition | null
  }
  /** Fork through the completed turn ending at the eligible message `seq`, then open the child. */
  forkAt: (seq: number) => void
  /** Delete the message at `seq` (or the whole turn when `seq` anchors its turn/end); resolves false when the host refused. */
  deleteAt: (seq: number) => Promise<boolean>
  /** Edit the last user message at `seq` with `text` and regenerate; resolves false on refusal. */
  editAt: (seq: number, text: string) => Promise<boolean>
  /**
   * Prose file-mention vocabulary for one closing message, from the optional
   * {@link ChatFileMentions} service (resolved lazily per call, so composing
   * the provider in or out takes effect live). Undefined when the service is
   * absent or the turn produced nothing worth linking.
   */
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
}

/** Full chat-view component props: runtime & its Tool/command/tail render shares & store & injected & locale seat. */
export type ChatViewSlotProps =
  PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'conversation.chat.node' | 'conversation.message.images'>
  & PropsStore<ChatStore> & ChatViewInjected & PropsLocale<'conversation'>

/** Full props of the attachment plugin's composer entry. */
/** Full props of the draft-image attachment renderer. */
export type ComposerAttachmentsProps =
  PropsRuntime<'conversation.input.attachments'> & PropsLocale<'conversation'>

/** Owner share common to blank-session Workspace pickers. */
export interface EmptyWorkspaceOwnerProps {
  open: boolean
  anchorRef?: RefObject<HTMLElement>
  /** Currently selected Workspace, when available. */
  selectedId?: WorkspaceId | undefined
  onPick: (workspaceId: WorkspaceId) => void
  onClose: () => void
}
