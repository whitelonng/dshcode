/** State owner for the optional local settings-document action. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Browser state of the Host-owned settings document. */
export interface SettingsDocumentState {
  /** Metadata-loading phase; unavailable means the provider has no local document or the read failed. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Whether one native-open request is in flight. */
  opening: boolean
  /** Last metadata/native-open diagnostic; UI exposes only localized copy. */
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Derives local-document availability from the shared mirror and invokes the pathless Host-owned open operation. */
export class SettingsDocumentStore {
  /** uSES-safe state source shared by the registered header action. */
  readonly store: SnapshotStore<SettingsDocumentState> = createSnapshotStore({
    status: 'idle', opening: false, error: null,
  })

  private following: (() => void) | undefined

  /**
   * @param api - loopback settings wire face that opens the provider document.
   * @param describeFace - the shared mirror's describe face (`hasDocument` source).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings'>,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Begin following the mirror (idempotent) and reflect whether the current
   * provider owns a local document.
   * @returns settlement once the snapshot reflects the mirror.
   */
  async load(): Promise<void> {
    this.following ??= this.describeFace.subscribe(() => { this.derive() })
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    await this.describeFace.ensure()
    this.derive()
  }

  /**
   * Open the loaded document once; concurrent gestures collapse behind the in-flight action.
   * @returns after the native-open request settles, or immediately when unavailable/already opening.
   */
  async open(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.status !== 'ready' || current.opening) return
    this.store.update((state) => {
      state.opening = true
      state.error = null
    })
    try {
      const response = await this.api.settings.openDocument({})
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      this.store.update((state) => { state.error = messageOf(error) })
    } finally {
      this.store.update((state) => { state.opening = false })
    }
  }

  /** Stop following the mirror. */
  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    const mirrored = this.describeFace.getSnapshot()
    if (mirrored.view === undefined) {
      // A held failure with no answer means the document cannot be located;
      // without one the read is still in flight and loading stands.
      if (mirrored.error !== null) {
        this.store.update((state) => {
          state.status = 'unavailable'
          state.error = mirrored.error
        })
      }
      return
    }
    const { hasDocument } = mirrored.view
    this.store.update((state) => {
      state.status = hasDocument ? 'ready' : 'unavailable'
      state.error = null
    })
  }
}
