// @vitest-environment jsdom
/**
 * Notification-sink platform seam: the browser sink over stubbed
 * window.Notification (permission states, grant/no-op dispatch, click
 * routing) and the desktop sink over a stubbed preload bridge (always
 * granted, id-echoed click dispatch), plus the feature-detect factory.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserNotificationSink, DesktopNotificationSink, createNotificationSink,
  type DesktopNotificationBridge,
} from '../src/client/notification-sink.ts'

type FakeNotificationApi = {
  permission: NotificationPermission
  requestPermission: ReturnType<typeof vi.fn>
  instances: Array<{ title: string; options: { body?: string }; onclick: (() => void) | null }>
}

function stubNotificationApi(permission: NotificationPermission): FakeNotificationApi {
  const instances: FakeNotificationApi['instances'] = []
  const api = class FakeNotification {
    static permission = permission
    static requestPermission = vi.fn(async () => permission)
    onclick: (() => void) | null = null
    constructor(public readonly title: string, public readonly options: { body?: string }) {
      instances.push(this)
    }
  }
  vi.stubGlobal('Notification', api)
  return { permission: api.permission, requestPermission: api.requestPermission, instances }
}

function clearNotificationApi(): void {
  vi.unstubAllGlobals()
}

function fakeBridge(): DesktopNotificationBridge & { clicks: Array<(id: string) => void>; notify: ReturnType<typeof vi.fn> } {
  const clicks: Array<(id: string) => void> = []
  return {
    clicks,
    notify: vi.fn((_request: { id: string; title: string; body?: string }) => {}),
    onNotificationClick: (listener) => {
      clicks.push(listener)
      return () => { clicks.splice(clicks.indexOf(listener), 1) }
    },
  }
}

afterEach(() => {
  clearNotificationApi()
  delete (window as unknown as { dshDesktop?: DesktopNotificationBridge }).dshDesktop
})

describe('BrowserNotificationSink', () => {
  it('degrades to unsupported without the Notification API and never dispatches', async () => {
    const sink = new BrowserNotificationSink()
    expect(sink.supported).toBe(false)
    expect(sink.permission()).toBe('unsupported')
    expect(() => { sink.show('t', 'b', vi.fn()) }).not.toThrow()
    await expect(sink.requestPermission()).resolves.toBe('unsupported')
  })

  it('reports the browser permission and forwards requestPermission', async () => {
    const api = stubNotificationApi('default')
    const sink = new BrowserNotificationSink()
    expect(sink.supported).toBe(true)
    expect(sink.permission()).toBe('default')
    api.requestPermission.mockResolvedValueOnce('granted')
    await expect(sink.requestPermission()).resolves.toBe('granted')
  })

  it('shows a notification with the given title and body only when granted', () => {
    const api = stubNotificationApi('granted')
    const sink = new BrowserNotificationSink()
    const onClick = vi.fn()
    sink.show('需要授权', 'title-s1', onClick)
    expect(api.instances).toHaveLength(1)
    expect(api.instances[0]).toMatchObject({ title: '需要授权', options: { body: 'title-s1' } })
    api.instances[0]!.onclick?.()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('no-ops show while the permission is not granted', () => {
    stubNotificationApi('denied')
    const sink = new BrowserNotificationSink()
    sink.show('t', 'b', vi.fn())
    expect(sink.permission()).toBe('denied')
  })
})

describe('DesktopNotificationSink', () => {
  it('always reports granted and forwards the request through the bridge', async () => {
    const bridge = fakeBridge()
    const sink = new DesktopNotificationSink(bridge)
    expect(sink.supported).toBe(true)
    expect(sink.permission()).toBe('granted')
    await expect(sink.requestPermission()).resolves.toBe('granted')
  })

  it('routes a bridge click to exactly the matching request id', () => {
    const bridge = fakeBridge()
    const sink = new DesktopNotificationSink(bridge)
    const first = vi.fn()
    const second = vi.fn()
    sink.show('t1', 'b1', first)
    sink.show('t2', 'b2', second)
    expect(bridge.notify).toHaveBeenCalledTimes(2)
    const [firstRequest, secondRequest] = bridge.notify.mock.calls.map(call => call[0] as { id: string })
    bridge.clicks[0]!(firstRequest!.id)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    bridge.clicks[0]!(secondRequest!.id)
    expect(second).toHaveBeenCalledOnce()
  })

  it('drops a click for an unknown id quietly', () => {
    const bridge = fakeBridge()
    const sink = new DesktopNotificationSink(bridge)
    const onClick = vi.fn()
    sink.show('t', 'b', onClick)
    bridge.clicks[0]!('unknown-id')
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('createNotificationSink', () => {
  it('prefers the desktop bridge when the shell exposed it', () => {
    const bridge = fakeBridge()
    ;(window as unknown as { dshDesktop?: DesktopNotificationBridge }).dshDesktop = bridge
    const sink = createNotificationSink()
    expect(sink.permission()).toBe('granted')
    sink.show('t', 'b', vi.fn())
    expect(bridge.notify).toHaveBeenCalledTimes(1)
  })

  it('falls back to the browser API without the bridge', () => {
    stubNotificationApi('granted')
    const sink = createNotificationSink()
    expect(sink.supported).toBe(true)
    expect(sink.permission()).toBe('granted')
  })

  it('reports unsupported when neither surface exists', () => {
    const sink = createNotificationSink()
    expect(sink.supported).toBe(false)
    expect(sink.permission()).toBe('unsupported')
  })
})
