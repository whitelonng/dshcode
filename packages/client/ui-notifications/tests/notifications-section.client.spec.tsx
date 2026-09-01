// @ts-nocheck -- alpha.4 sync: product test migration pending
// @vitest-environment jsdom
/**
 * NotificationsSection behavior: the two toggle switches drive the injected
 * callbacks with the inverted state, and the permission row renders the
 * environment state with a request/retry action exactly when one applies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { createNotificationsSectionStore } from '../src/client/notifications-store.ts'
import type { NotificationsSectionState } from '../src/client/notifications-store.ts'
import {
  NotificationsSection, type NotificationsSectionProps,
} from '../src/client/NotificationsSection.tsx'

const t = makeTranslate(zh) as NotificationsSectionProps['t']

afterEach(cleanup)

function bench(state: Partial<NotificationsSectionState> = {}) {
  const handle = createNotificationsSectionStore()
  const instance = handle.create()
  instance.actions.sync({
    settingsStatus: 'ready',
    approvals: true,
    completions: true,
    permission: 'granted',
    ...state,
  })
  const setApprovals = vi.fn()
  const setCompletions = vi.fn()
  const requestPermission = vi.fn()
  const props: NotificationsSectionProps = {
    t,
    useStore: selector => selector(instance.getSnapshot()),
    actions: instance.actions,
    setApprovals,
    setCompletions,
    requestPermission,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
  }
  return { instance, props, setApprovals, setCompletions, requestPermission }
}

describe('NotificationsSection toggles', () => {
  it('renders the row title and both toggles from the store state', () => {
    const { props } = bench({ approvals: true, completions: false })
    render(<NotificationsSection {...props} />)
    expect(screen.getByText('系统通知')).toBeTruthy()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0]!.getAttribute('aria-checked')).toBe('true')
    expect(switches[1]!.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('授权通知')).toBeTruthy()
    expect(screen.getByText('任务完成通知')).toBeTruthy()
  })

  it('drives the injected callbacks with the inverted state on click', () => {
    const { props, setApprovals, setCompletions } = bench({ approvals: true, completions: true })
    render(<NotificationsSection {...props} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0]!)
    expect(setApprovals).toHaveBeenCalledWith(false)
    fireEvent.click(switches[1]!)
    expect(setCompletions).toHaveBeenCalledWith(false)
  })
})

describe('NotificationsSection permission row', () => {
  it('shows the granted state without an action', () => {
    const { props } = bench({ permission: 'granted' })
    render(<NotificationsSection {...props} />)
    expect(screen.getByText('系统通知权限已开启')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '开启' })).toBeNull()
  })

  it('offers the request action on the default state', () => {
    const { props, requestPermission } = bench({ permission: 'default' })
    render(<NotificationsSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '开启' }))
    expect(requestPermission).toHaveBeenCalledOnce()
  })

  it('offers the retry action on the denied state', () => {
    const { props, requestPermission } = bench({ permission: 'denied' })
    render(<NotificationsSection {...props} />)
    expect(screen.getByText('系统通知权限已被拒绝')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(requestPermission).toHaveBeenCalledOnce()
  })

  it('renders the requesting and unsupported states without an action', () => {
    const requesting = bench({ permission: 'requesting' })
    render(<NotificationsSection {...requesting.props} />)
    expect(screen.getByText('正在请求权限…')).toBeTruthy()
    cleanup()

    const unsupported = bench({ permission: 'unsupported' })
    render(<NotificationsSection {...unsupported.props} />)
    expect(screen.getByText('当前环境不支持系统通知')).toBeTruthy()
    expect(unsupported.requestPermission).not.toHaveBeenCalled()
  })
})
