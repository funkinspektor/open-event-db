// Public origin of the web app, for canonical URLs, Open Graph and absolute Schema.org links.
// Server-side only; the same WEB_URL the API uses for magic-link redirects.
export const SITE_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`

const SHARE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'Kellerkompass — Events in Berlin' }

/**
 * Canonical URL + Open Graph + Twitter card for a public page. A page that sets its own `openGraph`
 * replaces the root one entirely, so the default share image has to be repeated here. `image` (an event
 * image) replaces the default one.
 */
export function shareMetadata(path: string, title: string, description: string, image?: string | null) {
  const images: { url: string; width?: number; height?: number; alt?: string }[] = image ? [{ url: image }] : [SHARE_IMAGE]
  return {
    alternates: { canonical: path },
    openGraph: { type: 'website' as const, url: path, title, description, images },
    twitter: { card: 'summary_large_image' as const, title, description, images: images.map((i) => i.url) },
  }
}
