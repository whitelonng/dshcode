/** Copy dictionaries for the plugin-installer Settings tab. */

export const zh = {
  tab: '安装与更新',
  installPlaceholder: 'npm 包名（如 @scope/name）或 git 仓库 URL',
  install: '安装',
  installing: '安装中…',
  empty: '尚未安装任何用户插件。',
  version: '已安装 {version}',
  latest: '最新 {version}',
  updateAvailable: '有新版本',
  update: '更新',
  updating: '更新中…',
  uninstall: '卸载',
  uninstalling: '卸载中…',
  uninstallConfirmTitle: '卸载插件',
  uninstallConfirmBody: '将删除 {name} 的安装目录与配置行，并在重启后生效。',
  confirm: '确认卸载',
  cancel: '取消',
  checkUpdates: '检查更新',
  checking: '检查中…',
  noUpdates: '所有插件都是最新版本。',
  restartHint: '插件变更将在重启应用后生效。',
  restart: '重启应用',
  failed: '操作失败：{reason}',
  installHint: '安装会写入当前 profile 的 patch 层；应用重启后插件生效。',
} satisfies Record<string, string>

/** English copy dictionary for the tab. */
export const en = {
  tab: 'Install & update',
  installPlaceholder: 'npm package (e.g. @scope/name) or git repository URL',
  install: 'Install',
  installing: 'Installing…',
  empty: 'No user plugins installed yet.',
  version: 'Installed {version}',
  latest: 'Latest {version}',
  updateAvailable: 'Update available',
  update: 'Update',
  updating: 'Updating…',
  uninstall: 'Uninstall',
  uninstalling: 'Uninstalling…',
  uninstallConfirmTitle: 'Uninstall plugin',
  uninstallConfirmBody: '{name} and its configuration row will be removed; the change applies after a restart.',
  confirm: 'Uninstall',
  cancel: 'Cancel',
  checkUpdates: 'Check for updates',
  checking: 'Checking…',
  noUpdates: 'All plugins are up to date.',
  restartHint: 'Plugin changes take effect after restarting the application.',
  restart: 'Restart application',
  failed: 'Operation failed: {reason}',
  installHint: 'Installs write to the current profile patch layer; plugins load after a restart.',
} satisfies Record<string, string>

/** Copy dictionary key for the tab. */
export type PluginInstallerLocaleKey = keyof typeof zh
