/** Copy dictionary for the notifications feature (settings section + OS notification text). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.notifications'

/** Key union for the notifications dictionary. */
export type NotificationsKey =
  | 'row.title'
  | 'row.desc'
  | 'approvals.label'
  | 'approvals.desc'
  | 'completions.label'
  | 'completions.desc'
  | 'permission.granted'
  | 'permission.default'
  | 'permission.denied'
  | 'permission.unsupported'
  | 'permission.requesting'
  | 'permission.request'
  | 'permission.retry'
  | 'approval.title'
  | 'approval.title.tool'
  | 'completion.title'
  | 'completion.session.body'
  | 'completion.job.body'

/** Simplified Chinese copy (product default). */
export const zh: Record<NotificationsKey, string> = {
  'row.title': '系统通知',
  'row.desc': '授权等待与任务完成的系统级提醒',
  'approvals.label': '授权通知',
  'approvals.desc': '会话等待授权时弹出系统通知',
  'completions.label': '任务完成通知',
  'completions.desc': '会话或后台任务完成时弹出系统通知',
  'permission.granted': '系统通知权限已开启',
  'permission.default': '尚未授予系统通知权限',
  'permission.denied': '系统通知权限已被拒绝',
  'permission.unsupported': '当前环境不支持系统通知',
  'permission.requesting': '正在请求权限…',
  'permission.request': '开启',
  'permission.retry': '重试',
  'approval.title': '需要授权',
  'approval.title.tool': '需要授权：{toolName}',
  'completion.title': '任务完成',
  'completion.session.body': '会话「{title}」已完成运行',
  'completion.job.body': '任务「{label}」已完成',
}

/** English copy. */
export const en: Record<NotificationsKey, string> = {
  'row.title': 'System notifications',
  'row.desc': 'System-level alerts for approval waits and task completion',
  'approvals.label': 'Approval notifications',
  'approvals.desc': 'Show a system notification when a session is waiting for approval',
  'completions.label': 'Task completion notifications',
  'completions.desc': 'Show a system notification when a session or background task finishes',
  'permission.granted': 'System notification permission is granted',
  'permission.default': 'System notification permission has not been granted yet',
  'permission.denied': 'System notification permission was denied',
  'permission.unsupported': 'System notifications are not supported in this environment',
  'permission.requesting': 'Requesting permission…',
  'permission.request': 'Enable',
  'permission.retry': 'Retry',
  'approval.title': 'Approval needed',
  'approval.title.tool': 'Approval needed: {toolName}',
  'completion.title': 'Task complete',
  'completion.session.body': 'Session "{title}" finished running',
  'completion.job.body': 'Task "{label}" finished',
}
