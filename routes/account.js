// The signed-in user's own account: consent, email, data export and deletion.
import { CONSENT_TEXT, LINK_MINUTES, POLICY_VERSION, isEmail, normalizeEmail } from '../services/accounts.js'
import { linkEmail } from '../services/mailer.js'
import { planView } from '../services/views.js'
import { SESSION_COOKIE } from './auth.js'

export default async function accountRoutes(app) {
  const { accounts, config, mailer } = app.ctx

  app.get('/api/me', async (req) => {
    const u = req.user
    const progress = await req.cb.store.loadProgress()
    return {
      email: u.email,
      username: progress.settings.username || null,
      needsConsent: !u.accepted_terms_at,
      marketing: u.marketing_opt_in,
      methods: await accounts.methods(u.id),
      policyVersion: POLICY_VERSION,
      consentText: CONSENT_TEXT,
      plan: planView(req.cb.plan),
      admin: req.cb.admin,
    }
  })

  app.post('/api/account/consent', async (req, reply) => {
    const { age, terms, marketing } = req.body || {}
    if (age !== true || terms !== true) {
      return reply.code(400).send({ error: 'Confirm your age and accept the terms to use Rank and File.' })
    }
    if (!req.user.accepted_terms_at) await accounts.acceptTerms(req.user.id, { marketing: marketing === true })
    return { ok: true }
  })

  app.put('/api/account/marketing', async (req) => {
    await accounts.setMarketing(req.user.id, req.body?.on === true, 'settings')
    return { marketing: req.body?.on === true }
  })

  // Sends a confirmation link to the new address; nothing changes until it is used.
  app.post('/api/account/email', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const email = normalizeEmail(req.body?.email)
    if (!isEmail(email)) return reply.code(400).send({ error: 'Enter a valid email address.' })
    if (email === req.user.email) return reply.code(400).send({ error: 'That is already your address.' })
    // Same answer whether or not the address is taken, so accounts cannot be probed.
    if (!(await accounts.emailInUse(email))) {
      const token = await accounts.createLink(email, { purpose: 'change_email', userId: req.user.id })
      if (token) {
        try {
          await mailer.send({ to: email, ...linkEmail({ baseUrl: config.baseUrl, token, purpose: 'change_email', minutes: LINK_MINUTES }) })
        } catch (err) {
          req.log.error(`Could not send a confirmation email: ${err.message}`)
          return reply.code(502).send({ error: 'The confirmation email could not be sent. Try again in a moment.' })
        }
      }
    }
    return { sent: true, minutes: LINK_MINUTES }
  })

  app.get('/api/account/export', async (req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="rank-and-file-data.json"')
    return accounts.exportData(req.user.id)
  })

  app.delete('/api/account', async (req, reply) => {
    await app.ctx.beforeDelete?.(req.user)
    await accounts.deleteAccount(req.user.id)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { deleted: true }
  })
}
