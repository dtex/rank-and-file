import test from 'node:test'
import assert from 'node:assert/strict'
import { client, signIn, testApp, tokenFrom, uniqueEmail } from './helpers/app.js'

test('nothing under /api works without signing in', async () => {
  const { app } = await testApp()
  for (const url of ['/api/state', '/api/me', '/api/games', '/api/settings', '/api/account/export']) {
    assert.equal((await app.inject({ url })).statusCode, 401, url)
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/sync' })).statusCode, 401)
})

test('an emailed link signs in, then consent and a username are needed before the app opens', async () => {
  const ctx = await testApp()
  const email = uniqueEmail()
  const c = client(ctx.app)
  const asked = await c.post('/auth/magic', { email: email.toUpperCase() })
  assert.equal(asked.statusCode, 200)
  assert.equal(ctx.mail.at(-1).to, email, 'addresses are stored lower-cased')
  const token = tokenFrom(ctx.mail.at(-1))

  assert.equal((await c.post('/auth/magic/verify', { token })).statusCode, 200)
  const cookie = (await ctx.app.inject({ method: 'POST', url: '/auth/magic/verify', payload: { token } }))
  assert.equal(cookie.statusCode, 400, 'a link works once')

  let me = (await c.get('/api/me')).json()
  assert.deepEqual([me.email, me.needsConsent, me.username, me.methods], [email, true, null, ['email']])
  const early = await c.get('/api/state')
  assert.deepEqual([early.statusCode, early.json().needsConsent], [403, true])

  assert.equal((await c.post('/api/account/consent', { age: true, terms: false })).statusCode, 400)
  assert.equal((await c.post('/api/account/consent', { age: true, terms: true, marketing: false })).statusCode, 200)
  const noName = await c.get('/api/state')
  assert.deepEqual([noName.statusCode, noName.json().needsUsername], [409, true])

  assert.equal((await c.put('/api/settings', { username: 'somebody', timeClasses: ['blitz'], ratedOnly: true })).statusCode, 200)
  const state = await c.get('/api/state')
  assert.equal(state.statusCode, 200)
  assert.equal(state.json().accounts, 'somebody on chess.com')
  me = (await c.get('/api/me')).json()
  assert.deepEqual([me.needsConsent, me.username, me.marketing], [false, 'somebody on chess.com', false])

  await c.post('/auth/logout')
  assert.equal((await c.get('/api/me')).statusCode, 401)
})

test('session and token values are stored only as hashes', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx, uniqueEmail(), { ready: false })
  const sid = c.jar.get('cb_sid')
  const { rows } = await ctx.pool.query('select id_hash from sessions where user_id = $1', [c.userId])
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].id_hash, sid)
  const token = tokenFrom(ctx.mail.at(-1))
  assert.equal((await ctx.pool.query('select 1 from login_tokens where token_hash = $1', [token])).rowCount, 0)
})

test('one address can only ask for a few links at a time', async () => {
  const ctx = await testApp()
  const email = uniqueEmail()
  for (let i = 0; i < 5; i++) {
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/auth/magic', payload: { email }, remoteAddress: `10.0.0.${i}` })).statusCode, 200)
  }
  assert.equal(ctx.mail.filter((m) => m.to === email).length, 3)
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/auth/magic', payload: { email: 'nope' } })).statusCode, 400)
})

/** Stands in for Google and GitHub. `profiles` maps an access code to what the provider would say. */
function fakeProviders(profiles) {
  const seen = []
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
  const impl = async (url, opts = {}) => {
    seen.push({ url, opts })
    if (url.endsWith('/token') || url.endsWith('/access_token')) {
      const code = new URLSearchParams(opts.body).get('code')
      return profiles[code] ? json({ access_token: code }) : json({ error: 'bad_verification_code' }, 400)
    }
    const p = profiles[opts.headers.Authorization.replace('Bearer ', '')]
    if (url.includes('googleapis.com')) return json({ sub: p.sub, email: p.email, email_verified: p.verified })
    if (url.endsWith('/user')) return json({ id: p.sub })
    if (url.endsWith('/user/emails')) return json([{ email: 'other@example.com', primary: false, verified: true }, { email: p.email, primary: true, verified: p.verified }])
    throw new Error(`unexpected ${url}`)
  }
  return { impl, seen }
}

async function oauth(c, provider, code) {
  const start = await c.get(`/auth/${provider}/start`)
  assert.equal(start.statusCode, 302)
  const to = new URL(start.headers.location)
  return { to, back: await c.get(`/auth/${provider}/callback?code=${code}&state=${to.searchParams.get('state')}`) }
}

test('Google and GitHub sign in by verified email, and the same email is the same account', async () => {
  const email = uniqueEmail('linked')
  const providers = fakeProviders({ gcode: { sub: `g-${email}`, email, verified: true }, hcode: { sub: `h-${email}`, email: email.toUpperCase(), verified: true } })
  const ctx = await testApp({ fetchImpl: providers.impl })

  const g = client(ctx.app)
  const { to, back } = await oauth(g, 'google', 'gcode')
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(to.searchParams.get('scope'), 'openid email')
  assert.equal(to.searchParams.get('redirect_uri'), 'http://localhost:3210/auth/google/callback')
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256')
  assert.deepEqual([back.statusCode, back.headers.location], [302, '/app'])
  const sent = new URLSearchParams(providers.seen.find((s) => s.url.endsWith('/token')).opts.body)
  assert.ok(sent.get('code_verifier'), 'the PKCE verifier goes with the code')
  assert.equal((await g.get('/api/me')).json().email, email)

  const h = client(ctx.app)
  const gh = await oauth(h, 'github', 'hcode')
  assert.equal(gh.to.searchParams.get('scope'), 'user:email')
  assert.equal(gh.back.headers.location, '/app')

  const m = await signIn(ctx, email, { ready: false })
  const me = (await m.get('/api/me')).json()
  assert.deepEqual(me.methods, ['google', 'github', 'email'])
  assert.equal((await ctx.pool.query('select count(*)::int as n from users where email = $1', [email])).rows[0].n, 1)
})

test('sign-in is refused without a verified email, a matching state, or a good code', async () => {
  const email = uniqueEmail('unverified')
  const providers = fakeProviders({ gcode: { sub: `g-${email}`, email, verified: false }, hcode: { sub: `h-${email}`, email, verified: false } })
  const ctx = await testApp({ fetchImpl: providers.impl })

  for (const [provider, code] of [['google', 'gcode'], ['github', 'hcode']]) {
    const c = client(ctx.app)
    const { back } = await oauth(c, provider, code)
    assert.equal(back.headers.location, '/app#login-error=no-email', provider)
    assert.equal((await c.get('/api/me')).statusCode, 401)
  }
  assert.equal((await ctx.pool.query('select 1 from users where email = $1', [email])).rowCount, 0, 'no account is created')

  const c = client(ctx.app)
  await c.get('/auth/google/start')
  assert.equal((await c.get('/auth/google/callback?code=gcode&state=forged')).headers.location, '/app#login-error=expired')
  assert.equal((await oauth(client(ctx.app), 'google', 'wrong')).back.headers.location, '/app#login-error=provider')
  assert.equal((await client(ctx.app).get('/auth/google/callback?code=gcode&state=x')).headers.location, '/app#login-error=expired', 'no attempt cookie')
})

test('only configured providers are offered', async () => {
  const { app } = await testApp({ env: { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' } })
  assert.deepEqual((await app.inject({ url: '/auth/options' })).json().providers, [{ id: 'google', name: 'Google' }])
  assert.equal((await app.inject({ url: '/auth/github/start' })).statusCode, 404)
})

/** Give a user a parked 1.d4 mission to resume, as a lapsed membership can leave behind. */
async function parkQp(ctx, c) {
  await c.get('/api/state')
  const store = ctx.app.ctx.store.forUser(c.userId)
  const p = await store.loadProgress()
  p.missions.qp = { status: 'parked', side: 'w', startedAt: p.createdAt, since: p.createdAt, games: [] }
  await store.saveProgress(p)
}

test('each user sees only their own progress', async () => {
  const ctx = await testApp()
  const a = await signIn(ctx, uniqueEmail('a'), { username: 'alice' })
  const b = await signIn(ctx, uniqueEmail('b'), { username: 'bob' })
  assert.equal((await a.get('/api/state')).json().accounts, 'alice on chess.com')
  assert.equal((await b.get('/api/state')).json().accounts, 'bob on chess.com')
  await parkQp(ctx, a)
  assert.equal((await a.post('/api/missions/switch', { id: 'qp' })).statusCode, 200)
  assert.equal((await a.get('/api/state')).json().missions.w.active.id, 'qp')
  assert.equal((await b.get('/api/state')).json().missions.w.active.id, 'kp')
})

test('requests that change something are refused from another site', async () => {
  const ctx = await testApp()
  const c = await signIn(ctx)
  await parkQp(ctx, c)
  const evil = await c.request('POST', '/api/missions/switch', { id: 'qp' }, { origin: 'https://evil.example' })
  assert.equal(evil.statusCode, 403)
  const own = await c.request('POST', '/api/missions/switch', { id: 'qp' }, { origin: 'http://localhost:3210' })
  assert.equal(own.statusCode, 200)
})
