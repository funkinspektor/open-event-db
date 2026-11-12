import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))

  // TEMPORARY (2026-11-12): shows the caller only their own forwarding headers, to work out which
  // X-Forwarded-For entry Scaleway's proxies add for the client. Remove once TRUST_PROXY is settled.
  app.get('/health/client-ip', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const h = req.headers
    return {
      socket: req.socket.remoteAddress ?? null,
      ip: req.ip,
      ips: req.ips ?? null,
      x_forwarded_for: h['x-forwarded-for'] ?? null,
      x_envoy_external_address: h['x-envoy-external-address'] ?? null,
      x_real_ip: h['x-real-ip'] ?? null,
      forwarded: h['forwarded'] ?? null,
      x_forwarded_proto: h['x-forwarded-proto'] ?? null,
    }
  })
}
