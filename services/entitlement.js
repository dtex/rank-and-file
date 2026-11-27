// What a user may do: free up to FREE_OPENINGS uncovered openings, everything with a membership.
import { GIFT_RENEW_DAYS, MEMBER_STATUSES } from './billing.js'
import { FREE_OPENINGS } from './missions.js'
import { FULL_PRICE, earlyPlaces, priceFor } from './pricing.js'

export const FREE_PLAN = { subscribed: false, source: null, until: null, limit: FREE_OPENINGS }
export const FULL_PLAN = { subscribed: true, source: null, until: null, limit: Infinity }

const unix = (date) => (date ? Math.floor(new Date(date).getTime() / 1000) : null)

/** The gift in force for this user, redeeming one waiting for their address if none is. */
export async function activeGift(pool, user) {
  const current = await pool.query(
    `select expires_at from gifts where redeemed_by = $1 and revoked_at is null and expires_at > now() order by expires_at desc limit 1`,
    [user.id],
  )
  if (current.rows[0]) return current.rows[0]
  if (!user.email) return null
  // One at a time, oldest first, so a second gift starts only when the first has run out.
  const redeemed = await pool.query(
    `update gifts set redeemed_by = $1, redeemed_at = now(), expires_at = now() + days * interval '1 day'
     where id = (select id from gifts where email = $2 and redeemed_by is null and revoked_at is null order by created_at limit 1 for update skip locked)
     returning expires_at`,
    [user.id, user.email],
  )
  return redeemed.rows[0] ?? null
}

/**
 * The plan for a user row: { subscribed, source, until (unix seconds), limit }, plus
 * the billing details the browser shows. A paid subscription takes precedence over a gift.
 * `price` is what membership costs this account, in dollars; `full` is there when that is an early-adopter price.
 */
export async function loadPlan(pool, user, { billing = false } = {}) {
  const plan = await entitlement(pool, user, billing)
  const { month, year, early } = priceFor(await earlyPlaces(pool, user.id), plan.source === 'subscription')
  return { ...plan, price: { month, year, early, ...(early ? { full: FULL_PRICE.month } : {}) } }
}

async function entitlement(pool, user, billing) {
  const gift = await activeGift(pool, user)
  if (MEMBER_STATUSES.includes(user.subscription_status)) {
    return {
      subscribed: true, source: 'subscription', until: unix(user.subscription_period_end), limit: Infinity, billing,
      status: user.subscription_status, interval: user.subscription_interval, cancelAtPeriodEnd: user.subscription_cancel_at_period_end,
    }
  }
  if (gift) {
    const until = unix(gift.expires_at)
    return { subscribed: true, source: 'gift', until, limit: Infinity, billing, canSubscribe: until - Date.now() / 1000 <= GIFT_RENEW_DAYS * 86400 }
  }
  return { ...FREE_PLAN, billing }
}

export async function grantGift(pool, { email, days = 365, note = null }) {
  const { rows } = await pool.query('insert into gifts (email, days, note) values ($1, $2, $3) returning id', [email, days, note])
  return rows[0].id
}

/** Cancel every gift for an address, used or not. Returns how many were revoked. */
export async function revokeGifts(pool, email) {
  const res = await pool.query(
    `update gifts g set revoked_at = now()
     where g.revoked_at is null and (g.email = $1 or g.redeemed_by = (select id from users where email = $1))`,
    [email],
  )
  return res.rowCount
}
