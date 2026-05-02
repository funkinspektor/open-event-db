import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/health', async () => ({ status: 'ok' }))

const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '0.0.0.0'

app.listen({ port, host }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
