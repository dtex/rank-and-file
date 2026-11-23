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
  assert.equal(data.progress.settings.usernames.chesscom, 'exporter')
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

test('the privacy policy and terms are public, and every page carries the security headers', async () => {
  const { app } = await testApp({ env: { OPERATOR_NAME: 'Example Chess Ltd', CONTACT_EMAIL: 'privacy@example.com' } })
  const privacy = await app.inject({ url: '/privacy' })
  assert.equal(privacy.statusCode, 200)
  assert.match(privacy.body, /Example Chess Ltd/)
  assert.match(privacy.body, /We do not sell your personal information/)
  assert.match(privacy.body, /\[data location not set\]/, 'a missing detail is shown as a gap')
  const terms = await app.inject({ url: '/terms' })
  assert.equal(terms.statusCode, 200)
  assert.match(terms.body, /\$5 a month or \$50 a year/)

  for (const res of [privacy, await app.inject({ url: '/' }), await app.inject({ url: '/app' }), await app.inject({ url: '/api/me' })]) {
    assert.match(res.headers['content-security-policy'], /default-src 'self'/)
    assert.equal(res.headers['x-frame-options'], 'DENY')
  }
  assert.equal((await app.inject({ url: '/api/me' })).headers['cache-control'], 'no-store')
  const page = (await app.inject({ url: '/app' })).body
  assert.match(page, /<cb-app>/)
  assert.equal(/https?:\/\//.test(page), false, 'the page loads nothing from another site')
})

test('the marketing site has the root, with a log in link to the app on every page', async () => {
  const { app } = await testApp({ env: { BASE_URL: 'https://chess.example' } })
  for (const url of ['/', '/features', '/pricing', '/privacy', '/terms']) {
    const res = await app.inject({ url })
    assert.equal(res.statusCode, 200, url)
    assert.match(res.body, /<a class="btn pri" href="\/app">Log in<\/a>/, `${url} has a log in button`)
    assert.match(res.body, new RegExp(`<link rel="canonical" href="https://chess.example${url}">`))
    assert.equal(/(src|<link rel="stylesheet" href)="https?:/.test(res.body), false, `${url} loads nothing from another site`)
  }
  for (const url of ['/', '/features', '/pricing']) {
    const { body } = await app.inject({ url })
    const data = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
    const faq = data.find((d) => d['@type'] === 'FAQPage')
    assert.ok(faq.mainEntity.length >= 5, `${url} has questions and answers`)
    // Every answer in the data is also on the page for people to read.
    for (const q of faq.mainEntity) assert.ok(body.includes(`<h3>${q.name.replace(/&/g, '&amp;')}</h3>`), q.name)
  }
  assert.match((await app.inject({ url: '/pricing' })).body, /\$5<small> a month<\/small>/)
  assert.match((await app.inject({ url: '/robots.txt' })).body, /Sitemap: https:\/\/chess\.example\/sitemap\.xml/)
  assert.match((await app.inject({ url: '/sitemap.xml' })).body, /<loc>https:\/\/chess\.example\/features<\/loc>/)
})

test('an admin can open the study page of a hidden opening without uncovering it; nobody else can', async () => {
  const admin = uniqueEmail('admin')
  const ctx = await testApp({ env: { ADMIN_ACCOUNTS: ` ${admin.toUpperCase()} , someone@example.com` } })
  const a = await signIn(ctx, admin)
  const other = await signIn(ctx)
  assert.equal((await a.get('/api/me')).json().admin, true)
  assert.equal((await other.get('/api/me')).json().admin, false)

  // Only the admin's fog tiles say which opening they are.
  const before = (await a.get('/api/state')).json()
  const tile = before.fog.find((f) => f.id === 'sicilian')
  assert.deepEqual([tile.parent, tile.side], ['kp', 'b'])
  const theirs = (await other.get('/api/state')).json()
  assert.equal(theirs.fog.some((f) => 'id' in f), false)
  assert.equal(JSON.stringify(theirs).includes('Sicilian'), false)

  const page = await a.get('/api/openings/sicilian')
  assert.equal(page.statusCode, 200)
  const o = page.json()
  assert.deepEqual([o.name, o.status, o.count, o.hiddenChildren], ['Sicilian Defense', 'hidden', 0, 0])
  assert.ok(o.blurb && o.ideas.length && o.missionGames.length === 0)
  // The openings beyond it are listed too, and open the same way, though they are not fog tiles yet.
  assert.ok(o.children.some((c) => c.id === 'sic-nf3' && c.status === 'hidden'))
  assert.equal((await a.get('/api/openings/sic-nf3')).statusCode, 200)
  // An admin cannot pick the next opening either.
  assert.equal((await a.post('/api/missions/switch', { id: 'sicilian' })).statusCode, 409)
  // Looking changes nothing.
  assert.deepEqual((await a.get('/api/state')).json().fog, before.fog)

  assert.equal((await other.get('/api/openings/sicilian')).statusCode, 404)
  assert.equal((await a.get('/api/openings/nope')).statusCode, 404)
})
