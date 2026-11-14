import { fileURLToPath } from 'node:url'

// Hosts whose images the web server resizes (`/_next/image`): the production event images bucket.
// Images from anywhere else (feed previews, local development) are shown as they are.
const IMAGE_HOSTS = ['kellerkompass-images.s3.nl-ams.scw.cloud']

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Monorepo: trace dependencies from the repo root so the standalone build includes the workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  reactStrictMode: true,
  transpilePackages: ['@open-event-db/shared'],
  // Read by src/lib/image-src.ts, which only rewrites URLs the optimizer accepts.
  env: { KK_IMAGE_HOSTS: IMAGE_HOSTS.join(',') },
  images: {
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({ protocol: 'https', hostname, pathname: '/**' })),
    // Image keys never repeat (a new upload gets a new key), so resized copies can be cached for a year.
    minimumCacheTTL: 31536000,
  },
  async redirects() {
    return [{ source: '/publishers/:slug', destination: '/organizers/:slug', permanent: true }]
  },
  async headers() {
    // The email-change link carries a one-time token in its query string.
    return [{ source: '/confirm-email', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }]
  },
  webpack(config) {
    // shared is consumed as TS source with NodeNext-style `./x.js` imports
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
