/** npm spec parsing and version resolution tests. */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tar from 'tar'
import {
  fetchPackument,
  installNpmPackage,
  isGitSpec,
  normalizeInstallSpec,
  parseNpmSpec,
  resolveNpmVersion,
  validateInstallSpec,
  verifySRI,
  type NpmPackument,
} from '../src/registry.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

/** Build a fixture npm tarball (package root `package/`) and return bytes + sha512 base64. */
async function fixtureTarball(): Promise<{ bytes: Uint8Array<ArrayBuffer>; sha512: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-registry-tarball-'))
  tempRoots.push(dir)
  const pkg = join(dir, 'pkg')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8')
  await writeFile(join(pkg, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
  const file = join(dir, 'demo.tgz')
  await tar.create({ gzip: true, cwd: dir, file }, ['pkg'])
  const buffer = await readFile(file)
  const bytes = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  return { bytes, sha512: createHash('sha512').update(bytes).digest('base64') }
}

/** A packument pinning the given integrity for version 1.0.0. */
function packumentWith(integrity: string | undefined): NpmPackument {
  const dist: { tarball: string; integrity?: string } = { tarball: 'https://reg.example/demo.tgz' }
  if (integrity !== undefined) dist.integrity = integrity
  return { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist } } }
}

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
    expect(isGitSpec('github:a/b#main')).toBe(true)
    expect(isGitSpec('https://github.com/a/b')).toBe(true)
    expect(isGitSpec('https://github.com/a/b.git')).toBe(true)
    expect(isGitSpec('https://github.com/a/b#main')).toBe(true)
    expect(isGitSpec('https://github.com/a/b.git#v1.0.0')).toBe(true)
    expect(isGitSpec('demo')).toBe(false)
    expect(isGitSpec('@scope/demo@1.0.0')).toBe(false)
    expect(isGitSpec('https://example.com/a/b/c')).toBe(false)
  })
})

describe('validateInstallSpec', () => {
  it('accepts npm names, scoped names, versions, and git sources', () => {
    expect(() => { validateInstallSpec('demo') }).not.toThrow()
    expect(() => { validateInstallSpec('@scope/demo') }).not.toThrow()
    expect(() => { validateInstallSpec('demo@1.0.0') }).not.toThrow()
    expect(() => { validateInstallSpec('https://github.com/dsh-external/dsh-genui') }).not.toThrow()
    expect(() => { validateInstallSpec('git+https://github.com/a/b.git') }).not.toThrow()
  })

  it('rejects prose, pasted URLs, and mixed text with a readable error', () => {
    const pasted = '嘿嘿，也欢迎大家试试我的生成式UI https://github.com/dsh-external/dsh-genui 和批注功能插件 https://github.com/dsh-external/dsh-annotation'
    expect(() => { validateInstallSpec(pasted) }).toThrow(/invalid install spec/)
    expect(() => { validateInstallSpec(pasted) }).toThrow('expected one npm package name')
    expect(() => { validateInstallSpec('https://github.com/a/b https://github.com/c/d') }).toThrow(/invalid install spec/)
    expect(() => { validateInstallSpec('demo and another') }).toThrow(/invalid install spec/)
    expect(() => { validateInstallSpec('https://example.com/not-a-repo') }).toThrow(/invalid install spec/)
  })

  it('recognizes pasted shell commands and names what to paste instead', () => {
    expect(() => { validateInstallSpec('dsh plugin --profile web add github:Nagi-ovo/dsh-visualize') })
      .toThrow('looks like a shell command')
    expect(() => { validateInstallSpec('dsh plugin --profile web add github:Nagi-ovo/dsh-visualize') })
      .toThrow('paste only the npm package name or the git repository URL')
    expect(() => { validateInstallSpec('pnpm add demo') }).toThrow('looks like a shell command')
    expect(() => { validateInstallSpec('npm i @scope/demo') }).toThrow('looks like a shell command')
    expect(() => { validateInstallSpec('yarn add demo') }).toThrow('looks like a shell command')
    expect(() => { validateInstallSpec('npx demo') }).toThrow('looks like a shell command')
  })

  it('reduces pasted full CLI commands to the spec they install', () => {
    expect(normalizeInstallSpec('dsh plugin --profile web add github:Nagi-ovo/dsh-visualize')).toBe('github:Nagi-ovo/dsh-visualize')
    expect(normalizeInstallSpec('dsh plugin add demo')).toBe('demo')
    expect(normalizeInstallSpec('pnpm add @scope/demo')).toBe('@scope/demo')
    expect(normalizeInstallSpec('pnpm i demo')).toBe('demo')
    expect(normalizeInstallSpec('npm install demo')).toBe('demo')
    expect(normalizeInstallSpec('npm i demo')).toBe('demo')
  })

  it('passes ordinary specs through normalizeInstallSpec unchanged', () => {
    expect(normalizeInstallSpec('demo')).toBe('demo')
    expect(normalizeInstallSpec('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(normalizeInstallSpec('dsh plugin list')).toBe('dsh plugin list')
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
    expect(() => { resolveNpmVersion('9.9.9', fixture()) }).toThrow('does not exist')
    expect(() => { resolveNpmVersion('not a version', fixture()) }).toThrow('unsupported version spec')
    expect(() => { resolveNpmVersion('^9.0.0', fixture()) }).toThrow('no version satisfies')
  })

  it('rejects a packument without a latest tag', () => {
    const noLatest: NpmPackument = { 'dist-tags': {}, versions: { '1.0.0': {} } }
    expect(() => { resolveNpmVersion(undefined, noLatest) }).toThrow('no dist-tags.latest')
  })
})

describe('fetchPackument', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('names the package on a 404 and rejects invalid packuments', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    await expect(fetchPackument('@scope/demo', 'https://reg.example/'))
      .rejects.toThrow('package "@scope/demo" not found')

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ 'dist-tags': null, versions: null }), { status: 200 }))
    await expect(fetchPackument('demo', 'https://reg.example/'))
      .rejects.toThrow('returned an invalid packument')
  })

  it('normalizes a registry without a trailing slash and names non-404 errors', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      seen.push(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url)
      return new Response('nope', { status: 500 })
    })
    await expect(fetchPackument('demo', 'https://reg.example'))
      .rejects.toThrow('registry answered 500 for "demo"')
    expect(seen[0]).toBe('https://reg.example/demo')
  })
})

describe('installNpmPackage failures', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('rejects a version entry without a tarball', async () => {
    const entry = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } } as NpmPackument
    await expect(installNpmPackage('demo', '1.0.0', entry, '/tmp/out'))
      .rejects.toThrow('has no tarball')
  })

  it('rejects a tarball the registry answers with an error', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    const entry = packument('1.0.0', ['1.0.0'])
    await expect(installNpmPackage('demo', '1.0.0', entry, '/tmp/out'))
      .rejects.toThrow('tarball https://reg.example/1.0.0.tgz answered 404')
  })

  it('rejects a tarball response without a body', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const entry = packument('1.0.0', ['1.0.0'])
    await expect(installNpmPackage('demo', '1.0.0', entry, '/tmp/out'))
      .rejects.toThrow('has no body')
  })

  it('leaves no target directory behind when the install fails', async () => {
    // A failed install must not leave an empty (or half-extracted) package
    // directory: Node then reports "Cannot find package" for a directory that
    // exists, defeating every parent-directory fallback and the next boot.
    const fixture = await fixtureTarball()
    vi.stubGlobal('fetch', async () => new Response(fixture.bytes, {
      status: 200, headers: { 'content-length': String(fixture.bytes.byteLength) },
    }))
    const out = await mkdtemp(join(tmpdir(), 'dsh-registry-residue-'))
    tempRoots.push(out)
    const target = join(out, 'pkg')
    await expect(installNpmPackage('demo', '1.0.0', packumentWith('sha512-dG90bW9tYW5nZXJlZA=='), target))
      .rejects.toThrow('failed integrity verification')
    expect(existsSync(target)).toBe(false)
  })
})

describe('verifySRI', () => {
  const digest = {
    sha256: 'c2hhMjU2',
    sha384: 'c2hhMzg0',
    sha512: 'c2hhNTEy',
  }

  it('accepts a matching token among several', () => {
    expect(() => { verifySRI(digest, 'sha512-c2hhNTEy', 'https://reg.example/a.tgz') }).not.toThrow()
    expect(() => { verifySRI(digest, 'sha256-c2hhMjU2 sha512-other', 'https://reg.example/a.tgz') }).not.toThrow()
    // Leading whitespace produces an empty token, which is skipped.
    expect(() => { verifySRI(digest, ' sha512-c2hhNTEy', 'https://reg.example/a.tgz') }).not.toThrow()
  })

  it('rejects a mismatch and an unsupported algorithm set', () => {
    expect(() => { verifySRI(digest, 'sha512-wrong', 'https://reg.example/a.tgz') })
      .toThrow('failed integrity verification')
    // A token without an algorithm separator is skipped, then the mismatch fails.
    expect(() => { verifySRI(digest, 'nodash sha512-wrong', 'https://reg.example/a.tgz') })
      .toThrow('failed integrity verification')
    expect(() => { verifySRI(digest, 'sha1-abcdef', 'https://reg.example/a.tgz') })
      .toThrow('no supported algorithm')
  })
})

describe('installNpmPackage integrity', () => {
  it('installs a tarball matching its declared integrity', async () => {
    const fixture = await fixtureTarball()
    vi.stubGlobal('fetch', async () => new Response(fixture.bytes, {
      status: 200, headers: { 'content-length': String(fixture.bytes.byteLength) },
    }))
    const out = await mkdtemp(join(tmpdir(), 'dsh-registry-ok-'))
    tempRoots.push(out)
    await installNpmPackage('demo', '1.0.0', packumentWith(`sha512-${fixture.sha512}`), join(out, 'pkg'))
    expect((await readFile(join(out, 'pkg', 'lib', 'index.js'), 'utf8'))).toContain('module.exports')
  })

  it('rejects a tarball that does not match its declared integrity', async () => {
    const fixture = await fixtureTarball()
    vi.stubGlobal('fetch', async () => new Response(fixture.bytes, {
      status: 200, headers: { 'content-length': String(fixture.bytes.byteLength) },
    }))
    const out = await mkdtemp(join(tmpdir(), 'dsh-registry-bad-'))
    tempRoots.push(out)
    await expect(installNpmPackage('demo', '1.0.0', packumentWith('sha512-dG90bW9tYW5nZXJlZA=='), join(out, 'pkg')))
      .rejects.toThrow('failed integrity verification')
  })

  it('rejects an integrity declaration with no supported algorithm', async () => {
    const fixture = await fixtureTarball()
    vi.stubGlobal('fetch', async () => new Response(fixture.bytes, {
      status: 200, headers: { 'content-length': String(fixture.bytes.byteLength) },
    }))
    const out = await mkdtemp(join(tmpdir(), 'dsh-registry-unsupported-'))
    tempRoots.push(out)
    await expect(installNpmPackage('demo', '1.0.0', packumentWith('sha1-Zm9v'), join(out, 'pkg')))
      .rejects.toThrow('no supported algorithm')
  })

  it('installs without verification when the registry declares no integrity', async () => {
    const fixture = await fixtureTarball()
    vi.stubGlobal('fetch', async () => new Response(fixture.bytes, {
      status: 200, headers: { 'content-length': String(fixture.bytes.byteLength) },
    }))
    const out = await mkdtemp(join(tmpdir(), 'dsh-registry-none-'))
    tempRoots.push(out)
    await installNpmPackage('demo', '1.0.0', packumentWith(undefined), join(out, 'pkg'))
  })
})
