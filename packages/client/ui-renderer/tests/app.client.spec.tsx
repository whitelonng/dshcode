// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { buildRenderApp } from '../src/client/app.tsx'

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
  document.title = ''
  vi.unstubAllEnvs()
})

async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  return { runtime, renderApp: buildRenderApp({ ctx: runtime.ctx }) }
}

describe('buildRenderApp', () => {
  it('fails loud when the sessions service is unavailable', () => {
    expect(() => buildRenderApp({ ctx: new Context() })).toThrow('sessions service unavailable')
  })

  it('renders the root slot tree', async () => {
    const b = await bench()
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

  it('projects the selected durable session title', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    expect(document.title).toBe('First — Product')
    await b.runtime.sessions.setCurrent(undefined)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's2' })
    expect(document.title).toBe('Product')
  })

  it('falls back when the selected id has no list row', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('First — Product')
    b.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
    await b.runtime.flush()
    expect(document.title).toBe('Product')
  })
})
