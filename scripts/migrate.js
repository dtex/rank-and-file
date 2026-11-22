// Create the database if needed and apply pending migrations: `npm run migrate`.
import { createPool, ensureDatabase, migrate } from '../services/db.js'

if (await ensureDatabase()) console.log('Created the database.')
const pool = createPool()
try {
  const applied = await migrate(pool)
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply. The database is up to date.')
} finally {
  await pool.end()
}
