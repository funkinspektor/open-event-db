import { NextResponse, type NextRequest } from 'next/server'

// Must match SESSION_COOKIE / SESSION_TTL_MS in packages/api/src/auth.ts.
const SESSION_COOKIE = 'oedb_session'
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

// Optional gate for a staging deployment: BASIC_AUTH="user:password" asks for credentials on every page,
// SITE_NOINDEX=true keeps search engines out. Both unset in local dev and once the site is public.
function unauthorized(req: NextRequest): NextResponse | null {
  const expected = process.env.BASIC_AUTH
  if (!expected) return null
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Basic ') && atob(header.slice(6)) === expected) return null
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Kellerkompass", charset="UTF-8"' },
  })
}

export function middleware(req: NextRequest) {
  const denied = unauthorized(req)
  if (denied) return denied

  const res = NextResponse.next()
  if (process.env.SITE_NOINDEX === 'true') res.headers.set('X-Robots-Tag', 'noindex, nofollow')

  // The API sets the session cookie once at login, but the session itself slides with activity.
  // Re-issuing the cookie on page visits keeps the browser from dropping it 30 days after login
  // while the session is still valid server-side. The API remains the source of truth for expiry.
  // Same attributes as the API's cookie, incl. COOKIE_DOMAIN, so this overwrites it instead of adding a second one.
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      domain: process.env.COOKIE_DOMAIN || undefined,
      maxAge: SESSION_MAX_AGE_S,
    })
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|icon.svg|apple-icon.png).*)'],
}
