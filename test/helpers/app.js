// A running app against the test database, with mail and outside requests faked.
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../app.js'
import { loadConfig } from '../../services/config.js'
import { testPool } from './db.js'

export const uniqueEmail = (name = 'user') => `${name}-${randomUUID().slice(0, 8)}@example.com`

export async function testApp({ env = {}, fetchImpl, ...over } = {}) {
  const pool = await testPool()
  const config = loadConfig({
    BASE_URL: 'http://localhost:3210', SESSION_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', GITHUB_CLIENT_ID: 'h-id', GITHUB_CLIENT_SECRET: 'h-secret', ...env,
  })
  const mail = []
  const app = buildApp({
    pool, config, logger: false,
    mailer: { send: async (m) => { mail.push(m) } },
    fetchImpl: fetchImpl ?? (async (url) => { throw new Error(`unexpected request to ${url}`) }),
    ...over,
  })
  await app.ready()
  return { app, pool, config, mail }
}

/** A browser-like client that keeps cookies between requests. */
export function client(app) {
  const jar = new Map()
  return {
    jar,
    async request(method, url, body, headers = {}) {
      const res = await app.inject({ method, url, payload: body, headers, cookies: Object.fromEntries(jar) })
      for (const c of res.cookies) c.value && c.maxAge !== 0 ? jar.set(c.name, c.value) : jar.delete(c.name)
      return res
    },
    get(url) { return this.request('GET', url) },
    post(url, body = {}) { return this.request('POST', url, body) },
    put(url, body = {}) { return this.request('PUT', url, body) },
    del(url) { return this.request('DELETE', url) },
  }
}

export const tokenFrom = (message) => message.text.match(/#magic=([\w-]+)/)[1]

/** Sign in by emailed link. With `ready`, also accept the terms and set a chess.com username. */
export async function signIn(ctx, email = uniqueEmail(), { ready = true, marketing = false, username = 'me' } = {}) {
  const c = client(ctx.app)
  await c.post('/auth/magic', { email })
  const sent = ctx.mail.filter((m) => m.to === email).at(-1)
  const res = await c.post('/auth/magic/verify', { token: tokenFrom(sent) })
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.body}`)
  if (ready) {
    await c.post('/api/account/consent', { age: true, terms: true, marketing })
    await c.put('/api/settings', { username, timeClasses: ['blitz'], ratedOnly: true })
  }
  const { rows } = await ctx.pool.query('select id from users where email = $1', [email])
  return Object.assign(c, { email, userId: rows[0].id })
}
