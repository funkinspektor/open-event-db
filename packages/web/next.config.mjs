/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@open-event-db/shared'],
  webpack(config) {
    // shared is consumed as TS source with NodeNext-style `./x.js` imports
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
