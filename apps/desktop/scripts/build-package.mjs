/** Stage the desktop runtime, then invoke electron-builder for the requested target. */

import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { stageRoot, workspaceRoot } from './prepare-package.mjs'

const outputRoot = resolve(workspaceRoot, '.artifacts/desktop/release')
const require = createRequire(import.meta.url)
const builderCli = require.resolve('electron-builder/cli.js')
const built = spawnSync(process.execPath, [builderCli,
  '--projectDir', stageRoot,
  `--config.directories.output=${outputRoot}`,
  ...process.argv.slice(2),
], {
  cwd: stageRoot,
  stdio: 'inherit',
})
if (built.error !== undefined) throw built.error
if (built.status !== 0) process.exit(built.status ?? 1)
