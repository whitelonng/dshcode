/** Shared lifecycle for snapshot HTTP fixtures that bind an ephemeral loopback port. */
import { createServer } from 'node:http'

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError)
      reject(error)
    }
    server.once('error', onError)
    try {
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve(undefined)
      })
    } catch (error) {
      server.off('error', onError)
      reject(error)
    }
  })
}

async function close(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve(undefined))
    server.closeAllConnections()
  })
}

async function cleanup(server, onCleanup, label) {
  const errors = []
  try {
    onCleanup()
  } catch (error) {
    errors.push(error)
  }
  try {
    await close(server)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${label}: cleanup failed`)
}

/**
 * Start a loopback server as a Cordis effect and join cleanup with its setup.
 * @param ctx - Cordis context that owns the listener effect.
 * @param options - Fixture callbacks and the effect label used in diagnostics.
 */
export async function applyLoopbackServerEffect(ctx, options) {
  const { label, onCleanup, onListening, requestListener } = options
  await ctx.effect(async () => {
    const server = createServer(requestListener)
    try {
      await listen(server)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error(`${label}: loopback listener has no TCP address`)
      }
      onListening(address)
      // Snapshot fixtures must never hold the process open past protocol shutdown.
      server.unref()
      return () => cleanup(server, onCleanup, label)
    } catch (cause) {
      try {
        await cleanup(server, onCleanup, label)
      } catch (cleanupError) {
        throw new AggregateError([cause, cleanupError], `${label}: setup and cleanup failed`)
      }
      throw cause
    }
  }, label)
}
