/**
 * Product version caption: a muted, click-through line pinned to the
 * viewport's bottom-right corner so a user who downloaded the app can tell
 * which version is running. Shell chrome in the same sense as the title bar
 * and document title — pure presentation, no subscriptions, no services.
 * Reads the version through {@link appVersion} (desktop bridge first, then the
 * host boot graph) and renders nothing when neither carrier has one.
 */
import { appVersion } from './app-version.ts'
import css from './VersionCaption.module.css'

/**
 * Render the bottom-right version caption.
 * @returns the caption element, or null when no version is available.
 */
export function VersionCaption() {
  const version = appVersion()
  if (version === undefined) return null
  return <div className={css.caption}>{`V${version}`}</div>
}
