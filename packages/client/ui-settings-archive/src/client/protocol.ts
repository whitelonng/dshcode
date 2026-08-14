/** Wire validation for the archived-sessions page responses. */

/** One archived session row from `workspace.listArchived`. */
export interface ArchivedSessionItem {
  /** Branded session id, carried as a string on the wire. */
  sessionId: string
  /** Folded log title, absent when the log has no title event. */
  title?: string
  /** Header creation timestamp (ms), absent when not persisted. */
  createdAt?: number
}

/** Whether a decoded value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate and normalize a `workspace.listArchived` response value.
 * @param value - decoded but untrusted response value.
 * @returns typed archived-session items.
 */
export function parseArchivedSessionList(value: unknown): ArchivedSessionItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('workspace.listArchived: response must contain an items array')
  }
  return value.items.map((item, index) => {
    if (!isRecord(item) || typeof item.sessionId !== 'string') {
      throw new Error(`workspace.listArchived: item ${String(index)} must carry a sessionId`)
    }
    if (item.title !== undefined && typeof item.title !== 'string') {
      throw new Error(`workspace.listArchived: item ${String(index)} title must be a string`)
    }
    if (item.createdAt !== undefined
      && (typeof item.createdAt !== 'number' || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0)) {
      throw new Error(`workspace.listArchived: item ${String(index)} createdAt must be a non-negative safe integer`)
    }
    return {
      sessionId: item.sessionId,
      ...item.title === undefined ? {} : { title: item.title },
      ...item.createdAt === undefined ? {} : { createdAt: item.createdAt },
    }
  })
}
