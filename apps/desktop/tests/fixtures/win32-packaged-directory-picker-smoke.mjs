import { writeFileSync } from 'node:fs'
import { app } from 'electron'
import { pickNativeDirectory } from '@deepseek-ai/dsh-host-directory-picker-native'

const resultPath = process.env.DSHCODE_PICKER_SMOKE_RESULT
if (resultPath === undefined || resultPath === '') {
  throw new Error('DSHCODE_PICKER_SMOKE_RESULT is required')
}

function finish(ok, error) {
  writeFileSync(resultPath, `${JSON.stringify({ ok, error })}\n`)
  app.exit(ok ? 0 : 1)
}

async function runSmoke() {
  const controller = new AbortController()
  const abortTimer = setTimeout(() => controller.abort(), 800)
  try {
    await pickNativeDirectory(controller.signal, { platform: 'win32' })
    finish(false, 'directory picker resolved before the smoke abort')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    finish(controller.signal.aborted && message === 'native directory picker aborted', message)
  } finally {
    clearTimeout(abortTimer)
  }
}

// A worker accidentally relaunched as DSHCode loses this lock and exits
// before it can report a dialog result to the parent.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  void app.whenReady().then(runSmoke).catch((error) => {
    finish(false, error instanceof Error ? (error.stack ?? error.message) : String(error))
  })
}
