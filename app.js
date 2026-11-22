import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { createAccounts } from './services/accounts.js'
import { loadConfig } from './services/config.js'
import { loadPlan } from './services/entitlement.js'
import { createMailer } from './services/mailer.js'
import { createStore } from './services/store.js'
import accountRoutes from './routes/account.js'
import authRoutes, { SESSION_COOKIE } from './routes/auth.js'
import missionRoutes from './routes/missions.js'
import settingsRoutes from './routes/settings.js'
import syncRoutes from './routes/sync.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

/** Paths a signed-in user may use before finishing the consent step. */
const BEFORE_CONSENT = ['/api/me', '/api/account']

export function buildApp({ pool, config = loadConfig(), fetchImpl = fetch, mailer, logger = true } = {}) {
  const app = Fastify({
    trustProxy: config.trustProxy,
    // Query strings can carry sign-in codes and tokens, so they stay out of the log.
    logger: logger && { serializers: { req: (req) => ({ method: req.method, url: req.url.split('?')[0], remoteAddress: req.ip }) } },
  })
  const store = createStore(pool)
  const accounts = createAccounts(pool, { secret: config.sessionSecret })
  app.decorate('ctx', { pool, store, accounts, config, fetchImpl, mailer: mailer ?? createMailer(config, app.log) })
  app.decorateRequest('user', null)
  app.decorateRequest('cb', null)

  app.register(fastifyCookie, { secret: config.sessionSecret })
  app.register(fastifyRateLimit, { global: false })

  // Requests that change something must come from our own pages. Together with
  // SameSite cookies this stops other sites acting as a signed-in user.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    const { origin } = req.headers
    if (origin && origin !== config.origin) return reply.code(403).send({ error: 'That request came from another site.' })
  })

  // Errors thrown with a statusCode are messages for the user; anything else is a bug.
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) req.log.error(err)
    const { statusCode, message, stack, name, code, ...extra } = err
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong on our side.' : message, ...(status < 500 ? extra : {}) })
  })

  app.register(fastifyStatic, { root: path.join(ROOT, 'public') })
  app.register(authRoutes)

  // Everything under /api belongs to the signed-in user and works only on their data.
  app.register(async (api) => {
    api.addHook('preHandler', async (req, reply) => {
      const user = await accounts.sessionUser(req.cookies[SESSION_COOKIE])
      if (!user) return reply.code(401).send({ error: 'Sign in to continue.' })
      req.user = user
      req.cb = { store: store.forUser(user.id), fetchImpl, plan: await loadPlan(pool, user) }
      if (!user.accepted_terms_at && !BEFORE_CONSENT.some((p) => req.url.startsWith(p))) {
        return reply.code(403).send({ error: 'Accept the terms to continue.', needsConsent: true })
      }
    })
    api.register(accountRoutes)
    api.register(syncRoutes)
    api.register(settingsRoutes)
    api.register(missionRoutes)
  })
  return app
}
