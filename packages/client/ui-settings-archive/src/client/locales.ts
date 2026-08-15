/** Copy dictionaries for the archived-sessions Settings section. */

export const zh = {
  nav: '归档会话',
  loading: '正在加载归档…',
  empty: '没有归档的对话。删除工作区中的会话会先归档到这里。',
  loadError: '加载归档失败，请重试。',
  retry: '重试',
  untitled: '未命名会话',
  restore: '恢复',
  restoreFailed: '恢复失败：{reason}',
  delete: '彻底删除',
  deleteConfirmTitle: '彻底删除会话',
  deleteConfirmBody: '删除后会话日志将永久移除，无法恢复。附件文件可能仍占用存储空间。',
  deleteConfirm: '确认删除',
  cancel: '取消',
  deleteFailed: '删除失败：{reason}',
  created: '创建于 {time}',
  search: '搜索归档会话',
  selectAll: '全选',
  selected: '已选 {count} 项',
  selectItem: '选择 {title}',
  restoreSelected: '恢复所选',
  deleteSelected: '删除所选',
  bulkDeleteConfirmBody: '将永久删除 {count} 个会话日志，无法恢复。附件文件可能仍占用存储空间。',
  emptySearch: '没有匹配的归档会话。',
} satisfies Record<string, string>

/** English copy dictionary for the section. */
export const en = {
  nav: 'Archived sessions',
  loading: 'Loading archived sessions…',
  empty: 'No archived sessions. Deleting a conversation in the workspace archives it here first.',
  loadError: 'Failed to load archived sessions. Please retry.',
  retry: 'Retry',
  untitled: 'Untitled session',
  restore: 'Restore',
  restoreFailed: 'Restore failed: {reason}',
  delete: 'Delete permanently',
  deleteConfirmTitle: 'Delete session permanently',
  deleteConfirmBody: 'The session log will be removed permanently and cannot be recovered. Attachment files may still occupy storage.',
  deleteConfirm: 'Delete',
  cancel: 'Cancel',
  deleteFailed: 'Delete failed: {reason}',
  created: 'Created {time}',
  search: 'Search archived sessions',
  selectAll: 'Select all',
  selected: '{count} selected',
  selectItem: 'Select {title}',
  restoreSelected: 'Restore selected',
  deleteSelected: 'Delete selected',
  bulkDeleteConfirmBody: 'The logs of {count} sessions will be removed permanently and cannot be recovered. Attachment files may still occupy storage.',
  emptySearch: 'No archived sessions match the search.',
} satisfies Record<string, string>

/** Copy dictionary key for the section. */
export type ArchiveLocaleKey = keyof typeof zh
