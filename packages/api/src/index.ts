import { buildApp } from './app.js'

const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '0.0.0.0'

const app = await buildApp()

app.listen({ port, host }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
