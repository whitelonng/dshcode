// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parsePluginControlSnapshot } from '../src/client/protocol.ts'

const VALID = {
  controls: [{ id: 'x', name: 'X', repository: 'https://example.com/x', state: 'enabled' }],
}

describe('parsePluginControlSnapshot', () => {
  it('accepts the complete state vocabulary', () => {
    const controls = ['enabled', 'disabled', 'mixed', 'unavailable'].map(state => ({
      id: state, name: state, repository: `https://example.com/${state}`, state,
    }))
    expect(parsePluginControlSnapshot({ controls })).toEqual({ controls })
  })

  it.each([
    null,
    {},
    { controls: [null] },
    { controls: [{ ...VALID.controls[0], id: 1 }] },
    { controls: [{ ...VALID.controls[0], name: 1 }] },
    { controls: [{ ...VALID.controls[0], repository: 1 }] },
    { controls: [{ ...VALID.controls[0], state: 1 }] },
    { controls: [{ ...VALID.controls[0], state: 'future' }] },
  ])('rejects an invalid wire payload %#', (value) => {
    expect(() => parsePluginControlSnapshot(value)).toThrow('plugin-control: response')
  })
})
