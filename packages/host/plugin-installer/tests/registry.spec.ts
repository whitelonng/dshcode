/** npm spec parsing and version resolution tests. */

import { describe, expect, it } from 'vitest'
import { isGitSpec, parseNpmSpec, resolveNpmVersion, type NpmPackument } from '../src/registry.ts'

function packument(latest: string, versions: string[]): NpmPackument {
  return {
    'dist-tags': { latest },
    versions: Object.fromEntries(versions.map(version => [version, { dist: { tarball: `https://reg.example/${version}.tgz` } }])),
  }
}

describe('parseNpmSpec', () => {
  it('splits scoped and unscoped names from their version part', () => {
    expect(parseNpmSpec('demo')).toEqual({ name: 'demo', version: undefined })
    expect(parseNpmSpec('demo@^1.2')).toEqual({ name: 'demo', version: '^1.2' })
    expect(parseNpmSpec('demo@1.2.3')).toEqual({ name: 'demo', version: '1.2.3' })
    expect(parseNpmSpec('@scope/demo')).toEqual({ name: '@scope/demo', version: undefined })
    expect(parseNpmSpec('@scope/demo@2.0.0')).toEqual({ name: '@scope/demo', version: '2.0.0' })
    expect(parseNpmSpec('@scope/demo@^2')).toEqual({ name: '@scope/demo', version: '^2' })
  })
})

describe('isGitSpec', () => {
  it('recognizes git protocols and repository URLs', () => {
    expect(isGitSpec('git+https://github.com/a/b.git')).toBe(true)
    expect(isGitSpec('git://github.com/a/b.git')).toBe(true)
    expect(isGitSpec('github:a/b')).toBe(true)
    expect(isGitSpec('https://github.com/a/b')).toBe(true)
    expect(isGitSpec('https://github.com/a/b.git')).toBe(true)
    expect(isGitSpec('demo')).toBe(false)
    expect(isGitSpec('@scope/demo@1.0.0')).toBe(false)
    expect(isGitSpec('https://example.com/a/b/c')).toBe(false)
  })
})

describe('resolveNpmVersion', () => {
  function fixture(): NpmPackument {
    return packument('1.9.0', ['0.9.0', '1.0.0', '1.5.0', '1.9.0', '2.2.0', '2.0.0-rc.1'])
  }

  it('defaults to dist-tags.latest and accepts explicit latest', () => {
    expect(resolveNpmVersion(undefined, fixture())).toBe('1.9.0')
    expect(resolveNpmVersion('latest', fixture())).toBe('1.9.0')
  })

  it('resolves exact versions and semver ranges', () => {
    expect(resolveNpmVersion('1.0.0', fixture())).toBe('1.0.0')
    expect(resolveNpmVersion('^1.0.0', fixture())).toBe('1.9.0')
    expect(resolveNpmVersion('~1.5.0', fixture())).toBe('1.5.0')
    expect(resolveNpmVersion('>=2.0.0 <3', fixture())).toBe('2.2.0')
  })

  it('rejects unknown exact versions, invalid specs, and unsatisfied ranges', () => {
    expect(() => resolveNpmVersion('9.9.9', fixture())).toThrow('does not exist')
    expect(() => resolveNpmVersion('not a version', fixture())).toThrow('unsupported version spec')
    expect(() => resolveNpmVersion('^9.0.0', fixture())).toThrow('no version satisfies')
  })

  it('rejects a packument without a latest tag', () => {
    const noLatest: NpmPackument = { 'dist-tags': {}, versions: { '1.0.0': {} } }
    expect(() => resolveNpmVersion(undefined, noLatest)).toThrow('no dist-tags.latest')
  })
})
