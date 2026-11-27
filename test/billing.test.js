import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { grantGift } from '../services/entitlement.js'
import { signIn, testApp, uniqueEmail } from './helpers/app.js'
import { setEarlyPlaces } from './helpers/db.js'

const WEBHOOK_SECRET = 'whsec_test'
const ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_YEARLY: 'price_y' }
const real = new Stripe('sk_test_x')
const now = () => Math.floor(Date.now() / 1000)
// Ids must differ between runs: the test database keeps rows from earlier ones.
const RUN = randomUUID().slice(0, 8)
let seq = 0

/** A stand-in for Stripe's API that remembers subscriptions. Signatures are checked by the real library. */
function fakeStripe() {
  const calls = { checkout: [], portal: [], deleted: [], prices: [] }
  const subs = new Map()
  const sessions = new Map()
  return {
    calls, subs, sessions,
    webhooks: real.webhooks,
    checkout: { sessions: {
      create: async (params) => {
        calls.checkout.push(params)
        const id = `cs_${RUN}_${++seq}`
        sessions.set(id, { id, client_reference_id: params.client_reference_id, subscription: null })
        return { id, url: `https://checkout.stripe.test/${id}` }
      },
      retrieve: async (id) => sessions.get(id),
    } },
    subscriptions: { retrieve: async (id) => subs.get(id) },
    billingPortal: { sessions: { create: async (params) => { calls.portal.push(params); return { url: 'https://billing.stripe.test/portal' } } } },
    prices: { retrieve: async (id) => { calls.prices.push(id); return { id, product: 'prod_membership' } } },
    customers: { del: async (id) => { calls.deleted.push(id) } },
  }
}

const subscription = (userId, over = {}) => ({
  id: `sub_${RUN}_${++seq}`, customer: `cus_${RUN}_${seq}`, status: 'active', metadata: { user_id: userId }, cancel_at_period_end: false,
  items: { data: [{ price: { recurring: { interval: 'month' } }, current_period_end: now() + 30 * 86400 }] }, ...over,
})

async function webhook(app, type, object, { id = `evt_${RUN}_${++seq}`, secret = WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify({ id, type, data: { object } })
  const signature = real.webhooks.generateTestHeaderString({ payload, secret })
  return app.inject({ method: 'POST', url: '/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature } })
}

async function setup() {
  const stripe = fakeStripe()
  const ctx = await testApp({ env: ENV, stripe })
  return { ...ctx, stripe }
}

test('checkout offers $5 a month or $40 a year and carries the user through', async () => {
  const ctx = await setup()
  const c = await signIn(ctx)
  assert.deepEqual((await c.get('/api/me')).json().plan.price, { month: 5, year: 40, early: false })
  assert.equal((await c.get('/api/me')).json().plan.billing, true)

  const res = await c.post('/api/billing/checkout', { plan: 'yearly' })
  assert.equal(res.statusCode, 200)
  assert.match(res.json().url, /^https:\/\/checkout\.stripe\.test\//)
  const sent = ctx.stripe.calls.checkout[0]
  assert.equal(sent.mode, 'subscription')
  assert.deepEqual(sent.line_items, [{ price: 'price_y', quantity: 1 }])
  assert.equal(sent.client_reference_id, c.userId)
  assert.equal(sent.customer_email, c.email)
  assert.deepEqual(sent.subscription_data, { metadata: { user_id: c.userId } })

  await c.post('/api/billing/checkout', { plan: 'monthly' })
  assert.equal(ctx.stripe.calls.checkout[1].line_items[0].price, 'price_m')
  assert.equal((await c.post('/api/billing/checkout', { plan: 'lifetime' })).statusCode, 400)
})

test('a completed checkout makes the user a member, by webhook or on landing back', async () => {
  const ctx = await setup()
  const viaWebhook = await signIn(ctx)
  const sub = subscription(viaWebhook.userId)
  ctx.stripe.subs.set(sub.id, sub)
  const res = await webhook(ctx.app, 'checkout.session.completed', { mode: 'subscription', subscription: sub.id, client_reference_id: viaWebhook.userId })
  assert.equal(res.statusCode, 200)
  const plan = (await viaWebhook.get('/api/me')).json().plan
  assert.deepEqual([plan.subscribed, plan.source, plan.interval, plan.status, plan.cancelAtPeriodEnd], [true, 'subscription', 'month', 'active', false])
  assert.equal(plan.until, sub.items.data[0].current_period_end)
  assert.equal((await viaWebhook.get('/api/state')).json().plan.limit, null)

  const viaReturn = await signIn(ctx)
  const { url } = (await viaReturn.post('/api/billing/checkout', { plan: 'monthly' })).json()
  const sessionId = url.split('/').pop()
  const sub2 = subscription(viaReturn.userId)
  ctx.stripe.subs.set(sub2.id, sub2)
  ctx.stripe.sessions.get(sessionId).subscription = sub2.id
  assert.equal((await viaWebhook.post('/api/billing/confirm', { sessionId })).statusCode, 403, "someone else's session")
  assert.equal((await viaReturn.post('/api/billing/confirm', { sessionId })).statusCode, 200)
  assert.equal((await viaReturn.get('/api/me')).json().plan.source, 'subscription')

  // A member is sent to the portal instead of a second checkout.
  assert.equal((await viaReturn.post('/api/billing/checkout', { plan: 'yearly' })).statusCode, 409)
  assert.equal((await viaReturn.post('/api/billing/portal')).json().url, 'https://billing.stripe.test/portal')
  assert.equal(ctx.stripe.calls.portal[0].customer, sub2.customer)
})

test('the first 100 subscribers pay $2 a month, with no yearly plan, and keep that price', async (t) => {
  const ctx = await setup()
  t.after(() => setEarlyPlaces(ctx.pool, 100))
  await setEarlyPlaces(ctx.pool, 99)
  const c = await signIn(ctx)
  const late = await signIn(ctx)
  const price = async (who) => (await who.get('/api/me')).json().plan.price
  const offer = { month: 2, year: null, early: true, full: 5 }
  assert.deepEqual([await price(c), await price(late)], [offer, offer], 'everyone is offered the last place')

  const early = [{ price_data: { currency: 'usd', product: 'prod_membership', unit_amount: 200, recurring: { interval: 'month' } }, quantity: 1 }]
  assert.equal((await c.post('/api/billing/checkout', { plan: 'yearly' })).statusCode, 400)
  await c.post('/api/billing/checkout', { plan: 'monthly' })
  const sent = ctx.stripe.calls.checkout.at(-1)
  assert.deepEqual(sent.line_items, early)
  assert.deepEqual(sent.subscription_data.metadata, { user_id: c.userId, early_adopter: '1' })
  assert.ok(sent.expires_at - now() <= 3600, 'the offer does not stay open')
  assert.deepEqual(await price(late), offer, 'starting to pay does not take the place')

  // Paying takes it. The next person is offered the full price; redelivered news does not take a second place.
  const sub = subscription(c.userId, { metadata: sent.subscription_data.metadata })
  ctx.stripe.subs.set(sub.id, sub)
  await webhook(ctx.app, 'customer.subscription.created', sub)
  await webhook(ctx.app, 'customer.subscription.updated', sub)
  assert.equal((await ctx.pool.query('select count(*)::int as n from early_adopters')).rows[0].n, 100)
  assert.deepEqual(await price(c), offer, 'a member sees what they pay')
  assert.deepEqual(await price(late), { month: 5, year: 40, early: false })
  await late.post('/api/billing/checkout', { plan: 'yearly' })
  assert.deepEqual(ctx.stripe.calls.checkout.at(-1).line_items, [{ price: 'price_y', quantity: 1 }])
  assert.equal('expires_at' in ctx.stripe.calls.checkout.at(-1), false)

  // Cancelling does not give the price up: subscribing again costs the same.
  Object.assign(sub, { status: 'canceled' })
  await webhook(ctx.app, 'customer.subscription.deleted', sub)
  await c.post('/api/billing/checkout', { plan: 'monthly' })
  assert.deepEqual(ctx.stripe.calls.checkout.at(-1).line_items, early)

  // A member at the full price is not shown the early one, even with places left.
  const full = subscription(late.userId)
  ctx.stripe.subs.set(full.id, full)
  await webhook(ctx.app, 'customer.subscription.created', full)
  await setEarlyPlaces(ctx.pool, 50)
  assert.deepEqual(await price(late), { month: 5, year: 40, early: false })

  // A deleted account's place is not handed on.
  await setEarlyPlaces(ctx.pool, 99)
  const leaver = await signIn(ctx)
  await ctx.pool.query('insert into early_adopters (user_id) values ($1)', [leaver.userId])
  await ctx.pool.query('delete from users where id = $1', [leaver.userId])
  assert.equal((await price(await signIn(ctx))).early, false)
})

test('subscription changes follow Stripe: failed payment keeps access, cancelling ends it', async () => {
  const ctx = await setup()
  const c = await signIn(ctx)
  const sub = subscription(c.userId)
  ctx.stripe.subs.set(sub.id, sub)
  await webhook(ctx.app, 'customer.subscription.created', sub)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, true)

  sub.status = 'past_due'
  await webhook(ctx.app, 'customer.subscription.updated', sub)
  let plan = (await c.get('/api/me')).json().plan
  assert.deepEqual([plan.subscribed, plan.status], [true, 'past_due'])

  sub.status = 'active'
  sub.cancel_at_period_end = true
  await webhook(ctx.app, 'customer.subscription.updated', sub)
  plan = (await c.get('/api/me')).json().plan
  assert.deepEqual([plan.subscribed, plan.cancelAtPeriodEnd], [true, true])

  // An old event delivered late carries stale data, but the current state is what gets stored.
  sub.status = 'canceled'
  await webhook(ctx.app, 'customer.subscription.updated', { ...sub, status: 'active' })
  plan = (await c.get('/api/me')).json().plan
  assert.deepEqual([plan.subscribed, plan.source], [false, null])
  assert.equal((await c.post('/api/billing/checkout', { plan: 'monthly' })).statusCode, 200, 'a lapsed member can subscribe again')
  assert.equal(ctx.stripe.calls.checkout.at(-1).customer, sub.customer, 'with the same Stripe customer')
})

test('a webhook is refused without a valid signature and applied only once', async () => {
  const ctx = await setup()
  const c = await signIn(ctx)
  const sub = subscription(c.userId)
  ctx.stripe.subs.set(sub.id, sub)

  assert.equal((await webhook(ctx.app, 'customer.subscription.created', sub, { secret: 'whsec_wrong' })).statusCode, 400)
  const unsigned = await ctx.app.inject({ method: 'POST', url: '/webhooks/stripe', payload: { id: 'evt_x', type: 'customer.subscription.created', data: { object: sub } } })
  assert.equal(unsigned.statusCode, 400)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, false)

  const id = `evt_once_${RUN}_${++seq}`
  assert.equal((await webhook(ctx.app, 'customer.subscription.created', sub, { id })).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, true)
  sub.status = 'canceled'
  assert.equal((await webhook(ctx.app, 'customer.subscription.created', sub, { id })).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, true, 'the redelivery was ignored')

  // An event for someone we do not know is acknowledged and ignored.
  const stranger = subscription('00000000-0000-4000-8000-000000000000')
  ctx.stripe.subs.set(stranger.id, stranger)
  assert.equal((await webhook(ctx.app, 'customer.subscription.created', stranger)).statusCode, 200)
})

test('a gifted member can subscribe in the last 30 days, with the first charge when the gift ends', async () => {
  const ctx = await setup()
  const email = uniqueEmail('gifted')
  await grantGift(ctx.pool, { email, days: 365 })
  const c = await signIn(ctx, email)
  let plan = (await c.get('/api/me')).json().plan
  assert.deepEqual([plan.source, plan.canSubscribe], ['gift', false])
  assert.equal((await c.post('/api/billing/checkout', { plan: 'monthly' })).statusCode, 409)

  await ctx.pool.query(`update gifts set expires_at = now() + interval '20 days' where redeemed_by = $1`, [c.userId])
  plan = (await c.get('/api/me')).json().plan
  assert.equal(plan.canSubscribe, true)
  assert.equal((await c.post('/api/billing/checkout', { plan: 'monthly' })).statusCode, 200)
  assert.equal(ctx.stripe.calls.checkout.at(-1).subscription_data.trial_end, plan.until)

  // Too close to the end for Stripe to defer the charge: it starts straight away.
  await ctx.pool.query(`update gifts set expires_at = now() + interval '1 day' where redeemed_by = $1`, [c.userId])
  await c.post('/api/billing/checkout', { plan: 'monthly' })
  assert.equal('trial_end' in ctx.stripe.calls.checkout.at(-1).subscription_data, false)
})

test('when a membership ends, openings past the first four lock, and return on resubscribing', async () => {
  const ctx = await setup()
  const c = await signIn(ctx)
  const sub = subscription(c.userId)
  ctx.stripe.subs.set(sub.id, sub)
  await webhook(ctx.app, 'customer.subscription.created', sub)

  // As a member, uncover a fifth opening through the API.
  const store = ctx.app.ctx.store.forUser(c.userId)
  for (let i = 0; i < 5; i++) {
    const state = (await c.get('/api/state')).json()
    const p = await store.loadProgress()
    for (const side of ['w', 'b']) if (p.slots[side]) { p.missions[p.slots[side]].status = 'done'; p.slots[side] = null }
    await store.saveProgress(p)
    assert.ok(state.fog.length)
    await c.get('/api/state') // fills both empty slots with new openings
  }
  const member = (await c.get('/api/state')).json()
  assert.ok(member.plan.uncovered > 4, `uncovered ${member.plan.uncovered}`)

  sub.status = 'canceled'
  await webhook(ctx.app, 'customer.subscription.deleted', sub)
  const lapsed = (await c.get('/api/state')).json()
  assert.deepEqual([lapsed.plan.subscribed, lapsed.plan.uncovered, lapsed.plan.locked], [false, 4, member.plan.uncovered - 4])
  assert.equal(lapsed.nodes.length - 1, 4)

  const again = subscription(c.userId, { customer: sub.customer })
  ctx.stripe.subs.set(again.id, again)
  await webhook(ctx.app, 'customer.subscription.created', again)
  const back = (await c.get('/api/state')).json()
  assert.deepEqual([back.plan.subscribed, back.plan.uncovered, back.plan.locked], [true, member.plan.uncovered, 0])

  // The cancellation of the old subscription arriving late does not end the new one.
  await webhook(ctx.app, 'customer.subscription.deleted', sub)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, true)
})

test('deleting an account removes the Stripe customer, and fails safe if Stripe cannot be reached', async () => {
  const ctx = await setup()
  const c = await signIn(ctx)
  const sub = subscription(c.userId)
  ctx.stripe.subs.set(sub.id, sub)
  await webhook(ctx.app, 'customer.subscription.created', sub)

  const del = ctx.stripe.customers.del
  ctx.stripe.customers.del = async () => { throw new Error('network') }
  assert.equal((await c.del('/api/account')).statusCode, 502)
  assert.equal((await c.get('/api/me')).statusCode, 200, 'the account is still there, so the user is not left paying for nothing')

  ctx.stripe.customers.del = del
  assert.equal((await c.del('/api/account')).statusCode, 200)
  assert.deepEqual(ctx.stripe.calls.deleted, [sub.customer])
  assert.equal((await ctx.pool.query('select 1 from users where id = $1', [c.userId])).rowCount, 0)
})

test('without Stripe settings, membership is simply not on sale', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx)
  assert.equal((await c.get('/api/me')).json().plan.billing, false)
  assert.equal((await c.post('/api/billing/checkout', { plan: 'monthly' })).statusCode, 503)
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/webhooks/stripe', payload: {} })).statusCode, 503)
})
