/** Exercise the real directory-picker child from electron-builder's unpacked Windows application. */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') throw new Error('the packaged Win32 picker smoke requires Windows')

const appRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(appRoot, '../..')
const unpackedRoot = resolve(workspaceRoot, '.artifacts/desktop/release/win-unpacked')
const resourcesRoot = resolve(unpackedRoot, 'resources/app')
const executable = resolve(unpackedRoot, 'DSHCode.exe')
const manifestPath = resolve(resourcesRoot, 'package.json')
const fixtureSource = resolve(appRoot, 'tests/fixtures/win32-packaged-directory-picker-smoke.mjs')
const fixtureTarget = resolve(resourcesRoot, 'win32-packaged-directory-picker-smoke.mjs')

for (const requiredPath of [executable, manifestPath, fixtureSource]) {
  if (!existsSync(requiredPath)) throw new Error(`packaged Win32 picker smoke is missing ${requiredPath}`)
}

const originalManifest = readFileSync(manifestPath, 'utf8')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dshcode-win32-picker-smoke-'))
const resultPath = resolve(temporaryRoot, 'result.json')

try {
  const manifest = JSON.parse(originalManifest)
  manifest.main = 'win32-packaged-directory-picker-smoke.mjs'
  copyFileSync(fixtureSource, fixtureTarget)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const environment = { ...process.env, DSHCODE_PICKER_SMOKE_RESULT: resultPath }
  delete environment.ELECTRON_RUN_AS_NODE
  const completed = spawnSync(executable, [], {
    env: environment,
    stdio: 'inherit',
    timeout: 30_000,
  })
  if (completed.error !== undefined) throw completed.error
  if (completed.status !== 0) throw new Error(`packaged Win32 picker smoke exited with ${completed.status}`)
  if (!existsSync(resultPath)) throw new Error('packaged Win32 picker smoke exited without a result')

  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  if (result.ok !== true) throw new Error(`packaged Win32 picker smoke failed: ${String(result.error)}`)
} finally {
  writeFileSync(manifestPath, originalManifest)
  rmSync(fixtureTarget, { force: true })
  rmSync(temporaryRoot, { recursive: true, force: true })
}
