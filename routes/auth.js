// Signing in and out: OAuth providers and emailed links. No passwords anywhere.
import { PROVIDERS } from '../services/auth/providers/index.js'
import { authorizeUrl, completeSignIn, newAttempt } from '../services/auth/oauth.js'
import { LINK_MINUTES, SESSION_DAYS, isEmail, normalizeEmail } from '../services/accounts.js'
import { linkEmail } from '../services/mailer.js'

export const SESSION_COOKIE = 'cb_sid'
const ATTEMPT_COOKIE = 'cb_oauth'

export default async function authRoutes(app) {
  const { accounts, config, mailer, fetchImpl } = app.ctx
  const cookieBase = { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies }
  const enabled = (id) => (PROVIDERS[id] && config.providers[id] ? PROVIDERS[id] : null)
  const callbackUrl = (id) => `${config.baseUrl}/auth/${id}/callback`
  const limit = (max) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } })

  async function startSession(reply, userId) {
    const id = await accounts.createSession(userId)
    reply.setCookie(SESSION_COOKIE, id, { ...cookieBase, maxAge: SESSION_DAYS * 86400 })
  }
  app.decorate('startSession', startSession)

  /** What the sign-in screen should offer. */
  app.get('/auth/options', async () => ({
    providers: Object.keys(PROVIDERS).filter(enabled).map((id) => ({ id, name: PROVIDERS[id].name })),
    magic: true,
  }))

  app.get('/auth/:provider/start', limit(20), async (req, reply) => {
    const provider = enabled(req.params.provider)
    if (!provider) return reply.code(404).send({ error: 'That sign-in method is not available.' })
    const attempt = newAttempt()
    reply.setCookie(ATTEMPT_COOKIE, JSON.stringify({ ...attempt, provider: provider.id }), { ...cookieBase, signed: true, maxAge: 600 })
    return reply.redirect(authorizeUrl(provider, config.providers[provider.id], attempt, callbackUrl(provider.id)))
  })

  app.get('/auth/:provider/callback', limit(20), async (req, reply) => {
    const fail = (code) => reply.clearCookie(ATTEMPT_COOKIE, cookieBase).redirect(`/#login-error=${code}`)
    const provider = enabled(req.params.provider)
    if (!provider) return fail('unavailable')

    const cookie = req.unsignCookie(req.cookies[ATTEMPT_COOKIE] || '')
    let attempt = null
    try {
      attempt = cookie.valid ? JSON.parse(cookie.value) : null
    } catch { /* treated as missing */ }
    const { code, state } = req.query
    if (!attempt || attempt.provider !== provider.id || !code || state !== attempt.state) return fail('expired')

    let profile
    try {
      profile = await completeSignIn(provider, config.providers[provider.id], { code, verifier: attempt.verifier }, callbackUrl(provider.id), fetchImpl)
    } catch (err) {
      req.log.warn(err.message)
      return fail('provider')
    }
    // Accounts are matched by email, so an address the provider has not verified is not enough.
    if (!profile.email || !profile.emailVerified) return fail('no-email')

    const userId = await accounts.signIn({ provider: provider.id, subject: profile.subject, email: profile.email })
    await startSession(reply, userId)
    return reply.clearCookie(ATTEMPT_COOKIE, cookieBase).redirect('/')
  })

  // Always answers the same way, so it cannot be used to find out who has an account.
  app.post('/auth/magic', limit(5), async (req, reply) => {
    const email = normalizeEmail(req.body?.email)
    if (!isEmail(email)) return reply.code(400).send({ error: 'Enter a valid email address.' })
    const token = await accounts.createLink(email)
    if (token) {
      try {
        await mailer.send({ to: email, ...linkEmail({ baseUrl: config.baseUrl, token, purpose: 'login', minutes: LINK_MINUTES }) })
      } catch (err) {
        req.log.error(`Could not send a sign-in email: ${err.message}`)
        return reply.code(502).send({ error: 'The sign-in email could not be sent. Try again in a moment.' })
      }
    }
    return { sent: true, minutes: LINK_MINUTES }
  })

  // The emailed link opens a page with a button that posts here, so a mail
  // scanner that merely opens links cannot use the token up.
  app.post('/auth/magic/verify', limit(20), async (req, reply) => {
    const link = await accounts.consumeLink(req.body?.token)
    if (!link) return reply.code(400).send({ error: 'That link has expired or was already used. Ask for a new one.' })
    if (link.purpose === 'change_email') {
      const ok = await accounts.changeEmail(link.userId, link.email)
      if (!ok) return reply.code(409).send({ error: 'Another account already uses that address.' })
      return { purpose: link.purpose }
    }
    const userId = await accounts.signIn({ provider: 'email', subject: link.email, email: link.email })
    await startSession(reply, userId)
    return { purpose: link.purpose }
  })

  app.post('/auth/logout', async (req, reply) => {
    await accounts.endSession(req.cookies[SESSION_COOKIE])
    reply.clearCookie(SESSION_COOKIE, cookieBase)
    return { ok: true }
  })

  // Unsubscribe from marketing email without signing in. The link in an email
  // opens the confirmation page; mail clients' one-click unsubscribe posts directly.
  const page = (body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rank and File email preferences</title><link rel="stylesheet" href="/app.css">
<body><div class="page"><div class="form">${body}<p><a href="/">Rank and File</a> <span class="tagline">Chess training for the rest of us</span></p></div></div></body></html>`

  app.get('/unsubscribe', async (req, reply) => {
    const ok = accounts.readUnsubscribeToken(req.query.t)
    reply.type('text/html')
    if (!ok) return reply.code(400).send(page('<h2>This link is not valid</h2><p>You can change email preferences in Settings after signing in.</p>'))
    return page(`<h2>Stop news and tips emails?</h2><p>You will still get sign-in links and receipts.</p>
      <form method="post" action="/unsubscribe?t=${encodeURIComponent(req.query.t)}"><button class="pri">Unsubscribe</button></form>`)
  })

  app.post('/unsubscribe', async (req, reply) => {
    const userId = accounts.readUnsubscribeToken(req.query.t)
    reply.type('text/html')
    if (!userId) return reply.code(400).send(page('<h2>This link is not valid</h2>'))
    await accounts.setMarketing(userId, false, 'unsubscribe_link')
    return page('<h2>You are unsubscribed</h2><p>You will not get news and tips emails from Rank and File.</p>')
  })
}
