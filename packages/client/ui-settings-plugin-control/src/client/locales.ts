/** Copy dictionaries for the plugin-control Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件开关',
  heading: '内置插件',
  description: '开关会保存到当前配置；重启 DSH 后装载或卸载对应插件。',
  loading: '正在读取插件状态…',
  error: '暂时无法读取插件开关。',
  retry: '重试',
  empty: '当前配置没有可控制的插件。',
  localOnlyTitle: '仅限本机操作',
  localOnlyBody: '为了保护主机配置，插件开关只能从本机打开。',
  source: '查看源码',
  enabled: '已开启',
  disabled: '已关闭',
  mixed: '部分开启',
  unavailable: '不可用',
  enableSwitch: '开启 {name}',
  disableSwitch: '关闭 {name}',
  applying: '正在应用更改…',
  restartHint: '更改已保存，请重启 DSH 使其生效。',
  updateError: '更改未能应用，请重试。',
} satisfies Record<string, string>

/** Plugin-control locale key union. */
export type PluginControlLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin switches',
  heading: 'Built-in plugins',
  description: 'Switches are saved to the current profile; restart DSH to mount or unmount the corresponding plugins.',
  loading: 'Reading plugin states…',
  error: 'Plugin switches are temporarily unavailable.',
  retry: 'Retry',
  empty: 'This profile has no controllable plugins.',
  localOnlyTitle: 'Available on this computer only',
  localOnlyBody: 'To protect host configuration, plugin switches can only be changed from a local browser.',
  source: 'View source',
  enabled: 'On',
  disabled: 'Off',
  mixed: 'Partially on',
  unavailable: 'Unavailable',
  enableSwitch: 'Turn on {name}',
  disableSwitch: 'Turn off {name}',
  applying: 'Applying change…',
  restartHint: 'The change is saved. Restart DSH for it to take effect.',
  updateError: 'The change could not be applied. Try again.',
} satisfies Record<PluginControlLocaleKey, string>
