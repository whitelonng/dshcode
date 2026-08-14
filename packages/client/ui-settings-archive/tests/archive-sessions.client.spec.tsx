// @vitest-environment jsdom
/**
 * ArchiveSessionsSection presentation smoke: loading → list, restore and
 * permanent-delete flows (with confirmation), error and empty states. The
 * component receives the injected wire face as plain props; behavior is
 * asserted through user-visible copy and calls on the stubbed face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ArchiveSessionsSection, type ArchiveSessionsSectionProps } from '../src/client/ArchiveSessionsSection.tsx'

afterEach(cleanup)

const t = (key: string, params?: { time?: string; reason?: string }): string => {
  const copy: Record<string, string> = {
    loading: '正在加载归档…',
    empty: '没有归档的对话。删除工作区中的会话会先归档到这里。',
    loadError: '加载归档失败，请重试。',
    untitled: '未命名会话',
    restore: '恢复',
    delete: '彻底删除',
    deleteConfirmTitle: '彻底删除会话',
    deleteConfirmBody: '删除后会话日志将永久移除，无法恢复。附件文件可能仍占用存储空间。',
    deleteConfirm: '确认删除',
    cancel: '取消',
    created: '创建于 {time}',
    restoreFailed: '恢复失败：{reason}',
    deleteFailed: '删除失败：{reason}',
  }
  let text = copy[key] ?? key
  if (params !== undefined) {
    text = text.replace('{time}', params.time ?? '').replace('{reason}', params.reason ?? '')
  }
  return text
}

function mount(overrides: Partial<ArchiveSessionsSectionProps> = {}) {
  const list = vi.fn().mockResolvedValue([
    { sessionId: 's-archived', title: '归档对话', createdAt: 1_700_000_000_000 },
    { sessionId: 's-untitled' },
  ])
  const restore = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  const props: ArchiveSessionsSectionProps = {
    t,
    list,
    restore,
    remove,
    ...overrides,
  } as never
  const utils = render(<ArchiveSessionsSection {...props} />)
  return { list, restore, remove, ...utils }
}

describe('ArchiveSessionsSection', () => {
  it('lists archived sessions with titles and creation times', async () => {
    const { list } = mount()
    expect(await screen.findByText('归档对话')).toBeTruthy()
    expect(screen.getByText('s-archived')).toBeTruthy()
    expect(screen.getByText(/创建于/)).toBeTruthy()
    expect(screen.getByText('未命名会话')).toBeTruthy()
    expect(list).toHaveBeenCalledOnce()
  })

  it('restores a session and refreshes the list', async () => {
    const { list, restore } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getAllByText('恢复')[0]!.click() })
    await waitFor(() => { expect(restore).toHaveBeenCalledWith('s-archived') })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('requires confirmation before a permanent delete and refreshes afterwards', async () => {
    const { list, remove } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getAllByText('彻底删除')[0]!.click() })
    expect(await screen.findByText('确认删除')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()

    act(() => { screen.getByText('确认删除').click() })
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('s-archived') })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('cancelling the confirmation deletes nothing', async () => {
    const { remove } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getAllByText('彻底删除')[0]!.click() })
    await screen.findByText('确认删除')
    act(() => { screen.getByText('取消').click() })
    await waitFor(() => { expect(remove).not.toHaveBeenCalled() })
  })

  it('surfaces mutation failures and keeps the row', async () => {
    const { remove } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getAllByText('彻底删除')[0]!.click() })
    remove.mockRejectedValueOnce(new Error('boom'))
    await screen.findByText('确认删除')
    act(() => { screen.getByText('确认删除').click() })
    expect(await screen.findByText('删除失败：boom')).toBeTruthy()
    expect(screen.getByText('归档对话')).toBeTruthy()
  })

  it('renders the empty state and the load-error state', async () => {
    const empty = mount({ list: vi.fn().mockResolvedValue([]) })
    expect(await empty.findByText('没有归档的对话。删除工作区中的会话会先归档到这里。')).toBeTruthy()
    cleanup()

    const failed = mount({ list: vi.fn().mockRejectedValue(new Error('down')) })
    expect(await failed.findByText('加载归档失败，请重试。')).toBeTruthy()
  })
})
