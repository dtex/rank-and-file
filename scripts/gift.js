// Gift a membership to an email address.
//   npm run gift -- tester@example.com [--days 365] [--note "beta tester"]
//   npm run gift -- --revoke tester@example.com
//   npm run gift -- --list
// The gift waits for that address: it starts the first time the person uses the app
// while signed in with it, whether or not they have an account yet.
import { isEmail, normalizeEmail } from '../services/accounts.js'
import { createPool } from '../services/db.js'
import { grantGift, revokeGifts } from '../services/entitlement.js'

try {
  process.loadEnvFile()
} catch { /* no .env file */ }

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? null : args.splice(i, 2)[1] ?? ''
}
const list = args.includes('--list')
const revoke = flag('--revoke')
const days = Number(flag('--days') ?? 365)
const note = flag('--note')
const email = normalizeEmail(revoke ?? args.find((a) => !a.startsWith('--')))

if (!list && (!isEmail(email) || !Number.isInteger(days) || days < 1)) {
  console.error('Usage: npm run gift -- <email> [--days 365] [--note "why"]\n       npm run gift -- --revoke <email>\n       npm run gift -- --list')
  process.exit(1)
}

const pool = createPool()
try {
  if (list) {
    const { rows } = await pool.query('select email, days, note, created_at, redeemed_at, expires_at, revoked_at from gifts order by created_at')
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
    for (const g of rows) {
      const status = g.revoked_at ? `revoked ${day(g.revoked_at)}` : !g.redeemed_at ? 'waiting to be used' : new Date(g.expires_at) < new Date() ? `ended ${day(g.expires_at)}` : `active until ${day(g.expires_at)}`
      console.log(`${g.email}  ${g.days} days  granted ${day(g.created_at)}  ${status}${g.note ? `  (${g.note})` : ''}`)
    }
    if (!rows.length) console.log('No gifts yet.')
  } else if (revoke !== null) {
    const n = await revokeGifts(pool, email)
    console.log(n ? `Revoked ${n} gift${n === 1 ? '' : 's'} for ${email}.` : `No gifts in force for ${email}.`)
  } else {
    await grantGift(pool, { email, days, note })
    console.log(`Gifted ${days} days to ${email}. It starts when they next use Chess Buddy signed in with that address.`)
  }
} finally {
  await pool.end()
}
