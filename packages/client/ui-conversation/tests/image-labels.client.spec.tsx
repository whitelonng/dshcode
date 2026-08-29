// @vitest-environment jsdom
// Conversation-owned attachment errors and the message-image slot handoff.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import type { RenderMessageImages } from '../src/client/contract/slots.ts'
import { attachmentErrorText, imageSizeText } from '../src/client/image-labels.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const enT = makeTranslate(en, commonZh)

const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

type MessageImagesRenderOwner = Parameters<RenderMessageImages>[0]

function imageRenderer(calls: MessageImagesRenderOwner[]): RenderMessageImages {
  return (owner) => {
    calls.push(owner)
    return (
      <div data-testid="message-images" data-align={owner.align} data-count={owner.images.length}>
        {owner.images.map(({ attachment: image }, index) => (
          <span key={`${image.attachmentId}:${String(index)}`}>{image.name}</span>
        ))}
      </div>
    )
  }
}

describe('attachment rejection copy', () => {
  const limits = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2000,
    mediaTypes: ['image/png'] as const,
  }

  it('renders megabytes without a trailing fraction unless one exists', () => {
    expect(imageSizeText(10 * 1024 * 1024)).toBe('10MB')
    expect(imageSizeText(2.5 * 1024 * 1024)).toBe('2.5MB')
  })

  it('maps user-solvable reasons to limit-naming copy', () => {
    expect(attachmentErrorText(t, 'MODEL_DOES_NOT_SUPPORT_IMAGES')).toBe('当前模型不支持图片，请切换支持图片的模型')
    expect(attachmentErrorText(t, 'SUBAGENT_IMAGE_UNSUPPORTED')).toBe('子智能体会话暂不支持图片')
    expect(attachmentErrorText(t, 'IMAGE_TOO_MANY_PIXELS')).toBe('图片分辨率过大，请压缩后重试')
    expect(attachmentErrorText(t, 'INVALID_IMAGE')).toBe('仅支持 PNG、JPG、WebP、GIF 格式的图片')
    expect(attachmentErrorText(t, 'IMAGE_TYPE_MISMATCH')).toBe('仅支持 PNG、JPG、WebP、GIF 格式的图片')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES', limits)).toBe('一条消息最多添加 20 张图片')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE', limits)).toBe('单张图片不能超过 5MB')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE', limits)).toBe('图片总大小超过 100MB，请移除部分图片')
    expect(attachmentErrorText(t, 'IMAGE_DIMENSION_TOO_LARGE', limits)).toBe('图片宽高不能超过 2000px，请缩小后重试')
    expect(attachmentErrorText(enT, 'TOO_MANY_IMAGES', limits)).toBe('A message can include up to 20 images')
  })

  it('folds unknown reasons and limit reasons without projected limits into the send-failed line', () => {
    expect(attachmentErrorText(t, 'INVALID_IMAGE_BASE64')).toBe('图片发送失败（INVALID_IMAGE_BASE64），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES')).toBe('图片发送失败（TOO_MANY_IMAGES），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE')).toBe('图片发送失败（IMAGE_TOO_LARGE），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE')).toBe('图片发送失败（IMAGES_TOO_LARGE），请重新添加图片后再试')
    expect(attachmentErrorText(t, 'IMAGE_DIMENSION_TOO_LARGE')).toBe('图片发送失败（IMAGE_DIMENSION_TOO_LARGE），请重新添加图片后再试')
  })
})

describe('assistant image slot handoff', () => {
  it('passes one image group and its message alignment to the renderer', () => {
    const calls: MessageImagesRenderOwner[] = []
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'image', attachment }]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    expect(view.getByTestId('message-images').getAttribute('data-align')).toBe('start')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.images).toEqual([{ attachment }])
  })

  it('merges consecutive image blocks into one group and splits groups at text', () => {
    const calls: MessageImagesRenderOwner[] = []
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'image', attachment },
          { kind: 'image', attachment },
          { kind: 'text', text: 'between' },
          { kind: 'image', attachment },
        ]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    const galleries = view.getAllByTestId('message-images')
    expect(galleries).toHaveLength(2)
    expect(galleries.map(gallery => gallery.getAttribute('data-count'))).toEqual(['2', '1'])
    expect(calls.map(call => call.images.length)).toEqual([2, 1])
  })

  it('keeps the renderer output at the image block position between text blocks', () => {
    const calls: MessageImagesRenderOwner[] = []
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'text', text: 'before' },
          { kind: 'image', attachment },
          { kind: 'text', text: 'after' },
        ]}
        streaming={false}
        renderMessageImages={imageRenderer(calls)}
      />,
    )
    const image = view.getByTestId('message-images')
    const before = view.getByText('before')
    const after = view.getByText('after')
    expect(before.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(image.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})
