import { describe, expect, it } from 'vitest'
import { abbreviateHomePath, resolveWorkspacePath } from '../src/client/workspaces/path.ts'

describe('abbreviateHomePath', () => {
  it('collapses a POSIX home and its descendants', () => {
    expect(abbreviateHomePath('/Users/u', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/Documents/project', '/Users/u')).toBe('~/Documents/project')
    expect(abbreviateHomePath('/Users/u/Documents/project/', '/Users/u/')).toBe('~/Documents/project/')
  })

  it('keeps prefix-adjacent names and non-home paths', () => {
    expect(abbreviateHomePath('/Users/u2/a.ts', '/Users/u')).toBe('/Users/u2/a.ts')
    expect(abbreviateHomePath('/etc/hosts', '/Users/u')).toBe('/etc/hosts')
    expect(abbreviateHomePath('src/a.ts', '/Users/u')).toBe('src/a.ts')
    expect(abbreviateHomePath('~/already', '/Users/u')).toBe('~/already')
  })

  it('does not abbreviate when home is missing, empty, or the filesystem root', () => {
    expect(abbreviateHomePath('/Users/u/a.ts')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/Users/u/a.ts', '')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/etc/hosts', '/')).toBe('/etc/hosts')
    expect(abbreviateHomePath('/etc/hosts', '///')).toBe('/etc/hosts')
  })

  it('leaves Windows drive and UNC paths verbatim', () => {
    expect(abbreviateHomePath('C:\\Users\\u\\project', 'C:\\Users\\u')).toBe('C:\\Users\\u\\project')
    expect(abbreviateHomePath('C:/Users/u/project', '/Users/u')).toBe('C:/Users/u/project')
    expect(abbreviateHomePath('/Users/u/project', 'C:\\Users\\u')).toBe('/Users/u/project')
    expect(abbreviateHomePath('\\\\server\\share\\u', '\\\\server\\share\\u')).toBe('\\\\server\\share\\u')
  })
})

describe('resolveWorkspacePath', () => {
  it('joins a relative path under cwd and passes absolute paths through', () => {
    expect(resolveWorkspacePath('/w', 'src/a.ts')).toBe('/w/src/a.ts')
    expect(resolveWorkspacePath('/w/', '/abs/a.ts')).toBe('/abs/a.ts')
    expect(resolveWorkspacePath(undefined, 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('/w', 'C:\\x\\a.ts')).toBe('C:\\x\\a.ts')
  })
})
