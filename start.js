import { buildApp } from './app.js'
import { createPool, migrate } from './services/db.js'

const port = Number(process.env.PORT || 3210)
// Listen on this machine only.
const host = process.env.HOST || '127.0.0.1'

const pool = createPool()
try {
  const applied = await migrate(pool)
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)
} catch (err) {
  console.error(`Could not prepare the database. ${err.message}\nIs Postgres running? Try "npm run migrate".`)
  process.exit(1)
}

const app = buildApp({ pool })
try {
  await app.listen({ port, host })
  console.log(`\nChess Buddy is running at http://localhost:${port}\n`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
