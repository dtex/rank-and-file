// Membership payments through Stripe: checkout, the customer portal, and
// keeping each user's subscription state in step with Stripe's.
import { APP_PATH } from './site.js'

const DAY = 86400

/** Stripe statuses that count as a membership. past_due keeps access while Stripe retries the card. */
export const MEMBER_STATUSES = ['active', 'trialing', 'past_due']
/** A gifted member may subscribe this many days before the gift ends. */
export const GIFT_RENEW_DAYS = 30
/** Stripe needs a deferred first charge to be at least two days away. */
const MIN_TRIAL_SECONDS = 2 * DAY + 3600

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })

export function createBilling({ pool, config, stripe }) {
  const prices = { monthly: config.stripe.priceMonthly, yearly: config.stripe.priceYearly }
  const enabled = !!stripe && !!prices.monthly && !!prices.yearly
  const need = () => {
    if (!enabled) throw fail(503, 'Membership is not on sale yet.')
  }

  /** Copy a Stripe subscription's state onto its user. Safe to repeat and to run out of order. */
  async function syncSubscription(sub, userId = null) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    userId ??= sub.metadata?.user_id ?? null
    const { rows } = await pool.query(
      'select id, stripe_subscription_id, subscription_status from users where id::text = $1 or stripe_customer_id = $2 order by (id::text = $1) desc limit 1',
      [userId, customerId],
    )
    const user = rows[0]
    if (!user) return false
    // News of an old, ended subscription must not switch off the one that replaced it.
    const ended = !MEMBER_STATUSES.includes(sub.status)
    if (ended && user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && MEMBER_STATUSES.includes(user.subscription_status)) return false

    const item = sub.items?.data?.[0]
    const periodEnd = sub.current_period_end ?? item?.current_period_end ?? sub.trial_end ?? null
    await pool.query(
      `update users set stripe_customer_id = $2, stripe_subscription_id = $3, subscription_status = $4, subscription_interval = $5,
         subscription_period_end = to_timestamp($6), subscription_cancel_at_period_end = $7 where id = $1`,
      [user.id, customerId, sub.id, sub.status, item?.price?.recurring?.interval ?? null, periodEnd, !!(sub.cancel_at_period_end || sub.cancel_at)],
    )
    return true
  }

  /** Ask Stripe for the subscription as it is now, so the order events arrive in does not matter. */
  async function refresh(subscriptionId, userId = null) {
    if (!subscriptionId) return false
    return syncSubscription(await stripe.subscriptions.retrieve(subscriptionId), userId)
  }

  return {
    enabled,

    /** A Stripe Checkout page for the chosen plan. `plan` is the user's current plan. */
    async checkout(user, which, plan) {
      need()
      if (!prices[which]) throw fail(400, 'Choose the monthly or the yearly plan.')
      if (plan.source === 'subscription') throw fail(409, 'You already have a membership. Use Manage billing to change it.')
      const subscription = { metadata: { user_id: user.id } }
      if (plan.source === 'gift') {
        if (!plan.canSubscribe) throw fail(409, `Your gifted membership has more than ${GIFT_RENEW_DAYS} days left. You can subscribe nearer the end.`)
        // No charge until the gift runs out, so nobody pays for time they were given.
        if (plan.until - Date.now() / 1000 > MIN_TRIAL_SECONDS) subscription.trial_end = plan.until
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: prices[which], quantity: 1 }],
        client_reference_id: user.id,
        ...(user.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: user.email }),
        subscription_data: subscription,
        success_url: `${config.baseUrl}${APP_PATH}?billing=success&session_id={CHECKOUT_SESSION_ID}#settings`,
        cancel_url: `${config.baseUrl}${APP_PATH}#settings`,
      })
      return session.url
    },

    /** Called when the user lands back from Checkout, so the membership shows without waiting for the webhook. */
    async confirm(user, sessionId) {
      need()
      const session = await stripe.checkout.sessions.retrieve(String(sessionId))
      if (session.client_reference_id !== user.id) throw fail(403, 'That payment belongs to another account.')
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      return refresh(subscriptionId, user.id)
    },

    /** Stripe's own page for cancelling, switching plan and changing the card. */
    async portal(user) {
      need()
      if (!user.stripe_customer_id) throw fail(409, 'There is no membership to manage yet.')
      const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${config.baseUrl}${APP_PATH}#settings` })
      return session.url
    },

    /** Check a webhook's signature and return the event. Throws if it did not come from Stripe. */
    readEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret)
    },

    /** Apply one webhook event. Returns false when it was handled before. */
    async handleEvent(event) {
      const seen = await pool.query('select 1 from stripe_events where id = $1', [event.id])
      if (seen.rowCount) return false
      const obj = event.data.object
      if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
        await refresh(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id, obj.client_reference_id)
      } else if (event.type.startsWith('customer.subscription.')) {
        await refresh(obj.id)
      }
      // Recorded only once handled: if handling failed, Stripe's retry is processed again.
      await pool.query('insert into stripe_events (id, type) values ($1, $2) on conflict do nothing', [event.id, event.type])
      return true
    },

    /** Before an account is deleted: remove the customer at Stripe, which also ends any subscription. */
    async forget(user) {
      if (!user.stripe_customer_id) return
      if (!stripe) throw fail(503, 'Billing is not available, so the membership could not be cancelled. Try again later.')
      try {
        await stripe.customers.del(user.stripe_customer_id)
      } catch (err) {
        if (err.code !== 'resource_missing') throw fail(502, 'Your membership could not be cancelled just now, so nothing was deleted. Try again in a moment.')
      }
    },

    syncSubscription,
  }
}
