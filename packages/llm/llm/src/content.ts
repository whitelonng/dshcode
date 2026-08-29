/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'
import type { Message } from './message.ts'
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'

/** Model-facing stand-in for an image removed to fit a provider request bound. */
export const OFFLOADED_IMAGE_TEXT
  = '[image omitted to keep the request within its image limit; older images are omitted first. If this image is still needed, read its file again when a path is available; otherwise ask the user to attach it again.]'

/**
 * Stable text shown to a model that cannot accept one durable image reference.
 * @param ref - durable master reference omitted from the request.
 * @returns deterministic text-only placeholder.
 */
export function textOnlyImageText(ref: ImageAttachmentRef): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  return `[image omitted because this model accepts text only; attachment sha256:${digest}]`
}

/**
 * Stable model-facing handle for one exact request image.
 * @param version - exact request image shown beside the text.
 * @returns attachment handle and request-image dimensions.
 */
export function requestImageHandleText(version: RequestImageAttachment): string {
  return `Image ${version.attachment.attachmentId}; request image ${version.width}x${version.height}px.`
}

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/** Base64 length of raw image bytes, including padding. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Byte accounting and quantized removal policy for one request representation. */
export interface RequestImageOffloadPolicy {
  /** Image count accepted by the route; omission leaves count unbounded. */
  maxImages?: number
  /** Accumulated image bytes accepted by the route; omission leaves bytes unbounded. */
  maxBytes?: number
  /** Number of excess images removed as one deterministic step. */
  countQuantum?: number
  /** Number of excess bytes removed as one deterministic step. */
  byteQuantum?: number
  /** Whether byte accounting uses raw file bytes or inline base64 length. */
  representation: 'raw' | 'base64'
  /** Resolve the encoded request-version length; omission uses master attachment bytes. */
  byteLength?: (ref: ImageAttachmentRef) => number
}

/** Collect represented image lengths in request and nested-block order. */
function collectImageLengths(
  blocks: readonly ContentBlock[],
  lengths: number[],
  policy: RequestImageOffloadPolicy,
): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      const bytes = policy.byteLength === undefined
        ? block.attachment.bytes
        : policy.byteLength(block.attachment)
      lengths.push(policy.representation === 'base64' ? base64Length(bytes) : bytes)
    } else if (block.type === 'tool-result') {
      collectImageLengths(block.content, lengths, policy)
    }
  }
}

/** Replace the first `remaining.count` image occurrences without mutating durable messages. */
function replaceOldestImages(
  blocks: readonly ContentBlock[],
  remaining: { count: number },
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image' && remaining.count > 0) {
      remaining.count -= 1
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: OFFLOADED_IMAGE_TEXT })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceOldestImages(block.content, remaining)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/** Replace every image occurrence, including nested tool results, for a text-only model. */
function replaceImagesForTextModel(blocks: readonly ContentBlock[]): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image') {
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: textOnlyImageText(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceImagesForTextModel(block.content)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Project durable image history into deterministic text for an exact text-only model.
 * @param messages - complete request history.
 * @returns the original list without images, otherwise shallow message copies with stable placeholders.
 */
export function projectImagesForTextModel(messages: readonly Message[]): readonly Message[] {
  if (!messages.some(message => contentHasImage(message.content))) return messages
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content)
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * Return transient request messages whose oldest images are replaced until
 * their accumulated base64 payload fits the configured bound. The selection
 * is deterministic from durable message order and attachment metadata; a
 * provider can serialize the returned messages without reading omitted bytes.
 * @param messages - complete request history, oldest first.
 * @param maxRequestImageBytes - positive bound on total base64 image payload; undefined preserves every image.
 * @returns the original messages when they already fit, otherwise shallow message copies with replaced content trees.
 */
export function offloadRequestImages(
  messages: readonly Message[],
  maxRequestImageBytes: number | undefined,
): readonly Message[] {
  return offloadRequestImagesWithPolicy(messages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
  })
}

/**
 * Return a deterministic transient projection whose oldest images are replaced
 * in whole count and byte quanta after a route budget is exceeded. The target
 * depends only on complete durable history: at 129 one-megabyte images under
 * a 128 MiB bound with a 64 MiB quantum, the oldest 65 images are removed so
 * 64 MiB remain; that removed prefix stays fixed until total history exceeds
 * 192 MiB.
 * @param messages - complete request history, oldest first.
 * @param policy - route representation, budgets, and removal quanta.
 * @returns original messages below both bounds, otherwise shallow copies with deterministic placeholders.
 */
export function offloadRequestImagesWithPolicy(
  messages: readonly Message[],
  policy: RequestImageOffloadPolicy,
): readonly Message[] {
  const lengths: number[] = []
  for (const message of messages) collectImageLengths(message.content, lengths, policy)
  const total = lengths.reduce((sum, bytes) => sum + bytes, 0)
  const excessCount = policy.maxImages === undefined ? 0 : Math.max(0, lengths.length - policy.maxImages)
  const excessBytes = policy.maxBytes === undefined ? 0 : Math.max(0, total - policy.maxBytes)
  if (excessCount === 0 && excessBytes === 0) return messages
  const countQuantum = policy.countQuantum ?? 1
  const byteQuantum = policy.byteQuantum ?? 1
  const removeCount = excessCount === 0 ? 0 : Math.ceil(excessCount / countQuantum) * countQuantum
  const removeBytes = excessBytes === 0 ? 0 : Math.ceil(excessBytes / byteQuantum) * byteQuantum
  let count = 0
  let removedBytes = 0
  for (const imageBytes of lengths) {
    const byteTargetMet = removeBytes === 0
      || (byteQuantum === 1 ? removedBytes >= removeBytes : removedBytes > removeBytes)
    if (count >= removeCount && byteTargetMet) break
    removedBytes += imageBytes
    count += 1
  }
  const remaining = { count }
  return messages.map((message) => {
    const content = replaceOldestImages(message.content, remaining)
    return content === message.content ? message : { ...message, content }
  })
}
