// @vitest-environment jsdom
/** Section, setup-card, and hand-written editor behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  CredentialInfo, RemoteResult, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  ModelsSection, needsSetup, providerCopy, providerTargetLabel, removeProviderProfile,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import {
  DeepSeekModelsEditor, formatCapacity, modelDrafts, parseCapacity, validateDeepSeekModels,
  type DeepSeekModelDraft,
} from '../src/client/DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { ModelListEditor, type ModelDraft } from '../src/client/ModelListEditor.tsx'
import type { ModelDiscoveryOutcome, ModelsOperations } from '../src/client/operations.ts'
import { ReasoningLevelCheckboxes } from '../src/client/ReasoningLevelCheckboxes.tsx'
import { INVALID_EFFORTS, THINKING_LEVELS, type ReasoningEffortsValue, type ReasoningLevel } from '../src/client/reasoning-efforts.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)
const DEEPSEEK_TARGET = { provider: 'deepseek-official', displayName: 'DeepSeek' }
const deepSeekCopy = (template: string): string => providerCopy(template, DEEPSEEK_TARGET)

/** Open one row's capacity disclosure (1-based, as the labels read). */
function expandRow(position: number): void {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${String(position)}`))
}

/** The capacity inputs of every open row, in row order. */
function capacityInputs(label: string): HTMLInputElement[] {
  return screen.getAllByLabelText<HTMLInputElement>(new RegExp(label))
}

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    headers: Schema.dict(Schema.string()),
  })),
})

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  // The adapter declares its catalog as a schema default rather than a
  // composition entry, which is what the restore-defaults path has to read.
  })).default([
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      description: '',
      contextWindow: 1_000_000,
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      description: '',
      contextWindow: 1_000_000,
    },
  ]),
})

const DEFAULT_DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    description: 'Preserved hidden detail',
    contextWindow: 1_000_000,
  },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
]

function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: {
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseURL: 'https://base',
        defaultContextWindow: 1_000_000,
        maxTokens: 256_000,
        models: DEFAULT_DEEPSEEK_MODELS,
      },
      base: { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: DEFAULT_DEEPSEEK_MODELS },
      user: { baseURL: 'https://base' },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(Schema.object({
        profiles: Schema.dict(Schema.object({ note: Schema.string() })),
      }).toJSON())) as JsonValue,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
      value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'subagent-model-selection',
      schema: JSON.parse(JSON.stringify(Schema.object({ enabled: Schema.boolean().default(false) }).toJSON())) as JsonValue,
      value: { enabled: false },
      applies: 'live',
      secrets: [],
      revision: 4,
    },
  ]
}

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
/** The codes this page's scripted Host answers refuse with. */
type RefusalCode = 'credential/rejected' | 'gateway/internal' | 'settings/conflict' | 'settings/rejected'

/** One refusal per code, each carrying the details its own code declares. */
const REFUSALS: { [Code in RefusalCode]: (message: string) => RemoteError<Code> } = {
  'credential/rejected': message => new RemoteError('credential/rejected', message, { ref: 'DEEPSEEK_API_KEY' }),
  'gateway/internal': message => new RemoteError('gateway/internal', message, {}),
  'settings/conflict': message =>
    new RemoteError('settings/conflict', message, { ns: 'llm-pi-ai', expected: 4, actual: 5 }),
  'settings/rejected': message => new RemoteError('settings/rejected', message, { ns: 'llm-pi-ai' }),
}
function remoteFail(message: string, code: RefusalCode = 'credential/rejected') {
  return { ok: false as const, error: REFUSALS[code](message) }
}

function scriptedFace(overrides: {
  update?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
} = {}) {
  const providerNamespace = wireNamespaces().find(view => view.ns === 'llm-pi-ai')!
  const update = overrides.update ?? vi.fn(() => Promise.resolve(remoteOk(providerNamespace)))
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(remoteOk(providerNamespace)))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(remoteOk(undefined)))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(remoteOk(undefined)))
  const face = {
    llm: {
      listProviders: vi.fn(() => Promise.resolve(remoteOk([
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'openai', name: 'openai' },
      ]))),
      listConfigurableProviders: vi.fn(() => Promise.resolve(remoteOk([
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
        { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
        { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
        { provider: 'zombie', displayName: 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
        { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['nope', 'x'], active: false },
        { provider: 'plain', displayName: 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
      ].map(({ active: _active, ...entry }) => entry)))),
      discoverModels: vi.fn(() => Promise.resolve(remoteOk([]))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(remoteOk({ writable: true, hasDocument: false, namespaces: wireNamespaces() }))),
      update,
      mutate,
    },
    credentials: {
      // Typed as the Remote answer rather than the success branch alone: a
      // case that scripts a refusal replaces this mock.
      describe: vi.fn((refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>> =>
        Promise.resolve(remoteOk(
          Object.fromEntries(refs.map(ref => [ref, {
            configured: ref === 'OPENAI_API_KEY',
            ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
            writable: true,
          }])),
        ))),
      set,
      unset,
    },
  }
  return { face, update, mutate, set, unset }
}

type PageContext = ConstructorParameters<typeof ModelsSettingsStore>[0]

/**
 * The page plugin's context, scripted down to the namespaces the page reaches.
 * One context per face, as in production: an editor effect keyed by the context
 * would otherwise re-probe on every render.
 */
const contexts = new WeakMap<object, PageContext>()
function ctxWith(face: object): PageContext {
  const existing = contexts.get(face)
  if (existing !== undefined) return existing
  const ctx = { remote: face } as unknown as PageContext
  contexts.set(face, ctx)
  return ctx
}

/**
 * The cards' injected Host operations over the same script, bound once per face
 * as the plugin body binds them: an editor effect keyed by this face would
 * otherwise re-probe on every render.
 */
const operations = new WeakMap<object, ModelsOperations>()
function operationsWith(face: object): ModelsOperations {
  const existing = operations.get(face)
  if (existing !== undefined) return existing
  const bound = createModelsOperations(ctxWith(face))
  operations.set(face, bound)
  return bound
}

/** One recorded child-slot dispatch: seat name, owner share, kind options. */
type RenderSlotCall = [name: string, owner: Record<string, unknown>, opts?: { entryKey?: string }]

/** Child-slot dispatch stub: records every seat occurrence, renders nothing. */
function stubRenderSlot() {
  return vi.fn((..._call: RenderSlotCall) => null)
}

/** The provider-card seat dispatches a stub recorded, as (route id, configured, keyConfigured, entryKey). */
function cardSeatCalls(
  renderSlot: ReturnType<typeof stubRenderSlot>,
): Array<[string, boolean, boolean, string | undefined]> {
  return renderSlot.mock.calls
    .filter(call => call[0] === 'settings.models.provider-card')
    .map(call => [
      (call[1] as { provider: { provider: string } }).provider.provider,
      (call[1] as { configured: boolean }).configured,
      (call[1] as { keyConfigured: boolean }).keyConfigured,
      call[2]?.entryKey,
    ])
}

async function mountFace(scripted: ReturnType<typeof scriptedFace>) {
  const { face, update, mutate, set, unset } = scripted
  const ctx = ctxWith(face)
  const mirror = new SettingsDescribeMirror(ctx)
  const controller = new ModelsSettingsStore(ctx, settingsSchema, mirror)
  await controller.load()
  const renderSlot = stubRenderSlot()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    operations: operationsWith(face),
    schema: settingsSchema,
    t,
    renderSlot: renderSlot as unknown as ModelsSectionProps['renderSlot'],
  }
  const view = render(<ModelsSection {...injected} />)
  return { view, ctx, face, update, mutate, set, unset, controller, mirror, renderSlot }
}

async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  return mountFace(scriptedFace(overrides))
}

/**
 * Mount for a user who cannot reach any provider yet: no credential is stored
 * anywhere, so the whole-section DeepSeek route owns the first-run setup card.
 */
async function mountFirstRun(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(overrides)
  scripted.face.credentials.describe.mockImplementation((refs: string[]) =>
    Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    )))
  return mountFace(scripted)
}

/**
 * Mount and open the DeepSeek editor. The shared fixture already has a usable
 * openai route, so DeepSeek is an ordinary row whose card opens through Edit
 * rather than by itself.
 */
async function mountDeepSeekCard(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const mounted = await mountSection(overrides)
  fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
  return mounted
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as ModelsSectionProps
    render(<ModelsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('dispatches the provider-card seat per rendered row, keyed by the owning namespace', async () => {
    const { renderSlot } = await mountSection()
    const cards = cardSeatCalls(renderSlot)
    expect(cards).toContainEqual(['openai', true, true, 'llm-pi-ai'])
    expect(cards).toContainEqual(['deepseek-official', true, false, 'llm-deepseek'])
    // The footer seat renders once below the rows and the add controls.
    expect(renderSlot.mock.calls.filter(call => call[0] === 'settings.models.footer')).toEqual([
      ['settings.models.footer', {}],
    ])
  })

  it('dispatches the provider-card seat inside the first-run setup card', async () => {
    const { renderSlot } = await mountFirstRun()
    expect(cardSeatCalls(renderSlot)).toContainEqual(['deepseek-official', true, false, 'llm-deepseek'])
  })

  it('dispatches the provider-card seat on the add-provider draft with its dormant row', async () => {
    const { renderSlot } = await mountSection()
    renderSlot.mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(cardSeatCalls(renderSlot)).toContainEqual(['anthropic', false, false, 'llm-pi-ai'])
  })

  it('derives the draft seat\'s key fact from the page\'s conventional reference', async () => {
    const scripted = scriptedFace()
    scripted.face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY' || ref === 'ANTHROPIC_API_KEY',
        writable: true,
      }])),
    )))
    const { renderSlot } = await mountFace(scripted)
    renderSlot.mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // The dormant row names no reference yet; the seat still reports the
    // derived ANTHROPIC_API_KEY the editor itself displays as configured.
    expect(cardSeatCalls(renderSlot)).toContainEqual(['anthropic', false, true, 'llm-pi-ai'])
  })

  it('skips the draft seat when a refresh drops the dormant row', async () => {
    const { renderSlot, face, controller } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const directory = [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
      { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
    ].map(({ active: _active, ...entry }) => entry)
    face.llm.listConfigurableProviders.mockImplementation(() => Promise.resolve(remoteOk(directory)))
    renderSlot.mockClear()
    await act(async () => { await controller.load() })
    // The draft card is still open while its row is gone from the directory.
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(cardSeatCalls(renderSlot).some(([provider]) => provider === 'anthropic')).toBe(false)
  })
  it('renders the unkeyed whole-section provider as an open setup card in the first-run posture', async () => {
    await mountFirstRun()
    // Nothing is reachable yet, and DeepSeek has no configured credential and
    // no stored apiKey → setup card.
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Inactive')).toBeNull()
    expect(screen.getByText(en.add)).toBeTruthy()
  })

  it('leaves the unkeyed provider a plain row once another provider is usable', async () => {
    await mountSection()
    // openai's key is stored, so the user is not blocked and nothing on the
    // page opens itself over them.
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    const configured = screen.getByRole('img', { name: en.credentialConfigured })
    expect(configured.getAttribute('title')).toBe(en.credentialConfigured)
    expect(configured.className).toContain('credentialDotConfigured')
    expect(configured.closest('li')?.textContent).toContain('openai')
    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.closest('li')?.textContent).toContain('DeepSeek')
    // The card is still one click away.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
  })

  it('marks only a confirmed missing reference and leaves native or unavailable state unmarked', async () => {
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    )))
    const controller = new ModelsSettingsStore(ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)

    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.getAttribute('title')).toBe(en.credentialMissing)
    expect(missing.className).toContain('credentialDotMissing')
    expect(missing.closest('li')?.textContent).toContain('openai')
    expect(screen.queryByRole('img', { name: en.credentialConfigured })).toBeNull()
    expect(screen.getByText('zombie').closest('li')?.querySelector('[role="img"]')).toBeNull()
  })

  it('turns the setup card into a row once the credential reports configured', async () => {
    const { face } = await mountFirstRun()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    )))
    const controller = new ModelsSettingsStore(ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    // Now a row with an Edit button, not an open card.
    expect(screen.getAllByText(en.edit).length).toBeGreaterThan(1)
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('decides setup need from the joined credential state and the first-run posture', () => {
    const entry = { provider: 'p', displayName: 'p', settingsNs: 'llm-deepseek', settingsPath: [], active: true }
    const row = (credential: ProviderRow['credential']): ProviderRow => ({
      entry,
      configured: true,
      removable: false,
      apiKeyEnv: 'X',
      credential,
    })
    expect(needsSetup(row(undefined), false)).toBe(true)
    expect(needsSetup(row({ configured: true, writable: true }), false)).toBe(false)
    const nested = { ...row(undefined), entry: { ...entry, settingsPath: ['providers', 'x'] } }
    expect(needsSetup(nested, false)).toBe(false)
    // A user who can already reach some provider is not in the first-run
    // posture, so nothing on the page opens itself.
    expect(needsSetup(row(undefined), true)).toBe(false)
  })

  it('derives conventional credential references from route ids', () => {
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('uses one stable provider identity in action copy', () => {
    const target = { provider: 'deepseek-official', displayName: 'DeepSeek' }
    expect(providerTargetLabel(target)).toBe('DeepSeek (deepseek-official)')
    expect(providerCopy(en.deleteTitle, target)).toBe('Delete DeepSeek (deepseek-official)?')
    expect(providerTargetLabel(OPENAI_TARGET)).toBe('openai')
  })

  it('names only changed fields instead of rebuilding the section', () => {
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
    expect(pathOps([], { b: 1 }, { b: 2, d: 3 }))
      .toEqual([{ op: 'set', path: ['b'], value: 2 }, { op: 'set', path: ['d'], value: 3 }])
    expect(pathOps([], undefined, {})).toEqual([])
    expect(pathOps([], { a: 1 }, { a: 1 })).toEqual([])
  })

  it('stores a typed key write-only from the setup card without touching settings', async () => {
    const { set, mutate, face } = await mountFirstRun()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: '  sk-live  ' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-live') })
    expect(mutate).not.toHaveBeenCalled()
    // The saved key re-loads the join; the settings answer rides the shared
    // mirror, so the reload shows as a directory read rather than a describe.
    await waitFor(() => { expect(face.llm.listProviders.mock.calls.length).toBeGreaterThan(1) })
    expect((await screen.findByRole('status')).textContent).toBe(
      providerCopy(en.savedProvider, { provider: 'deepseek-official', displayName: 'DeepSeek' }),
    )
    fireEvent.click(screen.getByText(en.add))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reuses the provider editor as a required credential-only onboarding form', async () => {
    let finishSet: ((response: { ok: true; value: undefined }) => void) | undefined
    const set = vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => {
      finishSet = resolve
    }))
    const { face, mutate } = scriptedFace({ set })
    const onClose = vi.fn()
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')

    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      hideTitle
      namespace={wireNamespaces()[0]!}
      schema={settingsSchema}
      settingsPath={[]}
      operations={operationsWith(face)}
      t={t}
      readOnly={false}
      credentialOnly
      credentialRequired
      autoFocusCredential
      cancelLabelKey="onboardingLater"
      submitLabelKey="onboardingSave"
      submitBusyLabelKey="onboardingSaving"
      onClose={onClose}
    />)

    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    const save = screen.getByText<HTMLButtonElement>(en.onboardingSave)
    expect(document.activeElement).toBe(key)
    expect(key.required).toBe(true)
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.onboardingLater)).toBeTruthy()
    expect(screen.queryByText(en.customized)).toBeNull()
    expect(screen.queryByLabelText(en.baseUrl)).toBeNull()

    fireEvent.change(key, { target: { value: '   ' } })
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(key.getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)

    fireEvent.change(key, { target: { value: '  sk-onboarding  ' } })
    expect(screen.queryByText(en.keyRequired)).toBeNull()
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(await screen.findByText(en.onboardingSaving)).toBeTruthy()
    expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-onboarding')
    expect(mutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    if (finishSet === undefined) throw new Error('credential write did not start')
    await act(async () => {
      finishSet?.(remoteOk(undefined))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('applies customized deepseek fields as path ops', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    // The deepseek placeholder is pinned to the public endpoint, not the
    // effective value (which may reflect a launch-environment override).
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://next2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the field that actually changed: reasoningEffort was already
    // 'high' in the loaded profile, so it produces no op.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{ op: 'set', path: ['baseURL'], value: 'https://next2' }],
      0,
    ])
  })

  it('materializes inherited models and adds an arbitrary DeepSeek id', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])

    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(3)
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'private-preview' } })
    fireEvent.change(names[2] as HTMLInputElement, { target: { value: 'Private Preview' } })
    // Only row 3 is open, so its capacity is addressed by its own label.
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 3`), { target: { value: '131072' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          ...DEFAULT_DEEPSEEK_MODELS,
          { id: 'private-preview', name: 'Private Preview', contextWindow: 131_072 },
        ],
      }],
      0,
    ])
  })

  it('rejects duplicate DeepSeek model ids before writing', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'deepseek-v4-flash' } })
    fireEvent.click(screen.getByText(en.apply))

    await screen.findByText(`Model 3: ${en.modelIdDuplicate}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('validates every adapter-owned model catalog invariant', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, 'bad', { id: 'ok' }])).toEqual([{}, {}, { id: 'ok' }])
    expect(validateDeepSeekModels([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateDeepSeekModels([{ id: 'model', name: '' }]))
      .toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: null }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1.5 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 0 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1 }])).toBeUndefined()
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: null }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 1.5 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 0 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 8192 }])).toBeUndefined()
  })

  it('reads context windows written as counts, thousands, or millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
    expect(parseCapacity('131072')).toBe(131_072)
    expect(parseCapacity(' 256K ')).toBe(256_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('1m')).toBe(1_000_000)
    // 1M is 1000K, not 1024K: capacities are quoted in decimal.
    expect(parseCapacity('1M')).toBe(parseCapacity('1000K'))
    // 2.3 * 1e6 is a few ULPs high in binary floating point; an integral
    // intent must not become a fractional count the validator rejects.
    expect(parseCapacity('2.3M')).toBe(2_300_000)
    expect(Number.isInteger(parseCapacity('1.5M'))).toBe(true)
    // A genuinely fractional count survives as one, for the validator to reject.
    expect(parseCapacity('0.0001K')).toBeCloseTo(0.1)
    expect(parseCapacity('abc')).toBeNaN()
    expect(parseCapacity('1G')).toBeNaN()
    expect(parseCapacity('1M1')).toBeNaN()
  })

  it('spells a stored count in the shortest form that round-trips', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(1_500_000)).toBe('1500K')
    expect(formatCapacity(131_072)).toBe('131072')
    // Values the validator will reject are shown as-is rather than dressed up.
    expect(formatCapacity(Number.NaN)).toBe('NaN')
    expect(formatCapacity(0)).toBe('0')
    for (const text of ['1M', '256K', '131072', '1500K']) {
      expect(formatCapacity(parseCapacity(text) as number)).toBe(text)
    }
  })

  it('accepts a suffixed context window and stores the plain count', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    // The inherited 1000000 reads back short.
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    // Keystrokes stay verbatim while the row has focus, so typing `1000` does
    // not rewrite itself to `1K` mid-word.
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000')
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000K' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000K')
    // Blur settles the row to the canonical spelling of the same count.
    fireEvent.blur(windows[0] as HTMLInputElement)
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '256K' } })
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          { ...DEFAULT_DEEPSEEK_MODELS[0], contextWindow: 1_000_000 },
          { ...DEFAULT_DEEPSEEK_MODELS[1], contextWindow: 256_000 },
        ],
      }],
      0,
    ])
  })

  it('keeps unreadable context-window text on screen and refuses the write', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1 gazillion' } })
    // Blurring a row that is not the edited one leaves the buffer alone.
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.blur(windows[0] as HTMLInputElement)
    // The text the user typed is still there to correct.
    expect((windows[0] as HTMLInputElement).value).toBe('1 gazillion')

    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(`Model 1: ${en.modelContextInvalid}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([
    ['the schema default', undefined],
    ['the composition entry', { models: [{ id: 'pinned-by-deployment' }] }],
  ])('restores %s the moment the override is dropped, not after a reload', async (_label, base) => {
    // The regression: reset read the EFFECTIVE value, which still carries the
    // stored override until the unset is applied — so the rows did not change
    // and the catalog only looked restored after reopening the card.
    const { face } = scriptedFace()
    const stored = { models: [{ id: 'user-only-model', name: 'User Only' }] }
    const overridden: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: { ...stored, defaultContextWindow: 1_000_000 },
      ...base === undefined ? {} : { base },
      user: stored,
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={overridden}
      schema={settingsSchema}
      settingsPath={[]}
      operations={operationsWith(face)}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByText(en.modelsCustomized)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['user-only-model'])

    fireEvent.click(screen.getByText(en.resetModels))

    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(base === undefined ? ['deepseek-v4-flash', 'deepseek-v4-pro'] : ['pinned-by-deployment'])
  })

  it('keeps every row\'s unreadable text, not just the last one edited', async () => {
    // The regression: one active buffer meant editing a second row displaced
    // the first, which then fell back to rendering its stored NaN as `NaN` —
    // losing the text the user was told they could still correct.
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'not a number' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '2M' } })

    expect((windows[0] as HTMLInputElement).value).toBe('not a number')
    expect((windows[1] as HTMLInputElement).value).toBe('2M')
  })

  it('re-keys the typed text around a removed row', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    const windows = (): HTMLInputElement[] => capacityInputs(en.contextWindow)
    const removeRow = (at: number): void => {
      fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[at] as HTMLElement)
    }
    // Three rows, with text parked on the outer two.
    fireEvent.click(screen.getByText(en.addModel))
    expandRow(1)
    expandRow(2)
    expandRow(3)
    fireEvent.change(windows()[0] as HTMLInputElement, { target: { value: 'top text' } })
    fireEvent.blur(windows()[0] as HTMLInputElement)
    fireEvent.change(windows()[2] as HTMLInputElement, { target: { value: 'bottom text' } })
    fireEvent.blur(windows()[2] as HTMLInputElement)

    // Dropping the middle row leaves the row above untouched and carries the
    // row below down with its own text, rather than stranding it.
    removeRow(1)
    expect(windows()).toHaveLength(2)
    expect((windows()[0] as HTMLInputElement).value).toBe('top text')
    expect((windows()[1] as HTMLInputElement).value).toBe('bottom text')

    // Dropping a row that holds text takes that text with it; the survivor
    // keeps its own rather than inheriting the deleted row's.
    removeRow(0)
    expect(windows()).toHaveLength(1)
    expect((windows()[0] as HTMLInputElement).value).toBe('bottom text')
  })

  it('drops the typed text when reset replaces the rows it annotated', async () => {
    // The regression: reset removed the override but left the buffer, so an
    // inherited row displayed text no settings layer stores — and because an
    // unreadable buffer never settles, it stayed there indefinitely.
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'garbage' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.resetModels))

    // Reset collapses every row, so the restored capacity needs opening again.
    expandRow(1)
    const restored = capacityInputs(en.contextWindow)
    expect((restored[0] as HTMLInputElement).value).toBe('1M')

    // Reset put the draft back where it started, so Apply writes nothing at
    // all rather than persisting whatever the stale text had parsed to.
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(screen.queryByText(en.apply)).toBeNull() })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('edits an output cap per model and carries its text across a removal', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    // The profile's own cap is the placeholder both rows inherit.
    expect(capacityInputs(en.maxTokens).map(input => input.placeholder)).toEqual(['256K', '256K'])

    fireEvent.change(screen.getByLabelText(`${en.maxTokens} 2`), { target: { value: '64K' } })
    fireEvent.blur(screen.getByLabelText(`${en.maxTokens} 2`))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 2`).value).toBe('64K')

    // Dropping the row above carries the cap text down with its own row.
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).value).toBe('64K')
    // The disclosure closes on a second press.
    expandRow(1)
    expect(screen.queryByLabelText(`${en.maxTokens} 1`)).toBeNull()

    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [{ ...DEFAULT_DEEPSEEK_MODELS[1], maxTokens: 64_000 }],
      }],
      0,
    ])
  })

  it('settles a pasted id and refuses whitespace that would never match', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    const ids = screen.getAllByLabelText<HTMLInputElement>(new RegExp(en.modelId))
    fireEvent.change(ids[0] as HTMLInputElement, { target: { value: '  deepseek-v4-flash  ' } })
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')
    // A settled id needs no second trim.
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')

    // An id that is only whitespace is as absent as an empty one, and a padded
    // id is a duplicate of its trimmed twin.
    expect(validateDeepSeekModels([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'model' }, { id: 'model ' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('rejects a reasoning-effort declaration the adapter would not accept', () => {
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: 'invalid' }]))
      .toEqual({ index: 0, key: 'modelReasoningEffortsInvalid' })
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: { high: '' } }]))
      .toEqual({ index: 0, key: 'modelReasoningEffortsInvalid' })
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: {} }]))
      .toEqual({ index: 0, key: 'modelReasoningEffortsInvalid' })
    expect(validateDeepSeekModels([{ id: 'm', reasoningEfforts: { off: null } }]))
      .toEqual({ index: 0, key: 'modelReasoningEffortsInvalid' })
  })

  it('writes per-model reasoningEfforts from the deepseek four-level group', () => {
    const onChange = vi.fn()
    function Mount() {
      const [models, setModels] = useState<DeepSeekModelDraft[]>([{ id: 'deepseek-v4-flash' }])
      return (
        <DeepSeekModelsEditor
          models={models}
          overridden
          defaultContextWindow={undefined}
          defaultMaxTokens={undefined}
          t={t}
          disabled={false}
          onChange={(next) => { setModels(next); onChange(next) }}
          onReset={vi.fn()}
        />
      )
    }
    render(<Mount />)
    expandRow(1)
    // Only the levels this wire route dispatches are offered.
    expect(screen.queryByLabelText(`${en.modelReasoningLevels} 1 minimal`)).toBeNull()
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 low`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'deepseek-v4-flash', reasoningEfforts: { low: 'low' } },
    ])
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 max`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'deepseek-v4-flash', reasoningEfforts: { low: 'low', max: 'max' } },
    ])
  })

  it('renders malformed draft fallbacks without inventing catalog values', () => {
    render(<DeepSeekModelsEditor
      models={[{}]}
      overridden={false}
      defaultContextWindow={undefined}
      defaultMaxTokens={undefined}
      t={t}
      disabled={true}
      onChange={vi.fn()}
      onReset={vi.fn()}
    />)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('')
    expandRow(1)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 1`).placeholder)
      .toBe(en.contextWindowPlaceholder)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).placeholder)
      .toBe(en.maxTokensPlaceholder)
  })

  it('can empty and reset the model override, then clear optional fields without dropping hidden data', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    fireEvent.click(screen.getByLabelText(new RegExp(en.removeModel)))
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
    fireEvent.click(screen.getByText(en.resetModels))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()

    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(1)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(names[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          { id: 'deepseek-v4-flash', description: 'Preserved hidden detail' },
          DEFAULT_DEEPSEEK_MODELS[1],
        ],
      }],
      0,
    ])
  })

  it('clears an inherited override with an unset op, never a whole-section replace', async () => {
    // A whole-section replace would clobber sibling overrides to clear one field.
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://base')
    fireEvent.change(url, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // This editor clears one field through an unset op so it cannot clobber
    // sibling overrides with a whole-section replacement.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{ op: 'unset', path: ['baseURL'] }],
      0,
    ])
  })

  it('pins the deepseek placeholder and clears typed input back to inherited', async () => {
    const { face } = scriptedFace()
    const bare: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={bare}
      schema={settingsSchema}
      settingsPath={[]}
      operations={operationsWith(face)}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.customized))
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://x' } })
    expect(baseURL.value).toBe('https://x')
    fireEvent.change(baseURL, { target: { value: '' } })
    expect(baseURL.value).toBe('')
  })

  it('rejects an invalid draft before writing', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/baseURL/)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('edits a pi-ai profile with the curated fields only', async () => {
    const { mutate } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    // The configured credential shows as the stored placeholder.
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyStored) })
    // pi-ai carries Base URL too: the stored override shows as the value and
    // the effective profile endpoint as its placeholder source.
    fireEvent.click(screen.getByText(en.customized))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://proxy')
    fireEvent.change(url, { target: { value: 'https://proxy/v2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the edited field travels: apiKeyEnv and headers were already stored
    // with these values, so no op restates them.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://proxy/v2' }],
      0,
    ])
  })

  it('adds a dormant provider with a derived reference and stores its key', async () => {
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    expect([...pick.options].map(option => option.value)).toEqual(['anthropic', 'broken', 'plain'])
    expect(pick.value).toBe('anthropic')
    // A dormant profile has no endpoint anywhere: the pi-ai placeholder
    // falls back to the provider-default wording.
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByLabelText<HTMLInputElement>(en.baseUrl).placeholder).toBe(en.baseUrlDefault)
    const addKey = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    expect(addKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(addKey, { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }],
      0,
    ])
    await waitFor(() => { expect(set).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant') })
  })

  it('keeps pi-ai provider-native authentication when no key is entered', async () => {
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic'], value: {} }],
      0,
    ])
    expect(set).not.toHaveBeenCalled()
  })

  it('retries only the credential after refreshed settings already committed', async () => {
    const committed = wireNamespaces()[2]!
    const afterSettings: SettingsNamespaceView = {
      ...committed,
      value: { providers: {
        ...(committed.value as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      user: { providers: {
        ...(committed.user as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      revision: 1,
    }
    const mutate = vi.fn(() => Promise.resolve(remoteOk(afterSettings)))
    const set = vi.fn()
      .mockResolvedValueOnce(remoteFail('credential store unavailable'))
      .mockResolvedValueOnce(remoteOk(undefined))
    const { face, controller, mirror } = await mountSection({ mutate, set })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('credential store unavailable')
    expect(mutate).toHaveBeenCalledOnce()
    face.settings.describe.mockResolvedValue(remoteOk({
      writable: true,
      hasDocument: false,
      namespaces: wireNamespaces().map(namespace => namespace.ns === 'llm-pi-ai' ? afterSettings : namespace),
    }))
    // The refreshed settings answer reaches the page through the mirror's own
    // refresh (the document commit's invalidation in production).
    await act(async () => {
      await mirror.load()
      await controller.load()
    })
    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')?.revision).toBe(1)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(2) })
    expect(mutate).toHaveBeenCalledOnce()
    expect(set).toHaveBeenLastCalledWith('ANTHROPIC_API_KEY', 'sk-ant')
  })

  it('switches the add card target and degrades unknown or broken targets loudly', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    fireEvent.change(pick, { target: { value: 'broken' } })
    await screen.findByText(/unresolvable settings path/)
    fireEvent.change(pick, { target: { value: 'plain' } })
    await waitFor(() => {
      expect(screen.getAllByText(content => content.includes(en.advancedHint)).length).toBeGreaterThan(0)
    })
    // The hint-only card cannot apply anything, and offers no key field.
    expect(screen.getByText<HTMLButtonElement>(en.apply).disabled).toBe(true)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
  })

  it('surfaces a rejected settings write and never stores the key after it', async () => {
    const { set } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(remoteFail('llm-pi-ai: unknown pi-ai provider "bogus"', 'settings/rejected'))),
    })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/unknown pi-ai provider/)
    expect(set).not.toHaveBeenCalled()
  })

  it('renders the card without the stored-key hint when the credential probe is refused', async () => {
    const { face } = scriptedFace()
    face.credentials.describe = vi.fn(() => Promise.resolve(remoteFail('no credential provider')))
    const controller = new ModelsSettingsStore(ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    const key = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(key.placeholder).toBe(en.keyPlaceholder)
  })

  it('tells the user to reopen when another writer moved the namespace first', async () => {
    // The stale-draft overwrite: two tabs open the same card, the other saves,
    // and this one must be refused rather than replay its opening snapshot.
    const { set } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteFail('changed since it was read', 'settings/conflict'))),
    })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://mine' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(en.conflict)
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the card usable after a refused write', async () => {
    await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteFail('the host refused', 'settings/rejected'))),
    })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://next' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('the host refused')
    // Not stuck in `applying…`: the finally cleared busy, so Apply is live again.
    expect(screen.getByText(en.apply)).toBeTruthy()
  })

  it('surfaces a shadowed credential write on the card', async () => {
    await mountFirstRun({
      set: vi.fn(() => Promise.resolve(remoteFail('credentials: DEEPSEEK_API_KEY is shadowed by the read-only environment'))),
    })
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/shadowed by the read-only environment/)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('locks the key input when the launch environment provides the credential', async () => {
    const { face } = await mountSection()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY', source: 'env', writable: false,
      }])),
    )))
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyEnvLocked) })
    expect(editorKey.disabled).toBe(true)
  })

  it('keeps a failed credential describe silent and the input usable', async () => {
    const { face, set } = await mountSection()
    face.credentials.describe.mockImplementation(() => Promise.resolve(remoteFail('down', 'gateway/internal')))
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(editorKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(editorKey, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(1) })
  })

  it('requires confirmation before removing a user-added provider', async () => {
    const { mutate, unset } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    expect(dialog.textContent).toContain(openaiCopy(en.deleteDescriptionWithCredential))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: en.cancel }))
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: openaiCopy(en.deleteConfirm) }))
    await waitFor(() => { expect(unset).toHaveBeenCalledWith('OPENAI_API_KEY') })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(unset.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0] as number)
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', 'openai'] }],
      undefined,
    ])
  })

  it('blocks duplicate deletion while the confirmed removal is pending', async () => {
    let resolveRemoval!: (response: { ok: true; value: SettingsNamespaceView }) => void
    const mutate = vi.fn(() => new Promise<{ ok: true; value: SettingsNamespaceView }>((resolve) => {
      resolveRemoval = resolve
    }))
    await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(confirm.disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.cancel }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: openaiCopy(en.deleting) })).toBe(confirm)
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(mutate).toHaveBeenCalledOnce()
    await act(async () => { resolveRemoval(remoteOk(wireNamespaces()[2]!)) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('renders the load failure with a retry control', async () => {
    const face = scriptedFace()
    face.face.llm.listProviders = vi.fn(() => Promise.resolve(remoteFail('directory down', 'gateway/internal'))) as never
    const controller = new ModelsSettingsStore(
      ctxWith(face.face), settingsSchema, new SettingsDescribeMirror(ctxWith(face.face)))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face.face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(screen.queryByText(/directory down/)).toBeNull() })
  })

  it('shows the read-only notice and disables mutations for a read-only provider', async () => {
    const { face } = await mountSection()
    face.settings.describe.mockImplementation(() => Promise.resolve(remoteOk({
      writable: false,
      hasDocument: false,
      namespaces: wireNamespaces(),
    })))
    const controller = new ModelsSettingsStore(ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByText<HTMLButtonElement>(en.remove).every(button => button.disabled)).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.add).disabled).toBe(true)
  })

  it('toggles the row editor closed on a second edit click and on cancel', async () => {
    const { mutate } = await mountSection()
    const edit = screen.getByRole('button', { name: openaiCopy(en.editProvider) })
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(edit)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('cancels the add card back to the add button', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.cancel))
    await screen.findByText(en.add)
    expect(screen.queryByLabelText(en.provider)).toBeNull()
  })

  it('collapses the setup card on cancel without disturbing another open card', async () => {
    // The regression: the setup card shared the row/add/declare close handler,
    // so cancelling it discarded the add card's draft while staying open itself.
    await mountFirstRun()
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(2)

    // The setup card is the first one on the page, above the add block.
    fireEvent.click(screen.getAllByText(en.cancel)[0] as HTMLElement)
    // The add card kept its draft…
    expect(screen.getByLabelText(en.provider)).toBeTruthy()
    // …and DeepSeek collapsed to an ordinary row carrying the missing-key dot.
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: en.credentialMissing })
      .some(dot => dot.closest('li')?.textContent?.includes('DeepSeek') === true)).toBe(true)
    // Its card reopens through Edit, which closes the add card as any row does.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    expect(screen.queryByLabelText(en.provider)).toBeNull()
  })

  it('loads on first render of an idle controller', async () => {
    const { face } = scriptedFace()
    const controller = new ModelsSettingsStore(ctxWith(face), settingsSchema, new SettingsDescribeMirror(ctxWith(face)))
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      operations={operationsWith(face)}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    await screen.findByText('DeepSeek')
  })

  it('removes by unsetting the profile path, never by rebuilding the section', async () => {
    // The page only needs to name the profile path; rebuilding the section
    // would widen the write for no benefit.
    const { face, mutate, controller } = await mountSection()
    await removeProviderProfile(
      operationsWith(face),
      controller,
      { settingsNs: 'llm-plain', settingsPath: ['ghost-profile'] },
    )
    expect(mutate.mock.calls[0]).toEqual([
      'llm-plain',
      [{ op: 'unset', path: ['ghost-profile'] }],
      undefined,
    ])
  })

  it('keeps the snapshot untouched and reports the message when a removal write is refused', async () => {
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(remoteFail('read-only', 'settings/rejected'))),
    })
    const before = controller.store.getSnapshot().rows
    const failure = await removeProviderProfile(
      operationsWith(face),
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('read-only')
    expect(controller.store.getSnapshot().rows).toBe(before)
  })

  it('keeps a failed identified deletion recoverable in its confirmation dialog', async () => {
    const mutate = vi.fn()
      .mockResolvedValueOnce(remoteFail('the host refused', 'settings/rejected'))
      .mockResolvedValueOnce(remoteOk(wireNamespaces()[2]!))
    const { unset } = await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    await within(dialog).findByText('the host refused')
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(unset).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledOnce()

    fireEvent.click(confirm)
    await waitFor(() => { expect(unset).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('retains credentials that are not identified as page-managed', async () => {
    const { unset, mutate } = await mountSection()
    const target = { provider: 'zombie', displayName: 'zombie' }
    fireEvent.click(screen.getByRole('button', { name: providerCopy(en.removeProvider, target) }))
    const dialog = screen.getByRole('dialog', { name: providerCopy(en.deleteTitle, target) })
    expect(dialog.textContent).toContain(providerCopy(en.deleteDescription, target))
    fireEvent.click(within(dialog).getByRole('button', { name: providerCopy(en.deleteConfirm, target) }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', 'zombie'] }],
      undefined,
    ])
  })

  it('does not remove provider settings when its managed credential removal is refused', async () => {
    const { face, controller, mutate } = await mountSection({
      unset: vi.fn(() => Promise.resolve(remoteFail('credential is read-only'))),
    })
    const failure = await removeProviderProfile(
      operationsWith(face),
      controller,
      {
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
        credentialRef: 'OPENAI_API_KEY',
      },
    )
    expect(failure).toBe('credential is read-only')
    expect(mutate).not.toHaveBeenCalled()
  })

})

describe('apiKeyFailure', () => {
  it('treats a blank field as no failure — it means keep the stored key', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })

  it.each([
    ['a printable-ASCII key', 'sk-0123456789'],
    ['a padded key, which the caller trims', '  sk-abc  '],
    ['the printable-ASCII boundary characters', '!~'],
    ['a hyphenated key carrying an equals sign', 'sk-ABC=xyz'],
    ['an all-upper-case key ending in base64 padding', 'ABCD=='],
    ['an all-upper-case key ending in one padding character', 'MNOPQRST='],
  ])('accepts %s', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBeUndefined()
  })

  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
  ])('fails a field holding only %s instead of silently dropping it', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyBlank')
  })

  it.each([
    ['an emoji', 'sk-\u{1F600}'],
    ['CJK text', 'sk-你好'],
    ['full-width punctuation', 'sk-abc，'],
    ['an interior space', 'sk-abc def'],
    ['a C0 control character', 'sk-abc\x01'],
    ['a latin-1 character', 'sk-café'],
  ])('fails %s as illegal characters', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it.each([
    ['a pasted environment line', 'DEEPSEEK_API_KEY=sk-abc'],
    ['double quotes', '"sk-abc"'],
    ['single quotes', '\'sk-abc\''],
    ['backticks', '`sk-abc`'],
  ])('fails %s as a format failure', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it('needs a matching closing quote before it calls a value wrapped', () => {
    // A lone quote and an unbalanced one are legal printable ASCII, so the
    // heuristic leaves them alone rather than guessing at a paste error.
    expect(apiKeyFailure('"')).toBeUndefined()
    expect(apiKeyFailure('"a')).toBeUndefined()
  })
})

/** Minimal operations whose discovery never runs in these suites. */
function idleOperations(): ModelsOperations {
  return {
    describeCredential: vi.fn(),
    storeCredential: vi.fn(),
    removeCredential: vi.fn(),
    writeSettings: vi.fn(),
    discoverModels: vi.fn(),
  }
}

describe('model reasoning-effort declaration editing', () => {

  /** Render the editor with real local state so checkbox toggles round-trip. */
  function mountEditor(onChange: (models: unknown[]) => void) {
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'third-party', reasoningEfforts: { high: 'high' } },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
          operations={idleOperations()}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    expandRow(1)
  }

  it('parses the declaration text into the draft on edit', () => {
    const onChange = vi.fn()
    mountEditor(onChange)
    const input = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningEfforts} 1`)
    fireEvent.change(input, { target: { value: 'high: high, max: ultra' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', reasoningEfforts: { high: 'high', max: 'ultra' } },
    ])
  })

  it('parks the invalid sentinel for unreadable text and refuses it in validation', () => {
    const onChange = vi.fn()
    mountEditor(onChange)
    const input = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningEfforts} 1`)
    fireEvent.change(input, { target: { value: 'ultra: ultra' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', reasoningEfforts: INVALID_EFFORTS },
    ])
    expect(validateDeepSeekModels([{ id: 'x', reasoningEfforts: INVALID_EFFORTS }]))
      .toEqual({ index: 0, key: 'modelReasoningEffortsInvalid' })
    expect(validateDeepSeekModels([{ id: 'x', reasoningEfforts: { high: 'high' } }])).toBeUndefined()
    expect(validateDeepSeekModels([{ id: 'x', reasoningEfforts: false }])).toBeUndefined()
  })

  it('disables reasoning with the checkbox and clears the declaration when unchecked', () => {
    const onChange = vi.fn()
    mountEditor(onChange)
    const toggle = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningOff} 1`)
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'third-party', reasoningEfforts: false }])
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'third-party' }])
  })

  it('shows the stored declaration as field text', () => {
    mountEditor(() => {})
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningEfforts} 1`).value)
      .toBe('high: high')
  })
})

describe('model capability and reasoning-level checkboxes', () => {

  /** Render the pi-ai editor with real local state so checkbox toggles round-trip. */
  function mountPiAiEditor(onChange: (models: unknown[]) => void, probeApi?: string) {
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'third-party' },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai', ...probeApi === undefined ? {} : { api: probeApi } }}
          operations={idleOperations()}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    expandRow(1)
  }

  it('pre-checks the off/low/max default offer and toggles levels on top of it', () => {
    const onChange = vi.fn()
    mountPiAiEditor(onChange)
    // A model that declares no levels shows the default offer pre-checked…
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 off`).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 low`).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 max`).checked).toBe(true)
    // …adding a level extends it with the protocol default spelling…
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 high`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', reasoningEfforts: { off: null, low: 'low', max: 'max', high: 'high' } },
    ])
    // …and removing it returns to the default offer.
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 high`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', reasoningEfforts: { off: null, low: 'low', max: 'max' } },
    ])
  })

  it('keeps the raw-text declaration behind the advanced disclosure and re-derives it', () => {
    const onChange = vi.fn()
    mountPiAiEditor(onChange)
    // A custom wire spelling typed into the advanced field lands in the map…
    const raw = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningEfforts} 1`)
    fireEvent.change(raw, { target: { value: 'high: ultra' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', reasoningEfforts: { high: 'ultra' } },
    ])
    // …the checkbox group reads it as a checked level…
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 high`).checked).toBe(true)
    // …and unchecking it clears the text buffer back to the derived value.
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 high`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'third-party', reasoningEfforts: false }])
  })

  it('shows the protocol family suggestion as an advisory hint', () => {
    mountPiAiEditor(() => {}, 'openai-completions')
    expect(screen.getByText(`${en.reasoningLevelsSuggestion}minimal, low, medium, high`)).toBeTruthy()
  })

  it('toggles image input and generation independently', () => {
    const onChange = vi.fn()
    mountPiAiEditor(onChange)
    fireEvent.click(screen.getByLabelText(`${en.modelImageGeneration} 1`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', output: ['text', 'image'] },
    ])
    fireEvent.click(screen.getByLabelText(`${en.modelImageInput} 1`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', output: ['text', 'image'], input: ['text', 'image'] },
    ])
  })

  it('implies image input at the storage level when understanding is checked', () => {
    const onChange = vi.fn()
    mountPiAiEditor(onChange)
    fireEvent.click(screen.getByLabelText(`${en.modelImageUnderstanding} 1`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', input: ['text', 'image'], capabilities: { imageUnderstanding: true } },
    ])
    fireEvent.click(screen.getByLabelText(`${en.modelImageUnderstanding} 1`))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'third-party', input: ['text', 'image'] },
    ])
    fireEvent.click(screen.getByLabelText(`${en.modelImageInput} 1`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'third-party', input: ['text'] }])
  })

  it('disables the whole group when the declaration is false and clears it back to inheritance', () => {
    const onChange = vi.fn()
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'third-party', reasoningEfforts: false },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
          operations={idleOperations()}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    expandRow(1)
    // `false` disables every level checkbox, and the disable checkbox is on.
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 off`).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 low`).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 max`).disabled).toBe(true)
    const offToggle = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningOff} 1`)
    expect(offToggle.checked).toBe(true)
    // Clearing the disable control returns to inheritance (undefined).
    fireEvent.click(offToggle)
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'third-party' }])
  })
})

describe('model list fetch and catalog editing', () => {
  function operationsWithDiscovery(
    discover: (settingsNs: string, request: Parameters<ModelsOperations['discoverModels']>[1]) => Promise<ModelDiscoveryOutcome>,
  ): ModelsOperations {
    return {
      describeCredential: vi.fn(),
      storeCredential: vi.fn(),
      removeCredential: vi.fn(),
      writeSettings: vi.fn(),
      discoverModels: discover,
    }
  }

  function mountListEditor({
    models,
    overridden,
    onReset,
    probe = { provider: 'openai', settingsNs: 'llm-pi-ai' },
    probeBlocked,
    disabled = false,
    onChange,
    operations,
  }: {
    models: readonly ModelDraft[]
    overridden?: boolean
    onReset?: () => void
    probe?: { provider?: string; settingsNs: string; baseURL?: string; api?: string; apiKey?: string }
    probeBlocked?: keyof typeof en
    disabled?: boolean
    onChange: (models: ModelDraft[]) => void
    operations: ModelsOperations
  }): void {
    render(<ModelListEditor
      models={models}
      {...overridden === undefined ? {} : { overridden }}
      onChange={onChange}
      {...onReset === undefined ? {} : { onReset }}
      probe={probe}
      {...probeBlocked === undefined ? {} : { probeBlocked }}
      operations={operations}
      t={t}
      disabled={disabled}
    />)
  }

  it('fetches candidates and adopts the picked ones into the catalog', async () => {
    const discovered = vi.fn(async () => ({
      kind: 'found' as const,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128_000, maxTokens: 16_384 },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 64_000, maxTokens: 8_192 },
        { id: 'bare' },
      ],
    }))
    const onChange = vi.fn()
    // The catalog already owns `gpt-4o`, so the unknown `gpt-4o-mini` and
    // `bare` start picked, and adopt preserves the tuned row rather than
    // overwriting it while carrying only the disclosed optional fields.
    mountListEditor({
      models: [{ id: 'gpt-4o', name: 'Tuned GPT-4o', contextWindow: 200_000 }],
      onChange,
      operations: operationsWithDiscovery(discovered),
    })

    fireEvent.click(screen.getByText(en.fetchModels))
    await waitFor(() => { expect(discovered).toHaveBeenCalledTimes(1) })
    expect(discovered).toHaveBeenCalledWith('llm-pi-ai', { provider: 'openai' })

    // The search filters the candidate list to `gpt-4o-mini`.
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.fetchSearch), {
      target: { value: 'mini' },
    })
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy()
    expect(screen.queryByText('gpt-4o')).toBeNull()
    expect(screen.queryByText('Tuned GPT-4o')).toBeNull()

    // A name-only query also matches (the display-name branch).
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.fetchSearch), {
      target: { value: 'o mini' },
    })
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy()

    // Clearing the query adopts the disclosed fields; the bare candidate keeps
    // only its id because it disclosed none of the optional ones.
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.fetchSearch), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByText(en.fetchAdopt))
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'gpt-4o', name: 'Tuned GPT-4o', contextWindow: 200_000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 64_000, maxTokens: 8_192 },
      { id: 'bare' },
    ])
    expect(screen.getByText(en.fetchModels)).toBeTruthy()
  })

  it('deselects and reselects the visible candidate batch, then cancels', async () => {
    const discovered = vi.fn(async () => ({
      kind: 'found' as const,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      ],
    }))
    const { unmount } = render(
      <ModelListEditor
        models={[]}
        onChange={vi.fn()}
        probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
        operations={operationsWithDiscovery(discovered)}
        t={t}
        disabled={false}
      />,
    )
    fireEvent.click(screen.getByText(en.fetchModels))
    await waitFor(() => { expect(screen.getByText('gpt-4o-mini')).toBeTruthy() })

    // Every candidate is picked, so the batch button offers deselect-all.
    expect(screen.getByText(en.fetchDeselectAll)).toBeTruthy()

    // Unchecking one candidate (its row checkbox) removes it from the pick; its
    // row checkbox toggles back on when clicked again.
    const miniRow = within(screen.getByText('gpt-4o-mini').closest('li') as HTMLElement)
    fireEvent.click(miniRow.getByRole('checkbox'))
    expect(screen.getByText(en.fetchSelectAll)).toBeTruthy()
    fireEvent.click(miniRow.getByRole('checkbox'))
    expect(screen.getByText(en.fetchDeselectAll)).toBeTruthy()
    fireEvent.click(miniRow.getByRole('checkbox'))

    // Select-the-batch re-adds the dropped candidate; deselect-all clears it.
    fireEvent.click(screen.getByText(en.fetchSelectAll))
    expect(screen.getByText(en.fetchDeselectAll)).toBeTruthy()
    fireEvent.click(screen.getByText(en.fetchDeselectAll))
    expect(screen.getByText(en.fetchSelectAll)).toBeTruthy()

    // Refining a query to no match shows the empty state, then cancelling
    // closes the dialog and restores the section heading.
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.fetchSearch), {
      target: { value: 'nomatch' },
    })
    expect(screen.getByText(en.fetchNoMatches)).toBeTruthy()
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.getByText(en.fetchModels)).toBeTruthy()
    unmount()
  })

  it('shows the refusal, empty, and busy fetch states', async () => {
    const refused = vi.fn(async () => ({ kind: 'refused' as const, message: 'endpoint refused' }))
    const onChange = vi.fn()
    const { unmount } = render(
      <ModelListEditor
        models={[]}
        onChange={onChange}
        probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
        operations={operationsWithDiscovery(refused)}
        t={t}
        disabled={false}
      />,
    )
    fireEvent.click(screen.getByText(en.fetchModels))
    await waitFor(() => { expect(screen.getByText('endpoint refused')).toBeTruthy() })
    unmount()

    const empty = vi.fn(async () => ({ kind: 'found' as const, models: [] }))
    render(
      <ModelListEditor
        models={[]}
        onChange={onChange}
        probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
        operations={operationsWithDiscovery(empty)}
        t={t}
        disabled={false}
      />,
    )
    fireEvent.click(screen.getByText(en.fetchModels))
    await waitFor(() => { expect(screen.getByText(en.fetchEmpty)).toBeTruthy() })
  })

  it('forwards every probe field to discovery and stays askable via baseURL alone', async () => {
    // An adapter the form already describes answers without an endpoint, but a
    // draft with a base URL (and no provider) is askable on that alone.
    const discovered = vi.fn(async () => ({ kind: 'found' as const, models: [{ id: 'm' }] }))
    render(
      <ModelListEditor
        models={[]}
        onChange={vi.fn()}
        probe={{
          settingsNs: 'llm-pi-ai',
          baseURL: 'https://api.example.com',
          api: 'openai-completions',
          apiKey: 'sk-test',
        }}
        operations={operationsWithDiscovery(discovered)}
        t={t}
        disabled={false}
      />,
    )
    expect(screen.getByText<HTMLButtonElement>(en.fetchModels).disabled).toBe(false)
    fireEvent.click(screen.getByText(en.fetchModels))
    await waitFor(() => { expect(discovered).toHaveBeenCalledTimes(1) })
    expect(discovered).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://api.example.com',
      api: 'openai-completions',
      apiKey: 'sk-test',
    })
  })

  it('disables the fetch action when no askable target or a blocked key is present', () => {
    const nothingAskable = vi.fn()
    const { unmount } = render(
      <ModelListEditor
        models={[]}
        onChange={vi.fn()}
        probe={{ settingsNs: 'llm-pi-ai' }}
        operations={operationsWithDiscovery(nothingAskable)}
        t={t}
        disabled={false}
      />,
    )
    const button = screen.getByText(en.fetchModels) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe(en.fetchNeedsBaseUrl)
    unmount()

    render(
      <ModelListEditor
        models={[]}
        onChange={vi.fn()}
        probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
        probeBlocked="keyRequired"
        operations={operationsWithDiscovery(nothingAskable)}
        t={t}
        disabled={false}
      />,
    )
    const blocked = screen.getByText(en.fetchModels) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(blocked.title).toBe(en.keyRequired)
  })

  it('edits row text and capacity fields, clears an emptied optional field, and removes rows', () => {
    const onChange = vi.fn()
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'one', name: 'First', contextWindow: 1000 },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
          operations={operationsWithDiscovery(vi.fn())}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`), {
      target: { value: 'two' },
    })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'two', name: 'First', contextWindow: 1000 }])

    // A non-empty name is stored verbatim; an emptied one leaves the profile.
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(`${en.modelName} 1`), {
      target: { value: 'Renamed' },
    })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'two', name: 'Renamed', contextWindow: 1000 }])
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(`${en.modelName} 1`), {
      target: { value: '' },
    })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'two', contextWindow: 1000 }])

    // Editing a capacity parses the K/M spelling onto the draft.
    expandRow(1)
    const context = screen.getByLabelText<HTMLInputElement>(`${en.modelContextWindow} 1`)
    expect(context.value).toBe('1K')
    fireEvent.change(context, { target: { value: '256K' } })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'two', contextWindow: 256_000 }])

    const max = screen.getByLabelText<HTMLInputElement>(`${en.modelMaxTokens} 1`)
    fireEvent.change(max, { target: { value: '32K' } })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'two', contextWindow: 256_000, maxTokens: 32_000 }])

    // Opening and closing the disclosure toggles the expanded set both ways.
    expect(screen.getByLabelText(`${en.modelAdvanced} 1`).getAttribute('aria-expanded')).toBe('true')
    expandRow(1)
    expect(screen.getByLabelText(`${en.modelAdvanced} 1`).getAttribute('aria-expanded')).toBe('false')
    expandRow(1)
    expect(screen.getByLabelText(`${en.modelAdvanced} 1`).getAttribute('aria-expanded')).toBe('true')

    // Removing the row drops it and re-keys the capacity edits.
    fireEvent.click(screen.getByLabelText(`${en.removeModel} 1`))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('re-keys editing buffers and expanded rows around a removal', () => {
    const onChange = vi.fn()
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'first' },
        { id: 'second', contextWindow: 2000 },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
          operations={operationsWithDiscovery(vi.fn())}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    // Open the second row (index 1) and type a capacity so its edit buffer is
    // keyed `1:contextWindow`.
    expandRow(2)
    const secondContext = screen.getByLabelText<HTMLInputElement>(`${en.modelContextWindow} 2`)
    fireEvent.change(secondContext, { target: { value: '2M' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'first' },
      { id: 'second', contextWindow: 2_000_000 },
    ])

    // Removing the first row shifts the second's buffer key down to `0:`.
    fireEvent.click(screen.getByLabelText(`${en.removeModel} 1`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'second', contextWindow: 2_000_000 }])
    // The surviving row still shows its typed text, carried across the removal.
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelContextWindow} 1`).value).toBe('2M')
  })

  it('keeps buffers and expanded rows before the removed index untouched', () => {
    const onChange = vi.fn()
    function Mount() {
      const [models, setModels] = useState<readonly ModelDraft[]>([
        { id: 'first', contextWindow: 1000 },
        { id: 'second' },
      ])
      return (
        <ModelListEditor
          models={models}
          onChange={(next) => { setModels(next); onChange(next) }}
          probe={{ provider: 'openai', settingsNs: 'llm-pi-ai' }}
          operations={operationsWithDiscovery(vi.fn())}
          t={t}
          disabled={false}
        />
      )
    }
    render(<Mount />)
    // A typed buffer on the first row (index 0) and an open disclosure on it
    // both sit before the removed second row (index 1), so they stay put.
    expandRow(1)
    const firstContext = screen.getByLabelText<HTMLInputElement>(`${en.modelContextWindow} 1`)
    fireEvent.change(firstContext, { target: { value: '8K' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'first', contextWindow: 8_000 },
      { id: 'second' },
    ])

    fireEvent.click(screen.getByLabelText(`${en.removeModel} 2`))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'first', contextWindow: 8_000 }])
    // The first row keeps its disclosure open and its typed text.
    expect(screen.getByLabelText(`${en.modelAdvanced} 1`).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelContextWindow} 1`).value).toBe('8K')
  })

  it('adds a row, inherits when not overridden, and resets an override', () => {
    const onChange = vi.fn()
    const onReset = vi.fn()
    mountListEditor({
      models: [],
      overridden: true,
      onReset,
      onChange,
      operations: operationsWithDiscovery(vi.fn()),
    })
    fireEvent.click(screen.getByText(en.addModel))
    expect(onChange).toHaveBeenLastCalledWith([{ id: '' }])
    fireEvent.click(screen.getByText(en.resetModels))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('shows the inherited meta and disables every control when disabled or not overridden', () => {
    mountListEditor({
      models: [{ id: 'one' }],
      overridden: false,
      disabled: true,
      onChange: vi.fn(),
      operations: operationsWithDiscovery(vi.fn()),
    })
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    const id = screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`)
    expect(id.disabled).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.fetchModels).disabled).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.addModel).disabled).toBe(true)
  })
})

describe('ReasoningLevelCheckboxes', () => {
  /** Mount with real local state so checkbox toggles round-trip. */
  function mountCheckboxes(
    value: ReasoningEffortsValue | undefined,
    opts: {
      levels?: readonly ReasoningLevel[]
      suggested?: readonly ReasoningLevel[] | undefined
      disabled?: boolean
      onChange?: (v: ReasoningEffortsValue | undefined) => void
    } = {},
  ): ReturnType<typeof vi.fn> {
    const onChange = (opts.onChange ?? vi.fn()) as ReturnType<typeof vi.fn>
    function Mount() {
      const [current, setCurrent] = useState<ReasoningEffortsValue | undefined>(value)
      return (
        <ReasoningLevelCheckboxes
          value={current}
          levels={opts.levels ?? THINKING_LEVELS}
          suggested={opts.suggested}
          index={0}
          disabled={opts.disabled ?? false}
          onChange={(next) => { setCurrent(next); (onChange as (v: ReasoningEffortsValue | undefined) => void)(next) }}
          t={t}
        />
      )
    }
    render(<Mount />)
    return onChange
  }

  it('offers the advisory hint only when a non-empty suggestion list is present', () => {
    const { unmount } = render(
      <ReasoningLevelCheckboxes
        value={undefined}
        levels={THINKING_LEVELS}
        suggested={undefined}
        index={0}
        disabled={false}
        onChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.queryByText(en.reasoningLevelsSuggestion)).toBeNull()
    unmount()

    render(
      <ReasoningLevelCheckboxes
        value={undefined}
        levels={THINKING_LEVELS}
        suggested={[]}
        index={0}
        disabled={false}
        onChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.queryByText(en.reasoningLevelsSuggestion)).toBeNull()
  })

  it('shows the hint text when a non-empty suggestion list is present', () => {
    mountCheckboxes(undefined, { suggested: ['low', 'high'] })
    expect(screen.getByText(`${en.reasoningLevelsSuggestion}low, high`)).toBeTruthy()
  })

  it('disables the level group when the declaration is false but keeps the disable control live', () => {
    mountCheckboxes(false)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 off`).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 low`).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 max`).disabled).toBe(true)
    const off = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningOff} 1`)
    expect(off.disabled).toBe(false)
    expect(off.checked).toBe(true)
  })

  it('disables every control when disabled', () => {
    mountCheckboxes(undefined, { disabled: true })
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 max`).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningOff} 1`).disabled).toBe(true)
  })

  it('toggles a level and back to false when the last level is removed', () => {
    const onChange = mountCheckboxes(undefined)
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 medium`))
    expect(onChange).toHaveBeenLastCalledWith({ medium: 'medium' })
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 medium`).checked).toBe(true)
    fireEvent.click(screen.getByLabelText(`${en.modelReasoningLevels} 1 medium`))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('sets and clears the disable declaration through its control', () => {
    const onChange = mountCheckboxes(undefined)
    const off = screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningOff} 1`)
    fireEvent.click(off)
    expect(onChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(off)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('reads a malformed array as showing no checked level', () => {
    mountCheckboxes(['not-a-map'] as unknown as ReasoningEffortsValue)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 high`).checked).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 off`).checked).toBe(false)
  })

  it('checks the levels present in a real declaration', () => {
    mountCheckboxes({ high: 'ultra', off: null })
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 high`).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 off`).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelReasoningLevels} 1 minimal`).checked).toBe(false)
  })
})
