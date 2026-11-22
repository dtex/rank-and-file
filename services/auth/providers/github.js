// GitHub sign-in. `user:email` is needed because the address is often not public.
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'chess-buddy' })

export default {
  id: 'github',
  name: 'GitHub',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scope: 'user:email',
  async profile(accessToken, fetchImpl) {
    const user = await fetchImpl('https://api.github.com/user', { headers: headers(accessToken) })
    if (!user.ok) throw new Error(`GitHub returned ${user.status} for the profile`)
    const { id } = await user.json()
    const res = await fetchImpl('https://api.github.com/user/emails', { headers: headers(accessToken) })
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for the email addresses`)
    const primary = (await res.json()).find((e) => e.primary && e.verified)
    return { subject: String(id), email: primary?.email ?? null, emailVerified: !!primary }
  },
}
