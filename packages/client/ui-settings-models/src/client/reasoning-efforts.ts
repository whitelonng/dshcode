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
 * @param value - the model's `reasoningEfforts` field.
 * @returns whether the adapter will accept it.
 */
export function validReasoningEfforts(value: unknown): boolean {
  if (value === undefined || value === false || value === INVALID_EFFORTS) return value !== INVALID_EFFORTS
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  for (const [level, spelling] of Object.entries(value as Record<string, unknown>)) {
    if (!THINKING_LEVELS.includes(level as ReasoningLevel)) return false
    if (level !== 'off' && (typeof spelling !== 'string' || spelling.length === 0)) return false
  }
  return true
}
