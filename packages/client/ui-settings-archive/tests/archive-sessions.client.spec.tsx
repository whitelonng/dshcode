// @vitest-environment jsdom
/**
 * ArchiveSessionsSection presentation smoke: loading → list, restore and
 * permanent-delete flows (with confirmation), error and empty states. The
 * component receives the injected wire face as plain props; behavior is
 * asserted through user-visible copy and calls on the stubbed face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ArchiveSessionsSection, type ArchiveSessionsSectionProps } from '../src/client/ArchiveSessionsSection.tsx'

afterEach(cleanup)

const t = (key: string, params?: { time?: string; reason?: string; count?: string; title?: string }): string => {
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
    search: '搜索归档会话',
    selectAll: '全选',
    selected: '已选 {count} 项',
    selectItem: '选择 {title}',
    restoreSelected: '恢复所选',
    deleteSelected: '删除所选',
    bulkRestoreConfirmBody: '将恢复 {count} 个会话到各自的工作区。',
    bulkDeleteConfirmBody: '将永久删除 {count} 个会话日志，无法恢复。附件文件可能仍占用存储空间。',
    emptySearch: '没有匹配的归档会话。',
  }
  let text = copy[key] ?? key
  if (params !== undefined) {
    text = text
      .replace('{time}', params.time ?? '')
      .replace('{reason}', params.reason ?? '')
      .replace('{count}', params.count ?? '')
      .replace('{title}', params.title ?? '')
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

  it('filters the list by title and session id through the search box', async () => {
    const utils = mount({
      list: vi.fn().mockResolvedValue([
        { sessionId: 's-alpha', title: '旅行计划', createdAt: 1_700_000_000_000 },
        { sessionId: 's-beta', title: '读书笔记', createdAt: 1_700_000_000_000 },
      ]),
    })
    await utils.findByText('旅行计划')
    expect(utils.getByText('读书笔记')).toBeTruthy()

    const input = utils.getByRole('searchbox', { name: '搜索归档会话' })
    act(() => { fireEvent.change(input, { target: { value: '旅行' } }) })
    expect(utils.queryByText('读书笔记')).toBeNull()
    expect(utils.getByText('旅行计划')).toBeTruthy()

    act(() => { fireEvent.change(input, { target: { value: 's-beta' } }) })
    expect(utils.queryByText('旅行计划')).toBeNull()
    expect(utils.getByText('读书笔记')).toBeTruthy()

    act(() => { fireEvent.change(input, { target: { value: '不存在' } }) })
    expect(await utils.findByText('没有匹配的归档会话。')).toBeTruthy()
  })

  it('selects all filtered rows and bulk-restores them without a modal', async () => {
    const { restore, list } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getByRole('checkbox', { name: '全选' }).click() })
    expect(await screen.findByText('已选 2 项')).toBeTruthy()
    act(() => { screen.getByText('恢复所选').click() })
    await waitFor(() => { expect(restore).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('bulk-deletes the selection only after confirmation', async () => {
    const { remove } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getByRole('checkbox', { name: '选择 归档对话' }).click() })
    expect(await screen.findByText('已选 1 项')).toBeTruthy()
    act(() => { screen.getByText('删除所选').click() })
    expect(await screen.findByText('将永久删除 1 个会话日志，无法恢复。附件文件可能仍占用存储空间。')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    act(() => { screen.getByText('取消').click() })
    await waitFor(() => { expect(remove).not.toHaveBeenCalled() })

    act(() => { screen.getByText('删除所选').click() })
    await screen.findByText('确认删除')
    act(() => { screen.getByText('确认删除').click() })
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('s-archived') })
  })

  it('surfaces a bulk failure without clearing the selection', async () => {
    const { restore } = mount()
    await screen.findByText('归档对话')
    act(() => { screen.getByRole('checkbox', { name: '全选' }).click() })
    await screen.findByText('已选 2 项')
    restore.mockRejectedValueOnce(new Error('locked'))
    act(() => { screen.getByText('恢复所选').click() })
    expect(await screen.findByText('恢复失败：locked')).toBeTruthy()
  })
})
