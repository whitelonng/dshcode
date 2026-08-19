/** Git-source install and remote-HEAD tests over mocked git and fetch. */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tar from 'tar'
import {
  githubCommitSha,
  gitRemoteHead,
  installFromGit,
  installFromGithub,
  normalizeGithubMirror,
  normalizeGitUrl,
  parseGithubUrl,
  validateGitIdentity,
  type GithubRepo,
} from '../src/git-source.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

const execFileMock = vi.mocked(execFile)
const tempRoots: string[] = []

afterEach(async () => {
  execFileMock.mockReset()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function execError(options: { message?: string; code?: string; stderr?: string } = {}): Error {
  const error = new Error(options.message ?? 'Command failed')
  if (options.code !== undefined) (error as Error & { code?: string }).code = options.code
  ;(error as Error & { stderr?: string }).stderr = options.stderr ?? ''
  return error
}

/** Answer the next execFile invocation with an error or a stdout/stderr pair. */
function answer(error: Error | null, stdout = '', stderr = ''): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
    // node:util.promisify resolves a single success value directly, so pass
    // the stdout/stderr pair as one object the same way the built-in
    // execFile custom promisify would.
    ;(callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
      error, { stdout, stderr },
    )
    return {} as never
  })
}

/** Build a gzipped repository tarball whose root is `<repo>-HEAD/` (codeload's layout). */
async function fixtureRepo(repoName: string, manifest: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-source-'))
  tempRoots.push(dir)
  const root = join(dir, `${repoName}-HEAD`)
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest), 'utf8')
  await writeFile(join(root, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
  const file = join(dir, 'repo.tgz')
  await tar.create({ gzip: true, cwd: dir, file }, [`${repoName}-HEAD`])
  const buffer = await readFile(file)
  const bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength))
  bytes.set(buffer)
  return bytes
}

/** Stub fetch answering one repository's codeload tarball and commits API. */
function stubGithub(tarball: Uint8Array<ArrayBuffer>, head: string, seen: string[] = []): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    seen.push(url)
    if (url.includes('codeload.github.com')) return new Response(tarball, { status: 200 })
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: head }), { status: 200 })
    return new Response('not found', { status: 404 })
  })
}

/** A fresh per-test target directory (registered for cleanup). */
async function targetDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-source-target-'))
  tempRoots.push(dir)
  return dir
}

describe('normalizeGitUrl', () => {
  it('expands the github: shorthand without relying on git config', () => {
    expect(normalizeGitUrl('github:Nagi-ovo/dsh-ads')).toBe('https://github.com/Nagi-ovo/dsh-ads.git')
    expect(normalizeGitUrl('github:Nagi-ovo/dsh-ads.git')).toBe('https://github.com/Nagi-ovo/dsh-ads.git')
    expect(normalizeGitUrl('git+github:Nagi-ovo/dsh-ads')).toBe('https://github.com/Nagi-ovo/dsh-ads.git')
  })

  it('preserves a pinned #ref on the shorthand', () => {
    expect(normalizeGitUrl('github:a/b#main')).toBe('https://github.com/a/b.git#main')
    expect(normalizeGitUrl('github:a/b.git#v1.0.0')).toBe('https://github.com/a/b.git#v1.0.0')
  })

  it('passes malformed shorthands through unchanged', () => {
    expect(normalizeGitUrl('github:')).toBe('github:')
    expect(normalizeGitUrl('github:owner/')).toBe('github:owner/')
    expect(normalizeGitUrl('github:owner/#main')).toBe('github:owner/#main')
    expect(normalizeGitUrl('github:a/b/c')).toBe('github:a/b/c')
  })

  it('strips the git+ prefix and passes other URLs through unchanged', () => {
    expect(normalizeGitUrl('git+https://github.com/a/b.git')).toBe('https://github.com/a/b.git')
    expect(normalizeGitUrl('https://github.com/a/b.git')).toBe('https://github.com/a/b.git')
    expect(normalizeGitUrl('https://github.com/a/b#main')).toBe('https://github.com/a/b#main')
    expect(normalizeGitUrl('git://github.com/a/b.git')).toBe('git://github.com/a/b.git')
    expect(normalizeGitUrl('git@github.com:a/b.git')).toBe('git@github.com:a/b.git')
  })
})

describe('parseGithubUrl', () => {
  it('parses plain and .git-suffixed URLs', () => {
    expect(parseGithubUrl('https://github.com/a/b')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseGithubUrl('https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseGithubUrl('https://github.com/a/b/')).toEqual({ owner: 'a', repo: 'b' })
  })

  it('parses a pinned #ref', () => {
    expect(parseGithubUrl('https://github.com/a/b#main')).toEqual({ owner: 'a', repo: 'b', ref: 'main' })
    expect(parseGithubUrl('https://github.com/a/b.git#v1.0.0')).toEqual({ owner: 'a', repo: 'b', ref: 'v1.0.0' })
    expect(parseGithubUrl('https://github.com/a/b#abc123def')).toEqual({ owner: 'a', repo: 'b', ref: 'abc123def' })
  })

  it('returns null for other hosts and un-normalized forms', () => {
    expect(parseGithubUrl('https://gitlab.com/a/b')).toBeNull()
    expect(parseGithubUrl('git://github.com/a/b')).toBeNull()
    expect(parseGithubUrl('github:a/b')).toBeNull()
    expect(parseGithubUrl('https://github.com/a')).toBeNull()
    expect(parseGithubUrl('https://github.com/a/b/tree/main')).toBeNull()
  })
})

describe('githubCommitSha', () => {
  const repo: GithubRepo = { owner: 'a', repo: 'b' }

  it('resolves HEAD and pinned refs through the commits endpoint', async () => {
    const seen: string[] = []
    stubGithub(new Uint8Array(0), 'abc123', seen)
    await expect(githubCommitSha(repo)).resolves.toBe('abc123')
    await expect(githubCommitSha({ ...repo, ref: 'v1.0.0' })).resolves.toBe('abc123')
    expect(seen[0]).toBe('https://api.github.com/repos/a/b/commits/HEAD')
    expect(seen[1]).toBe('https://api.github.com/repos/a/b/commits/v1.0.0')
  })

  it('returns undefined when the response carries no sha', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({}), { status: 200 }))
    await expect(githubCommitSha(repo)).resolves.toBeUndefined()
  })

  it('names the repository on a 404', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    await expect(githubCommitSha(repo)).rejects.toThrow('repository a/b not found')
  })

  it('names the rate limit on a 403', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 403 }))
    await expect(githubCommitSha(repo)).rejects.toThrow('rate limited')
  })

  it('sends the token from the environment when set', async () => {
    const seen: Array<RequestInit | undefined> = []
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init)
      return new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 })
    })
    vi.stubEnv('GITHUB_TOKEN', 'ghp_token')
    await githubCommitSha(repo)
    expect((seen[0]?.headers as Record<string, string>).authorization).toBe('Bearer ghp_token')
  })
})

describe('installFromGithub', () => {
  const repo: GithubRepo = { owner: 'a', repo: 'demo' }

  it('downloads the tarball and extracts the repository root', async () => {
    const tarball = await fixtureRepo('demo', { name: '@scope/demo', version: '1.0.0' })
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-target-'))
    tempRoots.push(target)
    await installFromGithub(repo, target)
    expect(seen[0]).toBe('https://codeload.github.com/a/demo/tar.gz/HEAD')
    expect(await readFile(join(target, 'lib', 'index.js'), 'utf8')).toContain('module.exports')
    expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))).toMatchObject({ name: '@scope/demo' })
  })

  it('uses a pinned ref in the tarball URL', async () => {
    const tarball = await fixtureRepo('demo', { name: '@scope/demo', version: '1.0.0' })
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-target-'))
    tempRoots.push(target)
    await installFromGithub({ ...repo, ref: 'v1.0.0' }, target)
    expect(seen[0]).toBe('https://codeload.github.com/a/demo/tar.gz/v1.0.0')
  })

  it('names the repository when codeload rejects', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    await expect(installFromGithub(repo, '/tmp/out')).rejects
      .toThrow('github tarball https://codeload.github.com/a/demo/tar.gz/HEAD answered 404 (repository not found — check the URL)')
  })
})

describe('gitRemoteHead', () => {
  it('resolves a GitHub repository through the API without touching git', async () => {
    stubGithub(new Uint8Array(0), 'abc123')
    await expect(gitRemoteHead('https://github.com/a/b')).resolves.toBe('abc123')
    await expect(gitRemoteHead('github:a/b')).resolves.toBe('abc123')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('routes the commit lookup through a configured mirror', async () => {
    const seen: string[] = []
    stubGithub(new Uint8Array(0), 'abc123', seen)
    await expect(gitRemoteHead('github:a/b', { mirror: 'https://gh-proxy.com/' })).resolves.toBe('abc123')
    expect(seen[0]).toBe('https://gh-proxy.com/https://api.github.com/repos/a/b/commits/HEAD')
  })

  it('falls back to git ls-remote when the API fails', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    answer(null, 'deadbee\tHEAD', '')
    await expect(gitRemoteHead('https://github.com/a/b')).resolves.toBe('deadbee')
    expect(execFileMock).toHaveBeenCalledWith(
      'git', ['ls-remote', 'https://github.com/a/b', 'HEAD'], { timeout: 60_000 }, expect.any(Function),
    )
  })

  it('returns undefined when the API fails and git is missing', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    answer(execError({ code: 'ENOENT' }))
    await expect(gitRemoteHead('https://github.com/a/b')).resolves.toBeUndefined()
  })

  it('falls back to git ls-remote when the API 404s', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    answer(null, 'deadbee\tHEAD', '')
    await expect(gitRemoteHead('https://github.com/a/b')).resolves.toBe('deadbee')
  })

  it('reads the remote HEAD hash for other hosts', async () => {
    answer(null, 'abc123\tHEAD', '')
    await expect(gitRemoteHead('https://gitlab.com/a/b')).resolves.toBe('abc123')
  })

  it('returns undefined when the remote reports no ref', async () => {
    answer(null, '', '')
    await expect(gitRemoteHead('https://gitlab.com/a/b')).resolves.toBeUndefined()
  })

  it('returns undefined when git is missing', async () => {
    answer(execError({ code: 'ENOENT' }))
    await expect(gitRemoteHead('https://gitlab.com/a/b')).resolves.toBeUndefined()
  })

  it('rethrows other failures unchanged', async () => {
    const failure = execError({ message: 'fatal: could not read from remote' })
    answer(failure)
    await expect(gitRemoteHead('https://gitlab.com/a/b')).rejects.toBe(failure)
  })
})

describe('installFromGit', () => {
  it('installs a GitHub repository from its tarball without git', async () => {
    const tarball = await fixtureRepo('demo', { name: '@scope/demo', version: '1.0.0' })
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('https://github.com/a/demo', target)).resolves.toBe('abc123')
    expect(seen).toEqual([
      'https://codeload.github.com/a/demo/tar.gz/HEAD',
      'https://api.github.com/repos/a/demo/commits/HEAD',
    ])
    expect(execFileMock).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))).toMatchObject({ name: '@scope/demo' })
  })

  it('installs the github: shorthand with a pinned ref', async () => {
    const tarball = await fixtureRepo('demo', { name: '@scope/demo', version: '1.0.0' })
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('github:a/demo#v1.0.0', target)).resolves.toBe('abc123')
    expect(seen[0]).toBe('https://codeload.github.com/a/demo/tar.gz/v1.0.0')
    expect(seen[1]).toBe('https://api.github.com/repos/a/demo/commits/v1.0.0')
  })

  it('routes the tarball and API URLs through a configured mirror', async () => {
    const tarball = await fixtureRepo('demo', { name: '@scope/demo', version: '1.0.0' })
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('github:a/demo', target, { mirror: 'https://gh-proxy.com/' })).resolves.toBe('abc123')
    expect(seen).toEqual([
      'https://gh-proxy.com/https://codeload.github.com/a/demo/tar.gz/HEAD',
      'https://gh-proxy.com/https://api.github.com/repos/a/demo/commits/HEAD',
    ])
  })

  it('falls back to a shallow clone when the tarball path fails and git exists', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    answer(null) // git --version
    answer(null) // git clone
    answer(null, 'deadbee\tHEAD', '') // git ls-remote
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('https://github.com/a/demo', target)).resolves.toBe('deadbee')
    expect(execFileMock).toHaveBeenNthCalledWith(
      2, 'git', ['clone', '--depth', '1', 'https://github.com/a/demo', target], { timeout: 300_000 }, expect.any(Function),
    )
  })

  it('rethrows the tarball failure when git is missing', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    answer(execError({ code: 'ENOENT' })) // git --version
    await expect(installFromGit('https://github.com/a/demo', await targetDir())).rejects.toThrow('offline')
  })

  it('promotes a monorepo shell around exactly one package to the target root', async () => {
    // A repo whose sole package.json sits at packages/group/name: the
    // tarball extracts the shell, then promotion moves the package up.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-source-'))
    tempRoots.push(dir)
    const shell = join(dir, 'demo-HEAD')
    const pkg = join(shell, 'packages', 'vision', 'demo')
    await mkdir(join(pkg, 'lib'), { recursive: true })
    await writeFile(join(shell, 'README.md'), 'monorepo shell\n', 'utf8')
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@scope/demo', version: '1.0.0' }), 'utf8')
    await writeFile(join(pkg, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
    const file = join(dir, 'repo.tgz')
    await tar.create({ gzip: true, cwd: dir, file }, ['demo-HEAD'])
    const buffer = await readFile(file)
    const tarball = new Uint8Array(new ArrayBuffer(buffer.byteLength))
    tarball.set(buffer)
    const seen: string[] = []
    stubGithub(tarball, 'abc123', seen)
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('https://github.com/a/demo', target)).resolves.toBe('abc123')
    expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))).toMatchObject({ name: '@scope/demo' })
    expect(await readFile(join(target, 'lib', 'index.js'), 'utf8')).toContain('module.exports')
    expect(await readFile(join(target, 'package.json'), 'utf8')).not.toContain('packages/vision')
  })

  it('rejects a repository with several package manifests, naming them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-source-'))
    tempRoots.push(dir)
    const shell = join(dir, 'demo-HEAD')
    await mkdir(join(shell, 'packages', 'one'), { recursive: true })
    await mkdir(join(shell, 'packages', 'two'), { recursive: true })
    await writeFile(join(shell, 'packages', 'one', 'package.json'), JSON.stringify({ name: 'one' }), 'utf8')
    await writeFile(join(shell, 'packages', 'two', 'package.json'), JSON.stringify({ name: 'two' }), 'utf8')
    const file = join(dir, 'repo.tgz')
    await tar.create({ gzip: true, cwd: dir, file }, ['demo-HEAD'])
    const buffer = await readFile(file)
    const tarball = new Uint8Array(new ArrayBuffer(buffer.byteLength))
    tarball.set(buffer)
    stubGithub(tarball, 'abc123')
    await expect(installFromGit('https://github.com/a/demo', await targetDir())).rejects
      .toThrow('2 package.json manifests (packages/one/package.json, packages/two/package.json)')
  })

  it('leaves a checkout without any manifest for the identity error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-source-'))
    tempRoots.push(dir)
    const shell = join(dir, 'demo-HEAD')
    await mkdir(join(shell, 'docs'), { recursive: true })
    await writeFile(join(shell, 'docs', 'readme.md'), 'no package here\n', 'utf8')
    const file = join(dir, 'repo.tgz')
    await tar.create({ gzip: true, cwd: dir, file }, ['demo-HEAD'])
    const buffer = await readFile(file)
    const tarball = new Uint8Array(new ArrayBuffer(buffer.byteLength))
    tarball.set(buffer)
    stubGithub(tarball, 'abc123')
    const target = await mkdtemp(join(tmpdir(), 'dsh-git-source-install-'))
    tempRoots.push(target)
    await expect(installFromGit('https://github.com/a/demo', target)).resolves.toBe('abc123')
    await expect(readFile(join(target, 'docs', 'readme.md'), 'utf8')).resolves.toContain('no package here')
  })

  it('never falls back to a clone when codeload answers 404', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    await expect(installFromGit('https://github.com/a/demo', await targetDir())).rejects
      .toThrow('answered 404 (repository not found')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('clones and reads the HEAD for other git hosts', async () => {
    answer(null)
    answer(null, 'abc123\tHEAD', '')
    const target = await targetDir()
    await expect(installFromGit('https://gitlab.com/a/b', target)).resolves.toBe('abc123')
    expect(execFileMock).toHaveBeenNthCalledWith(
      1, 'git', ['clone', '--depth', '1', 'https://gitlab.com/a/b', target], { timeout: 300_000 }, expect.any(Function),
    )
  })

  it('rejects when the clone succeeds but the remote HEAD cannot be read', async () => {
    answer(null)
    answer(null, '', '')
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('could not read HEAD of https://gitlab.com/a/b')
  })

  it('rejects with a clear message when git is missing', async () => {
    answer(execError({ code: 'ENOENT' }))
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('git is required for repository sources')
  })

  it('folds clone stderr into the failure', async () => {
    answer(execError({ message: 'Command failed', stderr: 'fatal: could not read from remote\n' }))
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('git clone failed for https://gitlab.com/a/b: Command failed: fatal: could not read from remote')
  })

  it('truncates very long clone stderr', async () => {
    answer(execError({ stderr: `fatal: ${'x'.repeat(400)}` }))
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('…')
  })

  it('uses the error message when stderr is empty', async () => {
    answer(execError({ message: 'killed' }))
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('git clone failed for https://gitlab.com/a/b: killed')
  })

  it('uses the error name when the message is empty', async () => {
    answer(execError({ message: '' }))
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('git clone failed for https://gitlab.com/a/b: Error')
  })

  it('stringifies non-Error causes', async () => {
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      ;(callback as (error: unknown, result: unknown) => void)('crash', { stdout: '', stderr: '' })
      return {} as never
    })
    await expect(installFromGit('https://gitlab.com/a/b', await targetDir()))
      .rejects.toThrow('git clone failed for https://gitlab.com/a/b: crash')
  })
})

describe('normalizeGithubMirror', () => {
  it('passes unset and blank values through as undefined', () => {
    expect(normalizeGithubMirror(undefined)).toBeUndefined()
    expect(normalizeGithubMirror('')).toBeUndefined()
    expect(normalizeGithubMirror('   ')).toBeUndefined()
  })

  it('normalizes an http(s) prefix to end in a slash', () => {
    expect(normalizeGithubMirror('https://gh-proxy.com')).toBe('https://gh-proxy.com/')
    expect(normalizeGithubMirror('https://gh-proxy.com/')).toBe('https://gh-proxy.com/')
    expect(normalizeGithubMirror('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
  })

  it('rejects a set non-http(s) value', () => {
    expect(() => normalizeGithubMirror('gh-proxy.com')).toThrow('must be an http(s) URL prefix')
    expect(() => normalizeGithubMirror('ftp://mirror.example')).toThrow('must be an http(s) URL prefix')
  })
})

describe('validateGitIdentity', () => {
  const url = 'https://github.com/example/demo'

  it('accepts a single-package manifest with a valid name', () => {
    expect(() => {
      validateGitIdentity(url, {
        name: '@scope/demo',
        manifest: { name: '@scope/demo', version: '1.0.0' },
      })
    }).not.toThrow()
  })

  it('accepts a private single-package manifest (a git-only distribution choice)', () => {
    expect(() => {
      validateGitIdentity(url, {
        name: '@dsh-external/dsh-visualize',
        manifest: { name: '@dsh-external/dsh-visualize', version: '0.1.2', private: true, main: 'lib/index.js' },
      })
    }).not.toThrow()
  })

  it('rejects a private workspace root instead of installing it as the plugin', () => {
    expect(() => {
      validateGitIdentity(url, {
        name: 'demo',
        manifest: { name: 'demo', private: true, workspaces: ['packages/*'] },
      })
    }).toThrow('is a multi-package workspace root')
  })

  it('rejects a manifest with declared workspaces even when not private', () => {
    expect(() => {
      validateGitIdentity(url, {
        name: 'demo',
        manifest: { name: 'demo', workspaces: ['packages/*'] },
      })
    }).toThrow('is a multi-package workspace root')
  })

  it('rejects an invalid package name', () => {
    expect(() => {
      validateGitIdentity(url, {
        name: '../evil',
        manifest: { name: '../evil' },
      })
    }).toThrow('declares invalid package name "../evil"')
  })
})
