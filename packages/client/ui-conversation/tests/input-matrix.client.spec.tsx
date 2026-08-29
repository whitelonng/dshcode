// @vitest-environment jsdom
/**
 * Impact-matrix projection tests (row by row): what each
 * phase projects onto the InputBar — enter routing, visuals (token color /
 * hint / pending), edit freedom, and the published currency's claim seat.
 * React over jsdom per the client testing discipline; the machine is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubmitImageAttachment, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DraftAttachmentId } from '../src/client/input/contract.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SCTX = {} as ClientContext
const SID = 's1' as SessionId

/** Standard-props InputBar mount over a real shell (the composer-bar entry shape). */
function mountBar(shell: SessionInputShell, over?: { running?: boolean; disabled?: boolean }) {
  const session = createSnapshotStore<ConversationSnapshot>({
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: over?.running ?? false, composerPhase: 'active',
    removed: over?.disabled ?? false, openState: 'open', openError: null, hasMore: false,
    loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  })
  const props: InputBarProps = {
    sessionId: SID,
    SessionProvider: ({ children }) => children(SID),
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(createSnapshotStore({
      ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })),
    useProjection: (() => undefined),
    useInput: bindSnapshotSelector(shell.state),
    inputActions: shell.actions,
    keyboard: shell,
    addImages: () => null,
    removeImage: () => {},
    // Every id resolves so the bar's registry prune never drops a test image.
    draftImages: ids => ids.map(id => ({
      kind: 'image' as const, id,
      file: new File([Uint8Array.of(1)], `${id}.png`, { type: 'image/png' }),
      previewUrl: `blob:${id}`,
    })),
    resolveSubmitMode: () => 'queue',
    toggleCommandMenu: vi.fn(),
    useNotices: bindSnapshotSelector(shell.notices),
    useLexicon: bindSnapshotSelector(shell.lexicon),
    useMenuLauncher: bindSnapshotSelector(createSnapshotStore<string | null>(null)),
    renderSlot: (() => null) as InputBarProps['renderSlot'],
    stop: vi.fn(),
    command: () => Promise.resolve(true),
    // Mirrors the real lookup chain (conversation namespace, then common).
    t: makeTranslate(zh, commonZh),
    variant: 'composer',
  }
  return render(<InputBar {...props} />)
}

function bench(over?: {
  running?: boolean
  disabled?: boolean
  submit?: (args: string) => Promise<SubmitOutcome>
  serialize?: (ids: readonly DraftAttachmentId[]) => Promise<readonly SubmitImageAttachment[]>
}) {
  const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
  const serialize = vi.fn(over?.serialize ?? (() => Promise.resolve<readonly SubmitImageAttachment[]>([])))
  const release = vi.fn()
  const shell = new SessionInputShell({ actx: SCTX, defaultSink: sink, commandImages: { serialize, release, unsupportedNotice: (token: string) => `${token.trim()} images-unsupported` } })
  const wiring = shell
  const view = mountBar(shell, over)
  const textarea = view.container.querySelector('textarea')!
  const claim = (token = '/goal ', hint = '目标', images?: true) => {
    act(() => {
      shell.setDraft(token)
      shell.beginCommand(
        {
          token, hint,
          ...(images === true ? { images: true } : {}),
          submit: over?.submit ?? (() => Promise.resolve({ kind: 'success' as const, source: 'command', name: 'goal' })),
        },
        { start: 0, end: token.length, draftRev: shell.snapshot.draftRev },
      )
    })
  }
  return { view, textarea, shell, wiring, sink, claim, serialize, release }
}

describe('matrix row: plain', () => {
  it('enter falls to the default sink; no claim on the currency; edits free', async () => {
    const { textarea, shell, sink } = bench()
    fireEvent.change(textarea, { target: { value: '普通消息' } })
    expect(shell.snapshot.claim).toBeUndefined()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('普通消息', [], 'queue', expect.any(AbortSignal))
    expect(shell.snapshot.phase).toBe('submitting')
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(shell.snapshot.claim).toBeUndefined()
  })
})

describe('matrix row: claimed', () => {
  it('publishes the claim currency, colors the token, hints while args are blank, and edits stay free', () => {
    const { view, textarea, shell, claim } = bench()
    claim()
    expect(shell.snapshot.claim).toEqual({ token: '/goal ', hint: '目标' })
    expect(view.container.querySelector('[data-decoration="token"]')?.textContent).toBe('/goal ')
    // The zh dictionary owns a hint.goal entry, which overrides the raw claim hint (production behavior).
    expect(view.container.querySelector('[data-decoration="hint"]')?.textContent).toBe('输入目标，智能体将持续执行')
    expect((textarea).readOnly).toBe(false)
    // Free editing beyond the token: hint drops, claim holds.
    fireEvent.change(textarea, { target: { value: '/goal 发布版本' } })
    expect(shell.snapshot.phase).toBe('claimed')
    expect(view.container.querySelector('[data-decoration="hint"]')).toBeNull()
  })

  it('enter routes to claim.submit (command lane, never the queue sink)', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'success' as const, text: '完成', source: 'command', name: 'goal' }))
    const { view, textarea, sink, claim } = bench({ submit })
    claim()
    fireEvent.change(textarea, { target: { value: '/goal 发布' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(submit).toHaveBeenCalledWith('发布', SCTX, []) })
    // Commit: draft cleared, notice surfaced, back to plain.
    await vi.waitFor(() => { expect((textarea).value).toBe('') })
    expect(view.getByText('完成')).toBeTruthy()
  })

  it('backspacing the token auto-releases to plain and the visuals vanish (scenario H)', () => {
    const { view, textarea, shell, claim } = bench()
    claim()
    fireEvent.change(textarea, { target: { value: '/goa 发布' } }) // token broken
    expect(shell.snapshot.phase).toBe('plain')
    expect(shell.snapshot.claim).toBeUndefined()
    expect(view.container.querySelector('[data-decoration="token"]')).toBeNull()
  })
})

describe('matrix row: claimed with images', () => {
  const img = 'img-1' as DraftAttachmentId

  it('a claim without image acceptance blocks enter: one notice, draft/images/claim retained', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    const { view, textarea, shell, sink, claim } = bench({ submit })
    claim()
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await Promise.resolve()
    expect(shell.snapshot.phase).toBe('claimed')
    expect(submit).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
    expect(view.getByText('/goal images-unsupported')).toBeTruthy()
    expect(shell.snapshot.imageIds).toEqual([img])
    expect((textarea).value).toBe('/goal ')
  })

  it('an accepting claim serializes and forwards the images; success consumes and clears', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    const png: SubmitImageAttachment = { mediaType: 'image/png', data: 'AA==' }
    const { textarea, shell, claim, serialize, release } = bench({ submit, serialize: () => Promise.resolve([png]) })
    claim('/goal ', '目标', true)
    // The claim currency carries the acceptance flag the pre-gate reads.
    expect(shell.snapshot.claim).toEqual({ token: '/goal ', hint: '目标', images: true })
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(submit).toHaveBeenCalledWith('', SCTX, [png]) })
    expect(serialize).toHaveBeenCalledWith([img])
    await vi.waitFor(() => { expect((textarea).value).toBe('') })
    expect(release).toHaveBeenCalledWith([img])
    expect(shell.snapshot.imageIds).toEqual([])
    expect(shell.snapshot.phase).toBe('plain')
  })

  it('a handler error outcome keeps the images unreleased beside the notice and the draft', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'error' as const, text: '处理失败' }))
    const { view, textarea, shell, claim, release } = bench({ submit })
    claim('/goal ', '目标', true)
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(view.getByText('处理失败')).toBeTruthy() })
    expect(shell.snapshot.phase).toBe('claimed')
    expect(shell.snapshot.imageIds).toEqual([img])
    expect(release).not.toHaveBeenCalled()
    expect((textarea).value).toBe('/goal ')
  })

  it('a serialize rejection blocks the transaction: notice, no submit call, images kept', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    const { view, textarea, shell, claim, release } = bench({ submit, serialize: () => Promise.reject(new Error('附件已失效')) })
    claim('/goal ', '目标', true)
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(view.getByText('附件已失效')).toBeTruthy() })
    expect(submit).not.toHaveBeenCalled()
    expect(shell.snapshot.imageIds).toEqual([img])
    expect(release).not.toHaveBeenCalled()
    expect(shell.snapshot.phase).toBe('claimed')
  })

  it('a disposed shell never lets a pending serialization reach claim.submit', async () => {
    const submit = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    let resolveSerialize!: (images: readonly SubmitImageAttachment[]) => void
    const { shell, textarea, claim } = bench({
      submit,
      serialize: () => new Promise((resolve) => { resolveSerialize = resolve }),
    })
    claim('/goal ', '目标', true)
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(resolveSerialize).toBeDefined() })
    shell.dispose()
    resolveSerialize([{ mediaType: 'image/png', data: 'AA==' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(submit).not.toHaveBeenCalled()
  })

  it('image removal is refused while a command submit is in flight', async () => {
    const submit = vi.fn(() => new Promise<SubmitOutcome>(() => {})) // never settles
    const { shell, textarea, claim } = bench({ submit, serialize: () => Promise.resolve([]) })
    claim('/goal ', '目标', true)
    act(() => { shell.addImages([img]) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(shell.snapshot.phase).toBe('submitting')
    act(() => { shell.removeImage(img) })
    expect(shell.snapshot.imageIds).toEqual([img])
  })
})

describe('matrix row: submitting', () => {
  it('locks enter, renders pending + read-only, keeps the claim snapshot on the currency', async () => {
    const submit = vi.fn(() => new Promise<SubmitOutcome>(() => {})) // never settles
    const { textarea, shell, sink, claim } = bench({ submit })
    claim()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(shell.snapshot.phase).toBe('submitting')
    expect(shell.snapshot.claim).toBeDefined()
    expect((textarea).readOnly).toBe(true)
    // Enter is dead inside the lock (submit dispatch is microtask-deferred).
    await vi.waitFor(() => { expect(submit).toHaveBeenCalledTimes(1) })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(sink).not.toHaveBeenCalled()
  })

  it('rollback with unchanged draft returns to claimed with the notice; drifted draft only notices', async () => {
    let rejectSubmit!: (e: Error) => void
    const submit = vi.fn(() => new Promise<SubmitOutcome>((_res, rej) => { rejectSubmit = rej }))
    const first = bench({ submit })
    first.claim()
    fireEvent.keyDown(first.textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(submit).toHaveBeenCalled() })
    act(() => { rejectSubmit(new Error('执行失败')) })
    await vi.waitFor(() => { expect(first.shell.snapshot.phase).toBe('claimed') })
    expect((first.textarea).value).toBe('/goal ')
    expect(first.view.getByText('执行失败')).toBeTruthy()
    cleanup()
    // Drift: typing during flight wins; no restore, plain, notice only.
    const submit2 = vi.fn(() => new Promise<SubmitOutcome>((_res, rej) => { rejectSubmit = rej }))
    const second = bench({ submit: submit2 })
    second.claim()
    fireEvent.keyDown(second.textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(submit2).toHaveBeenCalled() })
    act(() => { second.shell.setDraft('用户飞行中打的新稿') })
    act(() => { rejectSubmit(new Error('晚到失败')) })
    await vi.waitFor(() => { expect(second.shell.snapshot.phase).toBe('plain') })
    expect((second.textarea).value).toBe('用户飞行中打的新稿')
    expect(second.view.getByText('晚到失败')).toBeTruthy()
  })
})

describe('matrix row: locked (session disabled)', () => {
  it('disables the textarea and chrome; the machine currency is untouched', () => {
    const { view, textarea, shell } = bench({ disabled: true })
    expect((textarea).disabled).toBe(true)
    expect((view.getByLabelText('命令') as HTMLButtonElement).disabled).toBe(true)
    expect(shell.snapshot.phase).toBe('plain')
  })

  it('running does NOT lock: typing and enter-queue stay live', () => {
    const { textarea, sink } = bench({ running: true })
    expect((textarea).disabled).toBe(false)
    fireEvent.change(textarea, { target: { value: '排队' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('排队', [], 'queue', expect.any(AbortSignal))
  })
})

describe('matrix row: takeover (orthogonal axis)', () => {
  it('the machine state survives outside the render tree (claim lives on the shell, not the DOM)', () => {
    const { view, shell, claim } = bench()
    claim()
    // Takeover hides the composer (overlay chain keeps it mounted-but-hidden);
    // even a full unmount keeps the claim: state lives on the resident shell.
    view.unmount()
    expect(shell.snapshot.phase).toBe('claimed')
    expect(shell.snapshot.claim?.token).toBe('/goal ')
    expect(shell.snapshot.draft).toBe('/goal ')
  })
})
