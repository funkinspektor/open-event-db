import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// Project-wide default share image (PRD: no per-event images in v0.1). Next applies it to every
// page below the root; fonts come from local @fontsource packages, so the build fetches nothing.
export const alt = 'Kellerkompass — Events in Berlin'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const CHROME = 'linear-gradient(100deg, #9A9AA3, #F7F7FA, #D9C9FF, #A8EEFF, #E2E2E8)'

export default async function OpengraphImage() {
  const root = process.cwd()
  const font = (pkg: string, file: string) => readFile(join(root, 'node_modules/@fontsource', pkg, 'files', file))
  const [germania, grotesk, grotesk700, icon] = await Promise.all([
    font('germania-one', 'germania-one-latin-400-normal.woff'),
    font('schibsted-grotesk', 'schibsted-grotesk-latin-400-normal.woff'),
    font('schibsted-grotesk', 'schibsted-grotesk-latin-700-normal.woff'),
    readFile(join(root, 'src/app/icon.svg')),
  ])
  const mark = `data:image/svg+xml;base64,${icon.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: '#0C0C0D',
          color: '#EDEDEF',
          fontFamily: 'Schibsted Grotesk',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={72} height={72} alt="" />
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -0.5 }}>Kellerkompass</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', fontFamily: 'Germania One', fontSize: 168, lineHeight: 0.88 }}>
            <span>Events in&nbsp;</span>
            <span style={{ backgroundImage: CHROME, backgroundClip: 'text', color: 'transparent' }}>Berlin</span>
          </div>
          <span style={{ fontSize: 34, color: '#A0A0A8', maxWidth: 900, lineHeight: 1.35 }}>
            A community-owned database of events. Open data, open API, no algorithm.
          </span>
        </div>

        <div style={{ display: 'flex', height: 4, borderRadius: 2, backgroundImage: CHROME }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Germania One', data: germania, weight: 400, style: 'normal' },
        { name: 'Schibsted Grotesk', data: grotesk, weight: 400, style: 'normal' },
        { name: 'Schibsted Grotesk', data: grotesk700, weight: 700, style: 'normal' },
      ],
    },
  )
}
