/**
 * The three model-capability checkboxes a pi-ai model row offers, and how
 * each maps onto the stored pi-ai model entry:
 *
 * - image input (多模态) toggles `image` in the entry's `input` array;
 * - image generation (生图) toggles `image` in the entry's `output` array;
 * - image understanding (识图) toggles `capabilities.imageUnderstanding`,
 *   and — because a model that reasons about image content must receive the
 *   image — keeps `image` in `input` too.
 *
 * The stored arrays keep `text` as their floor, so an entry that stops
 * accepting images still names a usable modality rather than an empty list
 * (which pi-ai reads as "no answer here"). Unchecking image generation or
 * understanding drops the corresponding field entirely; a dropped `output` is
 * the text-only default and a dropped `capabilities` is no capability claim.
 *
 * Generation is deliberately independent of image input: a model that draws
 * images need not accept them, and nothing here forces the combination. The
 * two image-involving checkboxes (input and understanding) do combine, with
 * understanding implying input at the storage level.
 * @module @deepseek-ai/dsh-client-ui-settings-models/model-capabilities
 */

/** One of the three capability checkboxes. */
export type CapabilityToggle = 'imageInput' | 'imageGeneration' | 'imageUnderstanding'

/** The three checkbox states read off one model draft. */
export interface ModelCapabilityChecks {
  /** Whether the entry's `input` declares `image`. */
  imageInput: boolean
  /** Whether the entry's `output` declares `image`. */
  imageGeneration: boolean
  /** Whether the entry's `capabilities` declares image understanding. */
  imageUnderstanding: boolean
}

/** A string array field as stored, tolerating malformed drafts. */
function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : []
}

/** An object field as stored, tolerating malformed drafts. */
function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** The `input` value expressing one image-input claim over a stored list. */
function inputWithImage(current: unknown, hasImage: boolean): string[] {
  const kept = stringArrayOf(current).filter(entry => entry !== 'image')
  const floor = kept.length === 0 ? ['text'] : kept
  return hasImage ? [...new Set([...floor, 'image'])] : floor
}

/** The `output` value expressing one image-generation claim; dropped when off. */
function outputWithImage(current: unknown, hasImage: boolean): string[] | undefined {
  if (!hasImage) return undefined
  const kept = stringArrayOf(current).filter(entry => entry !== 'image')
  return [...new Set([...(kept.length === 0 ? ['text'] : kept), 'image'])]
}

/** The `capabilities` value expressing one understanding claim; dropped when off. */
function capabilitiesWithUnderstanding(current: unknown, has: boolean): Record<string, boolean> | undefined {
  const base = objectOf(current) as Record<string, boolean>
  if (!has) {
    const { imageUnderstanding: _dropped, ...rest } = base
    return Object.keys(rest).length === 0 ? undefined : rest
  }
  return { ...base, imageUnderstanding: true }
}

/**
 * Read the three checkbox states off one model draft.
 * @param model - the model entry as drafted.
 * @returns the three states.
 */
export function capabilityChecks(model: Readonly<Record<string, unknown>>): ModelCapabilityChecks {
  const input = stringArrayOf(model['input'])
  const output = stringArrayOf(model['output'])
  const capabilities = objectOf(model['capabilities'])
  return {
    imageInput: input.includes('image'),
    imageGeneration: output.includes('image'),
    imageUnderstanding: capabilities['imageUnderstanding'] === true,
  }
}

/**
 * Apply one checkbox toggle to a model draft, returning the fields to patch.
 * Undefined values mean "drop the field", which the caller's patch treats as
 * clearing it from the entry. Each toggle touches only the fields it owns:
 * image generation never rewrites `input` or `capabilities`, and the two
 * input-side toggles never rewrite `output`.
 * @param model - the model entry as drafted.
 * @param toggle - which checkbox changed.
 * @param checked - its new state.
 * @returns the fields to write.
 */
export function applyCapabilityToggle(
  model: Readonly<Record<string, unknown>>,
  toggle: CapabilityToggle,
  checked: boolean,
): Record<string, string[] | Record<string, boolean> | undefined> {
  const checks = capabilityChecks(model)
  if (toggle === 'imageGeneration') {
    return {
      output: outputWithImage(model['output'], checked),
    }
  }
  // The input-side toggles: understanding implies input, so the stored input
  // carries `image` while either checkbox is on.
  const imageInput = toggle === 'imageInput' ? checked : checks.imageInput
  const imageUnderstanding = toggle === 'imageUnderstanding' ? checked : checks.imageUnderstanding
  const hasImageInput = imageInput || imageUnderstanding
  return {
    input: inputWithImage(model['input'], hasImageInput),
    capabilities: capabilitiesWithUnderstanding(model['capabilities'], imageUnderstanding),
  }
}
