/**
 * The `settings.plugin.item` slot type — one plugin's card inside the plugin
 * configuration section. Options: `id` (card key), `order` (card position).
 * A card draws its own internals; the section only stacks them and reports
 * how many there are.
 *
 * TYPE HOME RATIONALE: unlike `settings.general.item`, whose registrants span
 * packages that cannot reference its declarer, every current registrant of
 * this slot ships in this package, and a plugin registering its own card
 * already depends on this package for the card chrome. The type therefore
 * lives with the section that declares it at runtime.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (see module JSDoc). */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
