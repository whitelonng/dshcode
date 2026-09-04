/**
 * `node:assert`: the claim-verification face, implemented directly — the
 * module's contract is to throw an {@link AssertionError} when a claim
 * fails, which needs no worker-side data source. The deep comparisons cover
 * the structural values a worker session can hold (primitives, arrays,
 * `Date`, `RegExp`, typed arrays, `Map`, `Set`, plain objects); the loose
 * variants compare primitives with `==` exactly as Node spells them.
 * @module node:assert (worker implementation)
 */

/** The error every violated claim throws, spelled the way Node spells it. */
export class AssertionError extends Error {
  /** Node's error code for assertion failures. */
  readonly code = 'ERR_ASSERTION'
  /** Whether Node assembled the message itself; always false here. */
  readonly generatedMessage = false
  /** The failing call's left-hand value, when the claim hands one in. */
  readonly actual: unknown
  /** The failing call's right-hand value, when the claim hands one in. */
  readonly expected: unknown
  /** The failing comparison, as Node names it (`strictEqual`, `ifError`, …). */
  readonly operator: string

  constructor(options: { message: string; actual?: unknown; expected?: unknown; operator: string }) {
    super(options.message)
    this.name = 'AssertionError'
    this.actual = options.actual
    this.expected = options.expected
    this.operator = options.operator
  }
}

/** Render one operand into an error message. */
const describe = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${String(value)}n`
  if (typeof value === 'function') return `[Function ${value.name || '(anonymous)'}]`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  return String(value)
}

/** Throw the failure every violated comparison reports. */
const throwMismatch = (
  operator: string, actual: unknown, expected: unknown, message: string | Error | undefined, summary: string,
): void => {
  if (message instanceof Error) throw message
  throw new AssertionError({
    message: message === undefined ? summary : message,
    actual,
    expected,
    operator,
  })
}

/** Byte view over the value, for typed-array comparison without a Buffer global. */
const asBytes = (value: unknown): Uint8Array | undefined => {
  if (!ArrayBuffer.isView(value) || value instanceof DataView) return undefined
  const view = value
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * The structural comparison behind the `deep*` claims.
 * @param left - one operand.
 * @param right - the other operand.
 * @param strict - whether prototypes must match and primitives compare with `Object.is`.
 * @returns Whether the operands compare equal under those rules.
 */
function deepCompare(left: unknown, right: unknown, strict: boolean): boolean {
  if (strict ? Object.is(left, right) : left == right) return true
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false
  if (strict && Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (left instanceof RegExp && right instanceof RegExp) {
    return left.source === right.source && left.flags === right.flags
  }
  const leftBytes = asBytes(left)
  const rightBytes = asBytes(right)
  if (leftBytes !== undefined || rightBytes !== undefined) {
    return leftBytes !== undefined && rightBytes !== undefined
      && leftBytes.length === rightBytes.length
      && leftBytes.every((byte, index) => byte === rightBytes[index])
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false
    for (const [key, value] of left) {
      if (!right.has(key) || !deepCompare(value, right.get(key), strict)) return false
    }
    return true
  }
  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false
    outer: for (const value of left) {
      for (const candidate of right) {
        if (deepCompare(value, candidate, strict)) continue outer
      }
      return false
    }
    return true
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => deepCompare(value, right[index], strict))
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => deepCompare(
    (left as Record<string, unknown>)[key],
    (right as Record<string, unknown>)[key],
    strict,
  ))
}

/**
 * Assert the claim is truthy; `assert` itself is Node's alias of this function.
 * @param value - the claim.
 * @param message - failure message, or a prepared error to throw instead.
 */
export function ok(value: unknown, message?: string | Error): void {
  if (value) return
  if (message instanceof Error) throw message
  throw new AssertionError({
    message: message ?? 'The expression evaluated to a falsy value.',
    actual: value,
    expected: true,
    operator: 'ok',
  })
}

/**
 * Raise an unconditional failure.
 * @param message - failure message, or a prepared error to throw instead.
 * @returns Never; it always throws.
 */
export function fail(message?: string | Error): never {
  if (message instanceof Error) throw message
  throw new AssertionError({ message: message ?? 'Failed', actual: undefined, expected: undefined, operator: 'fail' })
}

/** Loose equality claim: fails unless `actual == expected`.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function equal(actual: unknown, expected: unknown, message?: string | Error): void {
  if (actual != expected) throwMismatch('==', actual, expected, message, 'Values do not match.')
}

/** Loose inequality claim: fails if `actual == expected`.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function notEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (actual == expected) throwMismatch('!=', actual, expected, message, 'Values match.')
}

/** Strict equality claim with `Object.is` semantics (`NaN` equals `NaN`).
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!Object.is(actual, expected)) {
    throwMismatch('strictEqual', actual, expected, message, 'Values do not match.')
  }
}

/** Strict inequality claim with `Object.is` semantics.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (Object.is(actual, expected)) {
    throwMismatch('notStrictEqual', actual, expected, message, 'Values match.')
  }
}

/** Deep loose-equality claim over the structural set in the module JSDoc.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!deepCompare(actual, expected, false)) {
    throwMismatch('deepEqual', actual, expected, message, 'Values do not deeply match.')
  }
}

/** Deep loose-inequality claim.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (deepCompare(actual, expected, false)) {
    throwMismatch('notDeepEqual', actual, expected, message, 'Values deeply match.')
  }
}

/** Deep strict-equality claim: prototypes must match, primitives via `Object.is`.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (!deepCompare(actual, expected, true)) {
    throwMismatch('deepStrictEqual', actual, expected, message, 'Values do not strictly match.')
  }
}

/** Deep strict-inequality claim.
 * @param actual - first value of the claim.
 * @param expected - second value of the claim.
 * @param message - optional failure message, or a prepared error to throw instead.
 */
export function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  if (deepCompare(actual, expected, true)) {
    throwMismatch('notDeepStrictEqual', actual, expected, message, 'Values strictly match.')
  }
}

/** Narrowing argument of the `throws` claims: a class, a message RegExp, or a validator. */
type ThrowsMatch = (new (...args: never[]) => unknown) | RegExp | ((thrown: unknown) => boolean)

/**
 * Verify one caught error against the narrowing argument: a class requires
 * `instanceof`, a RegExp matches the message, a plain validator function
 * (no `prototype`) receives the error for its own verdict.
 * @param thrown - the caught value.
 * @param error - optional narrowing argument.
 */
function assertThrowsMatch(thrown: unknown, error: ThrowsMatch | undefined): void {
  if (error === undefined) return
  if (typeof error === 'function' && (error as { prototype?: unknown }).prototype === undefined) {
    if (!(error as (thrown: unknown) => boolean)(thrown)) {
      fail(`Expected error to match validator, got ${describe(thrown)}.`)
    }
    return
  }
  if (typeof error === 'function') {
    if (!(thrown instanceof (error as abstract new (...args: never[]) => object))) {
      fail(`Expected error of the given class, got ${describe(thrown)}.`)
    }
    return
  }
  const text = thrown instanceof Error ? thrown.message : String(thrown)
  if (!error.test(text)) fail(`Expected error message to match ${String(error)}, got ${describe(text)}.`)
}

/**
 * Assert the body throws.
 * @param body - the function to call.
 * @param error - optional class, RegExp, or validator narrowing the failure.
 * @param message - message raised when no error is thrown at all.
 */
export function throws(body: () => unknown, error?: ThrowsMatch, message?: string): void {
  try {
    body()
  } catch (thrown) {
    assertThrowsMatch(thrown, error)
    return
  }
  fail(message ?? 'Missing expected exception.')
}

/**
 * {@link throws} over an async body.
 * @param body - the promise or async function to await.
 * @param error - optional class, RegExp, or validator narrowing the rejection.
 * @param message - message raised when nothing rejects.
 */
export async function rejects(body: Promise<unknown> | (() => Promise<unknown>), error?: ThrowsMatch, message?: string): Promise<void> {
  try {
    await (typeof body === 'function' ? body() : body)
  } catch (thrown) {
    assertThrowsMatch(thrown, error)
    return
  }
  fail(message ?? 'Missing expected rejection.')
}

/**
 * Assert the body does not throw; a thrown error fails the claim.
 * @param body - the function to call.
 * @param message - message raised when the body throws.
 */
export function doesNotThrow(body: () => unknown, message?: string): void {
  try {
    body()
  } catch (thrown) {
    fail(message ?? `Got unwanted exception.\n${describe(thrown)}`)
  }
}

/**
 * {@link doesNotThrow} over an async body.
 * @param body - the promise or async function to await.
 * @param message - message raised when the body rejects.
 */
export async function doesNotReject(body: Promise<unknown> | (() => Promise<unknown>), message?: string): Promise<void> {
  try {
    await (typeof body === 'function' ? body() : body)
  } catch (thrown) {
    fail(message ?? `Got unwanted rejection.\n${describe(thrown)}`)
  }
}

/**
 * Assert the value is not a truthy error, throwing the error itself as Node does.
 * @param value - the candidate error.
 */
export function ifError(value: unknown): void {
  if (value === undefined || value === null) return
  const detail = typeof value === 'object' && 'message' in value
    ? describe(value.message)
    : describe(value)
  throw new AssertionError({
    message: `ifError got unwanted exception: ${detail}`,
    actual: value,
    expected: null,
    operator: 'ifError',
  })
}

/** The strict face: every loose name answers with its strict variant. */
export const strict = {
  ok,
  fail,
  equal: strictEqual,
  notEqual: notStrictEqual,
  deepEqual: deepStrictEqual,
  notDeepEqual: notDeepStrictEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  strictEqual,
  notStrictEqual,
  throws,
  doesNotThrow,
  rejects,
  doesNotReject,
  ifError,
  AssertionError,
  strict: undefined as unknown as NodeFace['strict'],
} as unknown as NodeFace['strict']
strict.strict = strict

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** The `node:assert` declarations this module stands in for. */
type NodeFace = typeof import('node:assert')

/** The callable face: `require('node:assert')` lands on `ok` with properties. */
const assert = ok as unknown as NodeFace

// The property assignment targets the Node face nominally; each slot below
// carries this module's own (deliberately narrower) signature.
Object.assign(assert as unknown as Record<string, unknown>, {
  ok,
  fail,
  equal,
  notEqual,
  strictEqual,
  notStrictEqual,
  deepEqual,
  notDeepEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  throws,
  doesNotThrow,
  rejects,
  doesNotReject,
  ifError,
  AssertionError,
  strict,
})

/** CommonJS-compatible namespace for default imports. */
export default assert
