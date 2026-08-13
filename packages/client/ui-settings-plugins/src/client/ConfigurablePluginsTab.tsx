/** Configurable Host plugins contributed to the shared Plugins section. */

import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slot-contract.ts'
import css from './PluginsSettingsSection.module.css'

/** Registration-side business face for the configurable tab. */
export interface ConfigurablePluginsTabInjected {
  /** How many cards the slot ledger held when the tab registration mounted. */
  cardCount: number
}

/** Props the renderer binds for the configurable tab. */
export type ConfigurablePluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.item'>
  & InjectFace<ConfigurablePluginsTabInjected>

/** Render cards registered by plugins that expose editable settings. */
export function ConfigurablePluginsTab({ t, renderSlot, cardCount }: ConfigurablePluginsTabProps) {
  return cardCount === 0
    ? <p className={css.empty}>{t('empty')}</p>
    : <ul className={css.cards}>{renderSlot('settings.plugin.item', {})}</ul>
}
