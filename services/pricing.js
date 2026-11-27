// What membership costs. The first subscribers pay less, and keep that price for good.
export const FULL_PRICE = { month: 5, year: 40 }
/** Early adopters pay by the month only. */
export const EARLY_PRICE = { month: 2, year: null }
/** How many subscribers get the early price. */
export const EARLY_PLACES = 100

/** How many early places are taken, and whether this user holds one. */
export async function earlyPlaces(pool, userId = null) {
  const { rows } = await pool.query(
    'select count(*)::int as taken, (count(*) filter (where user_id = $1)) > 0 as mine from early_adopters', [userId])
  return rows[0]
}

/**
 * The price for someone given the early places: { month, year, early }, in dollars; `year` is null when
 * there is no yearly plan. A holder always gets the early price. Anyone else is offered it while places
 * are left, unless they are a member already, who pays what they signed up for.
 */
export function priceFor({ taken, mine }, member = false) {
  return mine || (!member && taken < EARLY_PLACES) ? { ...EARLY_PRICE, early: true } : { ...FULL_PRICE, early: false }
}

/** Give this user an early place, once they have subscribed at the early price. Safe to repeat. */
export async function claimEarlyPlace(pool, userId) {
  await pool.query('insert into early_adopters (user_id) values ($1) on conflict (user_id) do nothing', [userId])
}
