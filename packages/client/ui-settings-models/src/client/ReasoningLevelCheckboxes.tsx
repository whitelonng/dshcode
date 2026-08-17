/**
 * One model row's reasoning-level checkbox group, shared by the pi-ai and
 * DeepSeek editors. Checking a level adds it to the declaration with its
 * stored wire spelling, or the protocol default when newly offered; unchecking
 * removes it; unchecking the last level yields `false` — the adapters' spelling
 * of a non-reasoning model. The disable checkbox sets `false` explicitly and
 * clearing it returns to the inherited posture (`undefined`), mirroring the
 * pre-checkbox editors' disable control. A protocol family hint may sit beside
 * the group, advisory only.
 */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import { toggleReasoningLevel, type ReasoningEffortsValue, type ReasoningLevel } from './reasoning-efforts.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ReasoningLevelCheckboxes}. */
export interface ReasoningLevelCheckboxesProps {
  /** The stored declaration; `false` disables the whole group. */
  value: ReasoningEffortsValue | undefined
  /** The levels this editor offers (pi-ai: all seven; DeepSeek: off/low/high/max). */
  levels: readonly ReasoningLevel[]
  /** Levels a protocol family commonly offers, shown as a hint; advisory only. */
  suggested?: readonly ReasoningLevel[] | undefined
  /** Row position, for indexed aria labels. */
  index: number
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
  /** Replace the declaration after one checkbox toggle; `undefined` returns to inheritance. */
  onChange: (value: ReasoningEffortsValue | undefined) => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render one row's reasoning-level checkboxes plus the explicit disable
 * control.
 * @param props - the declaration, offered levels, and copy.
 * @returns the checkbox group.
 */
export function ReasoningLevelCheckboxes(props: ReasoningLevelCheckboxesProps): ReactNode {
  const { value, levels, suggested, index, disabled, onChange, t } = props
  // The invalid sentinel, `null` (a valueless YAML declaration), and every
  // non-map value read as no checked level; only a real map offers
  // memberships.
  const raw = value as unknown
  const declared = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Partial<Record<ReasoningLevel, string | null>>
    : {}
  return (
    <div className={styles['modelCheckGroup']}>
      <span className={styles['modelFieldLabel']}>{t('modelReasoningLevels')}</span>
      <div className={styles['modelCheckRow']}>
        {levels.map(level => (
          <label className={styles['modelFieldCheck']} key={level}>
            <input
              type="checkbox"
              checked={level in declared}
              disabled={disabled || value === false}
              aria-label={`${t('modelReasoningLevels')} ${String(index + 1)} ${level}`}
              onChange={() => { onChange(toggleReasoningLevel(value, level)) }}
            />
            <span>{level}</span>
          </label>
        ))}
      </div>
      <label className={styles['modelFieldCheck']}>
        <input
          type="checkbox"
          checked={value === false}
          disabled={disabled}
          aria-label={`${t('modelReasoningOff')} ${String(index + 1)}`}
          onChange={(event) => { onChange(event.target.checked ? false : undefined) }}
        />
        <span>{t('modelReasoningOff')}</span>
      </label>
      {suggested !== undefined && suggested.length > 0
        ? <p className={styles['modelCheckHint']}>{t('reasoningLevelsSuggestion')}{suggested.join(', ')}</p>
        : null}
    </div>
  )
}
