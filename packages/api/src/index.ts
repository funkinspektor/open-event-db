import { buildApp } from './app.js'
import { CLEANUP_INTERVAL_MS, cleanupExpiredAuth } from './cleanup.js'

const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '0.0.0.0'

const app = await buildApp()

app.listen({ port, host }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})

async function cleanup() {
  try {
    const removed = await cleanupExpiredAuth()
    if (removed.tokens || removed.sessions) app.log.info(removed, 'removed expired auth tokens and sessions')
  } catch (err) {
    app.log.error({ err }, 'auth cleanup failed')
  }
}
void cleanup()
setInterval(cleanup, CLEANUP_INTERVAL_MS).unref()
