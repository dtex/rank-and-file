// Everything that differs between machines comes from the environment (see .env.example).
import { randomBytes } from 'node:crypto'

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3210)
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '')
  const production = env.NODE_ENV === 'production'
  if (production && !env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production.')

  const providers = {}
  for (const id of ['google', 'github']) {
    const clientId = env[`${id.toUpperCase()}_CLIENT_ID`]
    const clientSecret = env[`${id.toUpperCase()}_CLIENT_SECRET`]
    if (clientId && clientSecret) providers[id] = { clientId, clientSecret }
  }

  return {
    port,
    host: env.HOST || '127.0.0.1',
    baseUrl,
    origin: new URL(baseUrl).origin,
    secureCookies: baseUrl.startsWith('https://'),
    production,
    // Without a fixed secret, sessions still work but signed links stop working after a restart.
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    providers,
    // Email addresses of accounts that may look at hidden openings (see .env.example). Stored lower-cased.
    adminEmails: new Set((env.ADMIN_ACCOUNTS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      priceMonthly: env.STRIPE_PRICE_MONTHLY || '',
      priceYearly: env.STRIPE_PRICE_YEARLY || '',
    },
    // Who runs this service, for the privacy policy and terms. See .env.example.
    legal: {
      operator: env.OPERATOR_NAME || '',
      contact: env.CONTACT_EMAIL || '',
      address: env.POSTAL_ADDRESS || '',
      dataLocation: env.DATA_LOCATION || '',
      governingLaw: env.GOVERNING_LAW || '',
    },
    mailFrom: env.MAIL_FROM || 'Rank and File <no-reply@localhost>',
  }
}
