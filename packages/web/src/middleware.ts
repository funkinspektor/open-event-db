import { NextResponse, type NextRequest } from 'next/server'

// Must match SESSION_COOKIE / SESSION_TTL_MS in packages/api/src/auth.ts.
const SESSION_COOKIE = 'oedb_session'
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

// The API sets the session cookie once at login, but the session itself slides with activity.
// Re-issuing the cookie on page visits keeps the browser from dropping it 30 days after login
// while the session is still valid server-side. The API remains the source of truth for expiry.
export function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_S,
    })
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|icon.svg|apple-icon.png).*)'],
}
