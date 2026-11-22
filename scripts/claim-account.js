// Give the data imported before sign-in existed to an email address:
//   npm run claim -- you@example.com
// Signing in with that address (by any method) then opens the imported account.
import { isEmail, normalizeEmail } from '../services/accounts.js'
import { createPool } from '../services/db.js'

try {
  process.loadEnvFile()
} catch { /* no .env file */ }

const email = normalizeEmail(process.argv[2])
if (!isEmail(email)) {
  console.error('Usage: npm run claim -- you@example.com')
  process.exit(1)
}
const pool = createPool()
try {
  const orphans = (await pool.query('select id from users where email is null')).rows
  if (orphans.length !== 1) {
    console.error(orphans.length ? 'More than one account has no email address; set it by hand.' : 'There is no imported account without an email address.')
    process.exitCode = 1
  } else if ((await pool.query('select 1 from users where email = $1', [email])).rowCount) {
    console.error('Another account already uses that address.')
    process.exitCode = 1
  } else {
    await pool.query('update users set email = $2 where id = $1', [orphans[0].id, email])
    console.log(`Done. Sign in as ${email} to open the imported account.`)
  }
} finally {
  await pool.end()
}
