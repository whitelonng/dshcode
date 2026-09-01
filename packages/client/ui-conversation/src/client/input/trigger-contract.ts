/** Local copies of the trigger contract types the composer machine consumes.
 * Kept package-local to break the conversation<->trigger reference cycle;
 * stay structurally identical to @deepseek-ai/dsh-client-ui-input-trigger.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export type ArbitrateKey = 'up' | 'down' | 'enter' | 'tab' | 'escape'

export type ArbitrateOutcome = 'consumed' | 'pick-highlighted' | 'pass'

export interface CommandClaim {
  /** Integrity-watched draft prefix, e.g. `'/goal '` — breaking startsWith releases the claim. */
  readonly token: string
  /** Ghost-text hint rendered while the claim's args are blank. */
  readonly hint?: string
  /**
   * Whether composer image attachments may accompany this command's submit.
   * Absent = the composer refuses to submit while images are attached, keeping
   * the draft and the images in place behind a visible notice.
   */
  readonly images?: boolean
  /**
   * Enter transaction, supplied by the source as a closure.
   * @param images - serialized composer images accompanying the submission;
   *   the composer passes them only when {@link CommandClaim.images} is true.
   */
  submit(args: string, actx: ClientContext, images: readonly SubmitImageAttachment[]): Promise<SubmitOutcome>
}

export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  /** Inline display label (fallback-cached on the occurrence). */
  readonly label: string
  /** Optional domain glyph shown beside the label. */
  readonly appearance?: 'session' | 'file' | 'folder'
  /** Clipboard / persistence projection, e.g. `/name` (never the model form). */
  readonly clipboardText: string
}

export interface SubmitImageAttachment {
  /** Declared media type; the host verifies it against the decoded bytes. */
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Canonical base64 encoding of the image bytes. */
  readonly data: string
  /** Optional display name; never interpreted as a path. */
  readonly name?: string
}

export interface SubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

export interface ConsumeTokenRequest {
  readonly guard:
    | { readonly kind: 'span'; readonly span: TokenSpan }
    | { readonly kind: 'bare-token'; readonly token: string }
}

export type PickOutcome =
  | { readonly claim: CommandClaim }
  | { readonly insert: ReferenceInsert }
  | { readonly text: string; readonly continue?: boolean }
  | 'handled'
  | undefined
