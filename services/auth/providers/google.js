// Google sign-in. `openid email` is the least that returns a verified address.
export default {
  id: 'google',
  name: 'Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'openid email',
  async profile(accessToken, fetchImpl) {
    const res = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`Google returned ${res.status} for the profile`)
    const p = await res.json()
    return { subject: String(p.sub), email: p.email ?? null, emailVerified: p.email_verified === true || p.email_verified === 'true' }
  },
}
