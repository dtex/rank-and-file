import { buildApp } from './app.js'
import { loadConfig } from './services/config.js'
import { createPool, migrate } from './services/db.js'

// Settings come from .env when there is one (see .env.example).
try {
  process.loadEnvFile()
} catch { /* no .env file: use the environment as it is */ }

const config = loadConfig()
// Listens on this machine only by default; a reverse proxy in front provides HTTPS.
const { port, host } = config

const pool = createPool()
try {
  const applied = await migrate(pool)
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)
} catch (err) {
  console.error(`Could not prepare the database. ${err.message}\nIs Postgres running? Try "npm run migrate".`)
  process.exit(1)
}

const app = buildApp({ pool, config })

// Once a day: drop expired sessions and links, and accounts that never accepted the terms.
async function cleanup() {
  try {
    const removed = await app.ctx.accounts.cleanup()
    app.log.info(removed, 'cleanup')
  } catch (err) {
    app.log.error(err)
  }
}
cleanup()
setInterval(cleanup, 24 * 3600 * 1000).unref()

if (config.production) {
  const missing = Object.entries({
    OPERATOR_NAME: config.legal.operator, CONTACT_EMAIL: config.legal.contact, POSTAL_ADDRESS: config.legal.address,
    DATA_LOCATION: config.legal.dataLocation, GOVERNING_LAW: config.legal.governingLaw, SMTP_HOST: config.smtp.host,
    STRIPE_SECRET_KEY: config.stripe.secretKey, STRIPE_WEBHOOK_SECRET: config.stripe.webhookSecret,
  }).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) app.log.warn(`Not set: ${missing.join(', ')}. See .env.example.`)
  if (!config.secureCookies) app.log.warn('BASE_URL is not https, so the session cookie is not marked Secure.')
  if (!Object.keys(config.providers).length) app.log.warn('No OAuth provider is set up; only emailed links are offered.')
}
try {
  await app.listen({ port, host })
  console.log(`\nChess Buddy is running at ${config.baseUrl}\n`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
