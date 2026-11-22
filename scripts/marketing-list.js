// The people who asked for news and tips, as CSV with each one's unsubscribe link:
//   npm run marketing-list > list.csv
// Every marketing email must carry that person's link, plus your postal address.
// Needs the same SESSION_SECRET and BASE_URL as the running app, or the links will not work.
import { createAccounts } from '../services/accounts.js'
import { loadConfig } from '../services/config.js'
import { createPool } from '../services/db.js'

try {
  process.loadEnvFile()
} catch { /* no .env file */ }

if (!process.env.SESSION_SECRET) {
  console.error('Set SESSION_SECRET to the value the app runs with, or the unsubscribe links will be invalid.')
  process.exit(1)
}
const config = loadConfig()
const pool = createPool()
try {
  const accounts = createAccounts(pool, { secret: config.sessionSecret })
  const { rows } = await pool.query('select id, email from users where marketing_opt_in and accepted_terms_at is not null and email is not null order by email')
  console.log('email,unsubscribe_url')
  for (const u of rows) console.log(`${u.email},${config.baseUrl}/unsubscribe?t=${accounts.unsubscribeToken(u.id)}`)
} finally {
  await pool.end()
}
