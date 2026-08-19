/** Capability checkbox read/toggle helpers over pi-ai model drafts. */

import { describe, expect, it } from 'vitest'
import { applyCapabilityToggle, capabilityChecks } from '../src/client/model-capabilities.ts'

describe('capabilityChecks', () => {
  it('reads the three states off malformed or absent fields', () => {
    expect(capabilityChecks({})).toEqual({
      imageInput: false, imageGeneration: false, imageUnderstanding: false,
    })
    expect(capabilityChecks({ input: 'nope' })).toEqual({
      imageInput: false, imageGeneration: false, imageUnderstanding: false,
    })
    expect(capabilityChecks({
      input: ['text', 'image'],
      output: ['text', 'image'],
      capabilities: { imageUnderstanding: true },
    })).toEqual({
      imageInput: true, imageGeneration: true, imageUnderstanding: true,
    })
    // Only a truthy understanding claim counts; an unknown capability key is
    // preserved but never read as understanding.
    expect(capabilityChecks({ capabilities: { imageUnderstanding: false, nextGen: true } }))
      .toMatchObject({ imageUnderstanding: false })
  })
})

describe('applyCapabilityToggle', () => {
  it('adds and removes image input while keeping text as the floor', () => {
    expect(applyCapabilityToggle({}, 'imageInput', true)).toMatchObject({
      input: ['text', 'image'],
    })
    expect(applyCapabilityToggle({ input: ['text', 'image'] }, 'imageInput', false))
      .toMatchObject({ input: ['text'] })
    // A hand-written list keeps its other entries.
    expect(applyCapabilityToggle({ input: ['image'] }, 'imageInput', false))
      .toMatchObject({ input: ['text'] })
  })

  it('adds image generation to output and drops the field when unchecked', () => {
    expect(applyCapabilityToggle({}, 'imageGeneration', true)).toEqual({
      output: ['text', 'image'],
    })
    expect(applyCapabilityToggle({ output: ['text', 'image'] }, 'imageGeneration', false))
      .toEqual({ output: undefined })
  })

  it('declares understanding in capabilities and implies image input at the storage level', () => {
    const withUnderstanding = applyCapabilityToggle({}, 'imageUnderstanding', true)
    expect(withUnderstanding).toEqual({
      input: ['text', 'image'],
      capabilities: { imageUnderstanding: true },
    })
    // Unchecking understanding drops the capability. The image-input
    // checkbox is derived from the stored input, which still carries image
    // while understanding held it, so the stored list stays until that box
    // is unchecked too.
    const afterUnderstanding = applyCapabilityToggle({ ...withUnderstanding }, 'imageUnderstanding', false)
    expect(afterUnderstanding).toEqual({ input: ['text', 'image'], capabilities: undefined })
    expect(applyCapabilityToggle({ ...afterUnderstanding }, 'imageInput', false).input).toEqual(['text'])
  })

  it('keeps generation independent of image input', () => {
    // A model that draws images need not accept them, and the generation
    // toggle never touches the input-side fields.
    expect(applyCapabilityToggle({}, 'imageGeneration', true)).not.toHaveProperty('input')
    expect(applyCapabilityToggle({ output: ['text', 'image'] }, 'imageGeneration', false))
      .not.toHaveProperty('input')
  })
})
