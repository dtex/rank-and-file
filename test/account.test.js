import test from 'node:test'
import assert from 'node:assert/strict'
import { POLICY_VERSION } from '../services/accounts.js'
import { client, signIn, testApp, tokenFrom, uniqueEmail } from './helpers/app.js'

const consents = async (ctx, userId) =>
  (await ctx.pool.query('select kind, granted, version, source from consents where user_id = $1 order by id', [userId])).rows

test('consent is recorded with its version, and marketing is off unless chosen', async () => {
  const ctx = await testApp()
  const no = await signIn(ctx, uniqueEmail(), { marketing: false })
  assert.deepEqual(await consents(ctx, no.userId), [
    { kind: 'age', granted: true, version: POLICY_VERSION, source: 'signup' },
    { kind: 'terms', granted: true, version: POLICY_VERSION, source: 'signup' },
    { kind: 'marketing', granted: false, version: POLICY_VERSION, source: 'signup' },
  ])
  assert.equal((await no.get('/api/me')).json().marketing, false)

  const yes = await signIn(ctx, uniqueEmail(), { marketing: true })
  assert.equal((await yes.get('/api/me')).json().marketing, true)
})

test('marketing can be withdrawn in Settings or by the unsubscribe link, and each change is logged', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx, uniqueEmail(), { marketing: true })
  await c.put('/api/account/marketing', { on: false })
  await c.put('/api/account/marketing', { on: false })
  await c.put('/api/account/marketing', { on: true })

  const token = ctx.app.ctx.accounts.unsubscribeToken(c.userId)
  const anon = client(ctx.app)
  assert.equal((await anon.get(`/unsubscribe?t=${token}`)).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().marketing, true, 'opening the link changes nothing')
  assert.equal((await anon.post(`/unsubscribe?t=${token}`)).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().marketing, false)
  assert.equal((await anon.post(`/unsubscribe?t=${token.slice(0, -2)}xx`)).statusCode, 400)

  const log = (await consents(ctx, c.userId)).filter((r) => r.kind === 'marketing').map((r) => [r.granted, r.source])
  assert.deepEqual(log, [[true, 'signup'], [false, 'settings'], [true, 'settings'], [false, 'unsubscribe_link']])
})

test('download my data returns the account, consents, progress and games of that user only', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx, uniqueEmail(), { username: 'exporter' })
  await signIn(ctx, uniqueEmail(), { username: 'someone-else' })
  await ctx.app.ctx.store.forUser(c.userId).saveMonth('2026-10', [{ uuid: 'x1', end: 5, moves: ['e4'] }], null)
  const res = await c.get('/api/account/export')
  assert.match(res.headers['content-disposition'], /attachment/)
  const data = res.json()
  assert.equal(data.account.email, c.email)
  assert.equal(data.progress.settings.username, 'exporter')
  assert.deepEqual(data.games.map((g) => g.uuid), ['x1'])
  assert.equal(data.consents.length, 3)
  assert.deepEqual(data.signInMethods.map((m) => m.provider), ['email'])
  assert.equal(JSON.stringify(data).includes('someone-else'), false)
})

test('deleting an account removes every row and ends the session', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx)
  await c.get('/api/state')
  assert.equal((await c.del('/api/account')).statusCode, 200)
  assert.equal((await c.get('/api/me')).statusCode, 401)
  for (const table of ['progress', 'games', 'sessions', 'identities', 'consents']) {
    assert.equal((await ctx.pool.query(`select 1 from ${table} where user_id = $1`, [c.userId])).rowCount, 0, table)
  }
  assert.equal((await ctx.pool.query('select 1 from users where email = $1', [c.email])).rowCount, 0)
  assert.equal((await ctx.pool.query('select 1 from login_tokens where email = $1', [c.email])).rowCount, 0)
})

test('the email address changes only after the new one is confirmed', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx)
  const other = await signIn(ctx)
  const next = uniqueEmail('new')

  assert.equal((await c.post('/api/account/email', { email: other.email })).statusCode, 200)
  assert.equal(ctx.mail.filter((m) => m.to === other.email).length, 1, 'no link goes to an address another account uses')

  assert.equal((await c.post('/api/account/email', { email: next })).statusCode, 200)
  assert.equal((await c.get('/api/me')).json().email, c.email)
  const res = await client(ctx.app).post('/auth/magic/verify', { token: tokenFrom(ctx.mail.at(-1)) })
  assert.deepEqual([res.statusCode, res.json().purpose], [200, 'change_email'])
  assert.equal((await c.get('/api/me')).json().email, next)

  const again = await signIn(ctx, next, { ready: false })
  assert.equal(again.userId, c.userId, 'the new address signs in to the same account')
})

test('cleanup removes expired sessions and accounts that never accepted the terms', async () => {
  const ctx = await testApp()
  const stale = await signIn(ctx, uniqueEmail('stale'), { ready: false })
  const fresh = await signIn(ctx, uniqueEmail('fresh'), { ready: false })
  const active = await signIn(ctx, uniqueEmail('active'))
  await ctx.pool.query(`update users set created_at = now() - interval '2 days' where id = any($1)`, [[stale.userId, active.userId]])
  await ctx.pool.query(`update sessions set expires_at = now() - interval '1 minute' where user_id = $1`, [active.userId])

  await ctx.app.ctx.accounts.cleanup()
  const left = (await ctx.pool.query('select id from users where id = any($1)', [[stale.userId, fresh.userId, active.userId]])).rows.map((r) => r.id)
  assert.deepEqual(left.sort(), [fresh.userId, active.userId].sort())
  assert.equal((await active.get('/api/me')).statusCode, 401, 'the expired session is gone')
})
