/** Local copies of the trigger contract types the composer machine consumes.
 * Kept package-local to break the conversation<->trigger reference cycle;
 * stay structurally identical to @deepseek-ai/dsh-client-ui-input-trigger.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Draft-span CAS material: integrity-watched range plus the draft revision it belongs to. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Keyboard gestures the open menu arbitrates; everything else passes to the composer. */
export type ArbitrateKey = 'up' | 'down' | 'enter' | 'tab' | 'escape'

/** Arbitration result: `consumed` handled the key, `pick-highlighted` settled a pick, `pass` left it to the browser. */
export type ArbitrateOutcome = 'consumed' | 'pick-highlighted' | 'pass'

/** Claim the composer grants a command source while its leading token remains unbroken. */
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

/** Reference a source inserts into the draft, e.g. `@session` or `/file`. */
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

/** Serialized image the composer hands a command source when its claim allows images. */
export interface SubmitImageAttachment {
  /** Declared media type; the host verifies it against the decoded bytes. */
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Canonical base64 encoding of the image bytes. */
  readonly data: string
  /** Optional display name; never interpreted as a path. */
  readonly name?: string
}

/** Submit result a command claim returns through the scoped input event. */
export interface SubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** Request the composer resolves against the token the claim still owns. */
export interface ConsumeTokenRequest {
  readonly guard:
    | { readonly kind: 'span'; readonly span: TokenSpan }
    | { readonly kind: 'bare-token'; readonly token: string }
}

/** What a pick resolves into: a claim, a reference insert, inserted text, or explicit handling. */
export type PickOutcome =
  | { readonly claim: CommandClaim }
  | { readonly insert: ReferenceInsert }
  | { readonly text: string; readonly continue?: boolean }
  | 'handled'
  | undefined
