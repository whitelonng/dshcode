/** Deterministic provider-independent image normalization. */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { encodeFirstWithinLimit, isExhaustedEncoding } from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible } from './image.ts'
import type { DetectedImage } from './image.ts'

/** Deployment-resolved policy for the persisted normalized attachment. */
export interface NormalizationPolicy {
  /** Long-edge cap in pixels; larger sources are downscaled proportionally. */
  maxDimension: number
  /** Independent safety cap for encoded normalized image bytes. */
  maxBytes: number
}

/** Normalized bytes beside the facts recorded by a durable reference. */
export interface NormalizedImage {
  data: Uint8Array
  mediaType: ImageMediaType
  width: number
  height: number
}

const NORMALIZATION_QUALITIES = [85, 80, 75] as const
const LOW_COLOUR_SAMPLE_EDGE = 128
const LOW_COLOUR_LIMIT = 256
const MIN_SCALE_STEP = 0.9

/** Encode one prepared pipeline and report exact output facts. */
async function encode(
  pipeline: Sharp,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
  quality?: number,
  palette = true,
): Promise<NormalizedImage> {
  const encoded = mediaType === 'image/png'
    ? pipeline.png({ compressionLevel: 9, palette })
    : mediaType === 'image/webp'
      ? pipeline.webp({ quality })
      : pipeline.jpeg({ quality })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType, width: info.width, height: info.height }
}

/**
 * Whether bytes already satisfy the normalization requirements.
 * @param detected - fully decoded source facts.
 * @param bytes - encoded source length.
 * @param policy - resolved normalization limits.
 * @returns whether the source can pass through byte-identically.
 */
export function canPassThroughNormalization(
  detected: DetectedImage,
  bytes: number,
  policy: NormalizationPolicy,
): boolean {
  return detected.mediaType !== 'image/gif'
    && !detected.animated
    && !detected.carriesMetadata
    && detected.depth === 'uchar'
    && detected.space === 'srgb'
    && bytes <= policy.maxBytes
    && Math.max(detected.width, detected.height) <= policy.maxDimension
}

/**
 * Classify a bounded pixel sample without assuming that a PNG source is a screenshot.
 * @param pipeline - oriented sRGB source pipeline before output resizing.
 * @returns whether the nearest-neighbour sample stays within the low-color threshold.
 */
export async function hasLowColourCount(pipeline: Sharp): Promise<boolean> {
  const { data, info } = await pipeline.clone().resize({
    width: LOW_COLOUR_SAMPLE_EDGE,
    height: LOW_COLOUR_SAMPLE_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
    kernel: sharp.kernel.nearest,
    fastShrinkOnLoad: false,
  }).raw().toBuffer({ resolveWithObject: true })
  const colours = new Set<number>()
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data.readUInt8(offset)
    const green = data.readUInt8(offset + 1)
    const blue = data.readUInt8(offset + 2)
    const alpha = info.channels === 4 ? data.readUInt8(offset + 3) : 255
    colours.add(((red >> 3) << 15) | ((green >> 3) << 10) | ((blue >> 3) << 5) | (alpha >> 3))
    if (colours.size > LOW_COLOUR_LIMIT) return false
  }
  return true
}

/** Assert that a normalized output is an 8-bit sRGB/sRGBA single-frame image with matching facts. */
async function verifyNormalizedImage(
  image: NormalizedImage,
  expectedAlpha: boolean | undefined,
): Promise<NormalizedImage> {
  const detected = await detectImage(image.data)
  if (detected.mediaType !== image.mediaType
    || detected.width !== image.width
    || detected.height !== image.height
    || detected.animated
    || detected.carriesMetadata
    || detected.depth !== 'uchar'
    || detected.space !== 'srgb'
    || !encodedAlphaIsCompatible(expectedAlpha, detected)) {
    throw new AttachmentError(
      'Image normalization did not produce a single-frame 8-bit sRGB image with matching metadata.',
      'ATTACHMENT_WRITE_FAILED',
    )
  }
  return image
}

/** Build one fixed-size, oriented, metadata-free sRGB pipeline from submitted bytes. */
function preparedPipeline(data: Uint8Array, width: number, height: number): Sharp {
  return sharp(data, { failOn: 'error', limitInputPixels: false })
    .rotate()
    .toColourspace('srgb')
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
}

/** Dimensions after the long edge is capped without changing aspect ratio. */
function initialDimensions(detected: DetectedImage, maxDimension: number): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(detected.width, detected.height))
  return {
    width: Math.max(1, Math.round(detected.width * scale)),
    height: Math.max(1, Math.round(detected.height * scale)),
  }
}

/** Lazy encoding order for one size, separated by sampled colour complexity and alpha. */
function encodingAttemptsAtSize(
  data: Uint8Array,
  width: number,
  height: number,
  hasAlpha: boolean,
  lowColour: boolean,
): Array<() => Promise<NormalizedImage>> {
  const prepared = preparedPipeline(data, width, height)
  const webp = NORMALIZATION_QUALITIES.map(quality => (
    () => encode(prepared.clone(), 'image/webp', quality)
  ))
  if (lowColour) {
    return [() => encode(prepared.clone(), 'image/png', undefined, !hasAlpha), ...webp]
  }
  if (hasAlpha) return webp
  return NORMALIZATION_QUALITIES.map(quality => (
    () => encode(prepared.clone(), 'image/jpeg', quality)
  ))
}

/**
 * Produce the persisted provider-independent normalized version of one fully decoded source.
 * The source is passed through only when it is already clean, single-frame, 8-bit sRGB/sRGBA,
 * and inside both normalization limits. Re-encoding never removes transparency. After the fixed
 * quality floor is reached, dimensions continue shrinking until the independent byte cap holds.
 * @param data - complete admitted source bytes.
 * @param detected - fully decoded source facts.
 * @param policy - resolved independent normalization limits.
 * @returns verified provider-independent normalized bytes and metadata.
 */
export async function normalizeImage(
  data: Uint8Array,
  detected: DetectedImage,
  policy: NormalizationPolicy,
): Promise<NormalizedImage> {
  if (canPassThroughNormalization(detected, data.byteLength, policy)) {
    return { data, mediaType: detected.mediaType, width: detected.width, height: detected.height }
  }
  try {
    let { width, height } = initialDimensions(detected, policy.maxDimension)
    const classificationPipeline = sharp(data, { failOn: 'error', limitInputPixels: false })
      .rotate()
      .toColourspace('srgb')
    const lowColour = await hasLowColourCount(classificationPipeline)
    for (;;) {
      const encoded = await encodeFirstWithinLimit(
        encodingAttemptsAtSize(data, width, height, detected.hasAlpha, lowColour),
        policy.maxBytes,
      )
      if (!isExhaustedEncoding(encoded)) {
        return await verifyNormalizedImage(encoded, detected.mediaType === 'image/gif' ? undefined : detected.hasAlpha)
      }
      if (width === 1 && height === 1) break
      const sizeScale = Math.sqrt(policy.maxBytes / encoded.smallest.data.byteLength) * 0.95
      const scale = Math.min(MIN_SCALE_STEP, sizeScale)
      const nextWidth = Math.max(1, Math.floor(width * scale))
      const nextHeight = Math.max(1, Math.floor(height * scale))
      width = nextWidth
      height = nextHeight
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    const source = detected.mediaType === 'image/png' && detected.depth !== 'uchar'
      ? `${detected.depth === 'ushort' ? '16-bit' : detected.depth} PNG`
      : `${detected.depth} ${detected.mediaType.slice('image/'.length).toUpperCase()}`
    throw new AttachmentError(
      `The ${source} could not be converted to the normalized 8-bit sRGB form.`,
      'ATTACHMENT_WRITE_FAILED',
      { cause: error },
    )
  }
  throw new AttachmentError('Image cannot be encoded within the configured normalized-image byte cap.', 'IMAGE_TOO_LARGE')
}
