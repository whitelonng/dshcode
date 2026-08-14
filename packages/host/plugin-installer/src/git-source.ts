/** Git-source support for plugin installs and update checks. */

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Max clone depth for plugin installs. */
const CLONE_DEPTH = 1

/**
 * Read the remote HEAD hash of a git repository.
 * @param url - git repository URL.
 * @returns the HEAD commit hash, or `undefined` when git is unavailable.
 * @throws when git exists but the remote refuses.
 */
export async function gitRemoteHead(url: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', url, 'HEAD'], { timeout: 30_000 })
    const hash = stdout.trim().split(/\s+/)[0]
    return hash === undefined || hash === '' ? undefined : hash
  } catch (error: unknown) {
    const cause = error as { code?: string }
    if (cause.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Clone a git repository into a target directory (shallow).
 * @param url - git repository URL.
 * @param targetDir - destination directory (created).
 * @returns the cloned HEAD commit hash.
 * @throws when git is unavailable or the clone fails.
 */
export async function installFromGit(url: string, targetDir: string): Promise<string> {
  await mkdir(targetDir, { recursive: true })
  try {
    await execFileAsync('git', ['clone', '--depth', String(CLONE_DEPTH), url, targetDir], { timeout: 120_000 })
  } catch (error: unknown) {
    const cause = error as { code?: string }
    if (cause.code === 'ENOENT') {
      throw new Error('plugin-installer: git is required for repository sources and was not found on this machine')
    }
    throw new Error(`plugin-installer: git clone failed for ${url}`, { cause: error })
  }
  const head = await gitRemoteHead(url)
  if (head === undefined) throw new Error(`plugin-installer: could not read HEAD of ${url}`)
  return head
}
