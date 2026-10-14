import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Monorepo: trace dependencies from the repo root so the standalone build includes the workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  reactStrictMode: true,
  transpilePackages: ['@open-event-db/shared'],
  webpack(config) {
    // shared is consumed as TS source with NodeNext-style `./x.js` imports
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
