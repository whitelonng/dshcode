/**
 * Reasoning-effort declarations for user-owned models: the text spelling
 * (`high: high, max: ultra`) ↔ the settings value (`false` or a
 * level→wire-spelling map), plus the adapter-level validation guard.
 * Levels mirror pi-ai's canonical set; the wire spelling is opaque.
 * @module @deepseek-ai/dsh-client-ui-settings-models/reasoning-efforts
 */

/** Every pi-ai thinking level a declaration may name, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One level key of a reasoning-effort declaration. */
export type ReasoningLevel = (typeof THINKING_LEVELS)[number]

/** The settings value a declaration produces: disable, or level→spelling. */
export type ReasoningEffortsValue = false | Partial<Record<ReasoningLevel, string | null>>

/** Sentinel the editor stores while its text is unreadable (like NaN for counts). */
export const INVALID_EFFORTS = 'invalid'

/** Parse one text field into a declaration. */
export type ReasoningEffortsParse =
  | { readonly ok: true; readonly value: ReasoningEffortsValue | undefined }
  | { readonly ok: false }

/**
 * Parse the text spelling of a reasoning-effort declaration.
 * Empty text means "not declared". Entries are `level: spelling` pairs,
 * comma-separated; `off` accepts an empty spelling (`off:` or bare `off`),
 * every other level needs a non-empty wire spelling.
 * @param text - the field text.
 * @returns the parsed value, or a refusal for unreadable text.
 */
export function parseReasoningEfforts(text: string): ReasoningEffortsParse {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: true, value: undefined }
  const value: Partial<Record<ReasoningLevel, string | null>> = {}
  for (const raw of trimmed.split(',')) {
    const entry = raw.trim()
    if (entry.length === 0) return { ok: false }
    const colon = entry.indexOf(':')
    const level = (colon === -1 ? entry : entry.slice(0, colon)).trim()
    if (!THINKING_LEVELS.includes(level as ReasoningLevel)) return { ok: false }
    if (colon === -1) {
      // A bare level: only `off` may appear without a spelling.
      if (level !== 'off') return { ok: false }
      value.off = null
      continue
    }
    const spelling = entry.slice(colon + 1).trim()
    if (level === 'off') {
      value.off = spelling.length === 0 ? null : spelling
      continue
    }
    if (spelling.length === 0) return { ok: false }
    value[level as ReasoningLevel] = spelling
  }
  return { ok: true, value }
}

/**
 * Spell a declaration back into field text.
 * @param value - the settings value, or undefined while not declared.
 * @returns the text; empty when nothing is declared.
 */
export function formatReasoningEfforts(value: ReasoningEffortsValue | undefined): string {
  if (value === undefined || value === false) return ''
  return Object.entries(value)
    .map(([level, spelling]) => spelling === null ? level : `${level}: ${spelling}`)
    .join(', ')
}

/**
 * Guard a stored reasoning-efforts value the adapter would reject: the
 * editor's invalid sentinel, an unknown level, or an empty non-off spelling.
 * Mirrors the adapter-side rule that a map offering no level beyond `off`
 * must be spelled `false` instead.
 * @param value - the model's `reasoningEfforts` field.
 * @returns whether the adapter will accept it.
 */
export function validReasoningEfforts(value: unknown): boolean {
  if (value === undefined || value === false || value === INVALID_EFFORTS) return value !== INVALID_EFFORTS
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [level, spelling] of entries) {
    if (!THINKING_LEVELS.includes(level as ReasoningLevel)) return false
    if (level !== 'off' && (typeof spelling !== 'string' || spelling.length === 0)) return false
  }
  return entries.some(([level]) => level !== 'off')
}

/**
 * The wire spelling a checkbox gives a level that has none stored yet. Every
 * level defaults to its own name — pi-ai's dispatch sends the level as the
 * parameter value, and DeepSeek's `reasoning_effort` literals are the level
 * names too — except `off`, whose protocol-correct spelling is empty
 * ("supported, send nothing").
 * @param level - the level being offered.
 * @returns the spelling to store.
 */
export function defaultWireSpelling(level: ReasoningLevel): string | null {
  return level === 'off' ? null : level
}

/**
 * Toggle one level in a reasoning-effort declaration. Checking adds the level
 * with its existing wire spelling, or the protocol default when newly
 * offered; unchecking removes it. Unchecking the last level yields `false` —
 * the adapter's spelling of a non-reasoning model. A disabled value (`false`)
 * is not toggleable here; the caller disables the group.
 * @param value - the stored declaration, or undefined while not declared.
 * @param level - the level to toggle.
 * @returns the next declaration.
 */
export function toggleReasoningLevel(
  value: ReasoningEffortsValue | undefined,
  level: ReasoningLevel,
): ReasoningEffortsValue {
  // Anything that is not a map — `false`, the invalid sentinel, a malformed
  // draft — toggles from nothing.
  const current = value === undefined || value === false || typeof value !== 'object' ? {} : value
  if (level in current) {
    const { [level]: _dropped, ...rest } = current
    return Object.keys(rest).length === 0 ? false : rest
  }
  return { ...current, [level]: defaultWireSpelling(level) }
}

/**
 * The levels a protocol family commonly offers, shown as a hint beside the
 * checkbox group. Advisory only: the group stays fully selectable, and a
 * protocol with no mapped family yields nothing.
 * @param api - the route's wire protocol, when the profile names one.
 * @returns the suggested levels, or nothing when the protocol is unmapped.
 */
export function suggestedReasoningLevels(api: string | undefined): readonly ReasoningLevel[] | undefined {
  if (api === 'anthropic-messages') return ['low', 'medium', 'high', 'xhigh']
  // OpenAI-family protocols (completions and responses) accept the five base
  // levels; minimal through high is the commonly offered span.
  if (api === 'openai-completions' || api === 'openai-responses') return ['minimal', 'low', 'medium', 'high']
  return undefined
}
