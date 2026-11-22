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
try {
  await app.listen({ port, host })
  console.log(`\nChess Buddy is running at ${config.baseUrl}\n`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
