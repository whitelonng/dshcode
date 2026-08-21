/** Shared lazy candidate execution for normalization and request-image encoders. */

/** One encoded candidate carrying its complete bytes. */
export interface EncodedCandidate {
  data: Uint8Array
}

/** Result of exhausting candidates at one raster size without a fitting output. */
export interface ExhaustedEncoding<T extends EncodedCandidate> {
  smallest: T
}

/**
 * Execute encoding candidates in preference order and stop after the first fitting output.
 * @param attempts - lazy encoders ordered from preferred to fallback representation.
 * @param maxBytes - positive encoded-byte cap.
 * @returns the first fitting candidate, otherwise the smallest completed fallback.
 */
export async function encodeFirstWithinLimit<T extends EncodedCandidate>(
  attempts: readonly (() => Promise<T>)[],
  maxBytes: number,
): Promise<T | ExhaustedEncoding<T>> {
  const [first, ...remaining] = attempts
  if (first === undefined) throw new Error('image encoding requires at least one candidate')
  let smallest = await first()
  if (smallest.data.byteLength <= maxBytes) return smallest
  for (const attempt of remaining) {
    const candidate = await attempt()
    if (candidate.data.byteLength <= maxBytes) return candidate
    if (candidate.data.byteLength < smallest.data.byteLength) {
      smallest = candidate
    }
  }
  return { smallest }
}

/**
 * Whether a lazy encoding result exhausted every candidate at one size.
 * @param result - first fitting candidate or exhausted result.
 * @returns whether every candidate exceeded the byte cap.
 */
export function isExhaustedEncoding<T extends EncodedCandidate>(
  result: T | ExhaustedEncoding<T>,
): result is ExhaustedEncoding<T> {
  return 'smallest' in result
}
