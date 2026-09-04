/**
 * The describe-image card's controller: credential reads against the
 * section-named reference, stale-answer dropping, and the write-then-reread
 * key path.
 */

import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  DescribeImageCardController,
  type DescribeImageSettings,
  type CredentialWire,
} from '../src/client/describe-image-card-controller.ts'

function wire(configured: boolean): CredentialWire & { describe: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  const describe = vi.fn(() => Promise.resolve({
    result: {
      ok: true as const,
      value: { credentials: { VISION_API_KEY: { configured } } },
    },
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const }))
  return { describe, set }
}

describe('DescribeImageCardController', () => {
  it('reads the credential state for the section reference', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(true)
    const controller = new DescribeImageCardController(host.scope, api)
    const state = () => controller.inject().hooks.describeImageCard.getSnapshot()

    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalledWith({ refs: ['VISION_API_KEY'] }) })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://vision.test/v1' }, user: {} })
    await vi.waitFor(() => { expect(state().apiKeyConfigured).toBe(true) })

    expect(state()).toMatchObject({
      baseURL: { text: 'https://vision.test/v1', overridden: false },
      apiKey: { text: '', overridden: false },
    })
  })

  it('keeps the card usable when the credential read fails', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(false)
    api.describe.mockRejectedValue(new Error('host down'))
    const controller = new DescribeImageCardController(host.scope, api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })

    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    expect(controller.inject().hooks.describeImageCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: false,
      apiKeyWritable: true,
    })
  })

  it('treats an unsuccessful describe as no answer', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(true)
    api.describe.mockResolvedValue({ result: { ok: false as const, value: undefined } })
    const controller = new DescribeImageCardController(host.scope, api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })

    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    expect(controller.inject().hooks.describeImageCard.getSnapshot().apiKeyConfigured).toBe(false)
  })

  it('drops a response that no longer answers for the reference in force', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    let resolveFirst: (value: Awaited<ReturnType<CredentialWire['describe']>>) => void = () => {}
    const first = new Promise<Awaited<ReturnType<CredentialWire['describe']>>>((resolve) => { resolveFirst = resolve })
    const api = wire(false)
    api.describe.mockReturnValueOnce(first)
    const controller = new DescribeImageCardController(host.scope, api)
    const state = () => controller.inject().hooks.describeImageCard.getSnapshot()

    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalledTimes(1) })
    // The section renames the reference while the first read is in flight.
    host.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'OTHER_VISION_KEY' }, user: {} })
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalledTimes(2) })

    resolveFirst({
      result: {
        ok: true as const,
        value: { credentials: { VISION_API_KEY: { configured: true } } },
      },
    })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(state().apiKeyConfigured).toBe(false)
  })

  it('skips the publish when the answer repeats the current state', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(false)
    const controller = new DescribeImageCardController(host.scope, api)
    const state = () => controller.inject().hooks.describeImageCard.getSnapshot()
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    const seen: boolean[] = []
    controller.inject().hooks.describeImageCard.subscribe(() => { seen.push(state().apiKeyConfigured) })

    // The repeated answer (still false) must not republish; the scope-driven
    // form publish is the only subscriber event.
    controller.refreshCredential('VISION_API_KEY')
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(seen).toEqual([])
  })

  it('re-reads on refresh only for the watched reference', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(false)
    const controller = new DescribeImageCardController(host.scope, api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    api.describe.mockClear()

    controller.refreshCredential('OTHER_KEY')
    expect(api.describe).not.toHaveBeenCalled()

    api.describe.mockResolvedValue({
      result: { ok: true as const, value: { credentials: { VISION_API_KEY: { configured: true } } } },
    })
    controller.refreshCredential('VISION_API_KEY')
    await vi.waitFor(() => {
      expect(controller.inject().hooks.describeImageCard.getSnapshot().apiKeyConfigured).toBe(true)
    })
  })

  it('writes the staged key through the credentials domain and returns the re-read state', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(false)
    const controller = new DescribeImageCardController(host.scope, api)
    host.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'SECTION_KEY' }, user: {} })
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    api.describe.mockResolvedValue({
      result: { ok: true as const, value: { credentials: { SECTION_KEY: { configured: true } } } },
    })
    const face = controller.inject()

    face.edit('apiKey', 'vision-secret')
    face.save()
    await vi.waitFor(() => { expect(api.set).toHaveBeenCalled() })

    expect(api.set).toHaveBeenCalledWith({ ref: 'SECTION_KEY', value: 'vision-secret' })
    await vi.waitFor(() => { expect(face.hooks.describeImageCard.getSnapshot().apiKeyConfigured).toBe(true) })
  })

  it('re-reads after a rejected write and reports the authority state', async () => {
    const host = stubSettingsScope<DescribeImageSettings>()
    const api = wire(false)
    api.set.mockRejectedValue(new Error('host refused'))
    const controller = new DescribeImageCardController(host.scope, api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    const face = controller.inject()

    face.edit('apiKey', 'vision-secret')
    face.save()
    await vi.waitFor(() => { expect(api.set).toHaveBeenCalled() })

    // The Host stays the authority: the re-read answer is what the save reports.
    await vi.waitFor(() => { expect(face.hooks.describeImageCard.getSnapshot().apiKeyConfigured).toBe(false) })
  })
})
