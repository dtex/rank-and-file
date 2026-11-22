import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTree } from '../services/tree.js'
import { FREE_OPENINGS, applyEntitlement, fillSlots, isUncovered, processGames, switchMission, uncoveredCount } from '../services/missions.js'
import { FREE_PLAN, grantGift, loadPlan, revokeGifts } from '../services/entitlement.js'
import { openingView, stateView } from '../services/views.js'
import { signIn, testApp, uniqueEmail } from './helpers/app.js'

const tree = loadTree()
const T0 = 1795000000
let n = 0
const game = (moves, { as = 'w', ...over } = {}) => {
  n++
  const me = { name: 'me', rating: 800, result: 'win' }
  const opp = { name: `opp${n}`, rating: 800, result: 'resigned' }
  return {
    uuid: `p${n}`, end: T0 + n * 100, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
    white: as === 'w' ? me : opp, black: as === 'w' ? opp : me, moves: moves.split(' '), ...over,
  }
}
const fresh = (limit) => {
  const progress = {
    createdAt: T0, settings: { username: 'me', timeClasses: ['blitz'], ratedOnly: true },
    missions: {}, slots: { w: null, b: null }, events: [],
  }
  fillSlots(tree, progress, T0, limit)
  return progress
}
/** Uncover openings one after another until `count` are open, as finished missions would. Each gets a later start time. */
function uncover(p, count, limit = Infinity) {
  let t = T0 + 10
  while (uncoveredCount(p) < count) {
    const side = uncoveredCount(p) % 2 ? 'b' : 'w'
    const current = p.slots[side]
    if (current) Object.assign(p.missions[current], { status: 'done' })
    p.slots[side] = null
    assert.equal(fillSlots(tree, p, (t += 10), limit).length, 1)
  }
  return p
}
/** Finish a colour's mission without playing it, leaving the slot empty. */
function finish(p, side) {
  p.missions[p.slots[side]].status = 'done'
  p.slots[side] = null
}

test('a free player keeps the two starting openings and can uncover four more', () => {
  const p = uncover(fresh(FREE_OPENINGS), FREE_OPENINGS, FREE_OPENINGS)
  assert.equal(uncoveredCount(p), 6)
  finish(p, 'w')
  assert.equal(fillSlots(tree, p, T0 + 999, FREE_OPENINGS).length, 0)
  assert.equal(uncoveredCount(p), 6)
  // The same finished mission uncovers the next opening with a membership.
  assert.equal(fillSlots(tree, p, T0 + 999, Infinity).length, 1)
  assert.equal(uncoveredCount(p), 7)
})

test('at the free limit a finished mission leaves its slot empty and says why', () => {
  const p = uncover(fresh(FREE_OPENINGS), FREE_OPENINGS, FREE_OPENINGS)
  const id = p.slots.w
  const node = tree.byId.get(id)
  const games = Array.from({ length: node.target }, () => game(node.moves, { end: T0 + 5000 + n }))
  const { events } = processGames(tree, p, games, FREE_OPENINGS)
  assert.equal(p.missions[id].status, 'done')
  assert.equal(p.slots.w, null)
  assert.deepEqual([events[0].next, events[0].paywall], [null, true])
  assert.equal(fillSlots(tree, p, T0 + 9000, FREE_OPENINGS).length, 0, 'loading the state later uncovers nothing either')

  const view = stateView(tree, p, games, FREE_PLAN)
  assert.equal(view.events[0].paywall, true)
  assert.deepEqual([view.plan.uncovered, view.plan.limit, view.plan.atLimit, view.plan.subscribed], [6, 6, true, false])
})

test('when a membership ends, only the first six openings stay open; the rest return intact on resubscribing', () => {
  const p = uncover(fresh(), 9)
  const order = Object.entries(p.missions).sort((a, b) => a[1].startedAt - b[1].startedAt).map(([id]) => id)
  const kept = order.slice(0, 6)
  const extra = order.slice(6)
  p.missions[extra[0]].games.push('g-a', 'g-b')
  const before = structuredClone(p)

  assert.equal(applyEntitlement(tree, p, false, T0 + 10000), true)
  assert.deepEqual(extra.map((id) => p.missions[id].status), ['locked', 'locked', 'locked'])
  assert.deepEqual(kept.map((id) => isUncovered(p, id)), Array(6).fill(true))
  assert.equal(uncoveredCount(p), 6)
  assert.deepEqual(p.missions[extra[0]].games, ['g-a', 'g-b'], 'counts are kept')
  for (const side of ['w', 'b']) assert.ok(!extra.includes(p.slots[side]), 'no slot points at a locked opening')
  assert.equal(applyEntitlement(tree, p, false, T0 + 10001), false, 'running it again changes nothing')

  // Locked openings are fog again: not named anywhere, not openable, not uncoverable.
  const view = stateView(tree, p, [], FREE_PLAN)
  const text = JSON.stringify(view)
  for (const id of extra) {
    assert.equal(view.nodes.some((x) => x.id === id), false)
    assert.equal(text.includes(tree.byId.get(id).name), false, `${id} is not named`)
    assert.equal(openingView(tree, p, [], id), null)
    assert.throws(() => switchMission(tree, p, id, T0 + 10002), (err) => err.paywall === true)
  }
  assert.equal(view.plan.locked, 3)
  assert.equal(fillSlots(tree, p, T0 + 10003, FREE_OPENINGS).length, 0)

  // Games played while locked do not count, even once the membership is back.
  const lockedActive = extra.find((id) => before.missions[id].status === 'active')
  const node = tree.byId.get(lockedActive)
  const during = game(node.moves, { as: node.side, end: T0 + 11000 })
  processGames(tree, p, [during], FREE_OPENINGS)
  assert.notEqual(during.verdict.type, 'counted')

  assert.equal(applyEntitlement(tree, p, true, T0 + 12000), true)
  assert.equal(uncoveredCount(p), 9)
  for (const id of extra) {
    assert.equal(p.missions[id].status, before.missions[id].status, `${id} is ${before.missions[id].status} again`)
    assert.equal('lockedFrom' in p.missions[id], false)
  }
  assert.deepEqual(p.missions[extra[0]].games, ['g-a', 'g-b'])
  assert.equal(p.slots[node.side], lockedActive)
  const late = game(node.moves, { as: node.side, end: T0 + 11500 })
  const after = game(node.moves, { as: node.side, end: T0 + 13000 })
  processGames(tree, p, [late, after])
  assert.equal(late.verdict.type, 'before_mission', 'a game from the lapse, synced after resubscribing')
  assert.equal(after.verdict.type, 'counted')
})

test('a colour whose mission was locked falls back to a parked free one', () => {
  const p = fresh()
  // kp parked, qp active: both among the first six.
  p.missions.kp.status = 'parked'
  p.missions.qp = { status: 'active', side: 'w', startedAt: T0 + 10, since: T0 + 10, games: [] }
  p.slots.w = 'qp'
  uncover(p, 6)
  // A seventh opening for White becomes the active mission.
  finish(p, 'w')
  const [seventh] = fillSlots(tree, p, T0 + 500)
  assert.equal(p.missions.kp.status, 'parked')

  applyEntitlement(tree, p, false, T0 + 1000)
  assert.equal(p.missions[seventh.id].status, 'locked')
  assert.equal(p.slots.w, 'kp')
  assert.equal(p.missions.kp.status, 'active')

  applyEntitlement(tree, p, true, T0 + 2000)
  assert.equal(p.slots.w, seventh.id, 'the locked mission takes its slot back')
  assert.equal(p.missions.kp.status, 'parked')
})

test('a gift waits for its address, starts when first used, and can be revoked', async () => {
  const ctx = await testApp()
  const email = uniqueEmail('tester')
  await grantGift(ctx.pool, { email, days: 365, note: 'beta' })
  assert.equal((await ctx.pool.query('select redeemed_by from gifts where email = $1', [email])).rows[0].redeemed_by, null)

  const c = await signIn(ctx, email)
  const me = (await c.get('/api/me')).json()
  assert.deepEqual([me.plan.subscribed, me.plan.source], [true, 'gift'])
  const days = (me.plan.until - Date.now() / 1000) / 86400
  assert.ok(days > 364.9 && days < 365.1, `runs for a year from first use, got ${days}`)
  assert.equal((await c.get('/api/state')).json().plan.limit, null)

  const other = await signIn(ctx)
  assert.equal((await other.get('/api/me')).json().plan.subscribed, false)

  assert.equal(await revokeGifts(ctx.pool, email), 1)
  assert.equal((await c.get('/api/me')).json().plan.subscribed, false)
})

test('a second gift starts only when the first has run out', async () => {
  const ctx = await testApp()
  const email = uniqueEmail('twice')
  await grantGift(ctx.pool, { email, days: 30 })
  await grantGift(ctx.pool, { email, days: 60 })
  const c = await signIn(ctx, email)
  const user = { id: c.userId, email }
  await loadPlan(ctx.pool, user)
  const rows = async () => (await ctx.pool.query('select days, redeemed_at is not null as used from gifts where email = $1 order by id', [email])).rows
  assert.deepEqual(await rows(), [{ days: 30, used: true }, { days: 60, used: false }])
  await ctx.pool.query(`update gifts set expires_at = now() - interval '1 hour' where email = $1 and days = 30`, [email])
  assert.equal((await loadPlan(ctx.pool, user)).subscribed, true)
  assert.deepEqual(await rows(), [{ days: 30, used: true }, { days: 60, used: true }])
})

test('the API enforces the free limit and unlocks with a gift', async () => {
  const ctx = await testApp()
  const email = uniqueEmail('limit')
  const c = await signIn(ctx, email)
  const store = ctx.app.ctx.store.forUser(c.userId)

  // Put the account at seven openings, as if a membership had just ended.
  await c.get('/api/state')
  const start = await store.loadProgress()
  // The helper's clock starts at T0, so move the two starting missions there too.
  for (const m of Object.values(start.missions)) m.startedAt = T0
  const p = uncover(start, 7)
  const seventh = Object.entries(p.missions).sort((a, b) => b[1].startedAt - a[1].startedAt)[0][0]
  await store.saveProgress(p)

  const state = (await c.get('/api/state')).json()
  assert.deepEqual([state.plan.uncovered, state.plan.atLimit, state.plan.locked], [6, true, 1])
  assert.equal(state.nodes.some((x) => x.id === seventh), false)
  const opening = await c.get(`/api/openings/${seventh}`)
  assert.deepEqual([opening.statusCode, opening.json().paywall], [402, true])
  const blocked = await c.post('/api/missions/switch', { id: seventh })
  assert.deepEqual([blocked.statusCode, blocked.json().paywall], [402, true])
  // A fog tile cannot be chosen, by its tile id or by guessing the opening's id.
  assert.equal((await c.post('/api/missions/switch', { fid: state.fog[0].fid })).statusCode, 400)
  assert.equal((await c.post('/api/missions/switch', { id: 'staunton' })).statusCode, 409)

  await grantGift(ctx.pool, { email })
  const open = (await c.get('/api/state')).json()
  assert.deepEqual([open.plan.subscribed, open.plan.uncovered, open.plan.locked], [true, 7, 0])
  assert.equal((await c.get(`/api/openings/${seventh}`)).statusCode, 200)
})
