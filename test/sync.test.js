import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PLIES } from '../services/chesscom.js'
import { runSync } from '../services/engine.js'
import { sitesBehind } from '../services/store.js'
import { stateView } from '../services/views.js'
import { loadTree } from '../services/tree.js'
import { FULL_PLAN } from '../services/entitlement.js'
import { testStore } from './helpers/db.js'

const T = 1_760_000_000
// Knights out and back: legal for as long as needed, and on no opening's line.
const plies = (n) => Array.from({ length: n }, (_, i) => ['Nf3', 'Nf6', 'Ng1', 'Ng8'][i % 4])
const pgn = (n) => `[Result "1-0"]\n\n${plies(n).map((san, i) => (i % 2 ? san : `${i / 2 + 1}. ${san}`)).join(' ')} 1-0`

const ccRaw = (uuid, end, n = 70) => ({
  uuid, url: `https://www.chess.com/game/live/${uuid}`, end_time: end, rated: true, time_class: 'blitz', time_control: '300', rules: 'chess',
  white: { username: 'me', rating: 800, result: 'win' }, black: { username: 'them', rating: 800, result: 'resigned' }, pgn: pgn(n),
})
/** The same game as it was stored when only 30 plies were kept. */
const ccStored = (uuid, end) => ({
  uuid, url: `https://www.chess.com/game/live/${uuid}`, end, rated: true, timeClass: 'blitz', timeControl: '300', rules: 'chess',
  white: { name: 'me', rating: 800, result: 'win' }, black: { name: 'them', rating: 800, result: 'resigned' }, moves: plies(30),
})
const liRaw = (id, at, n = 70) => ({
  id, rated: true, variant: 'standard', speed: 'blitz', createdAt: at * 1000, lastMoveAt: (at + 600) * 1000, status: 'resign', winner: 'white',
  players: { white: { user: { name: 'me' }, rating: 1500 }, black: { user: { name: 'them' }, rating: 1500 } },
  moves: plies(n).join(' '), clock: { initial: 300, increment: 0 },
})
const liStored = (id, at) => ({
  uuid: `lichess:${id}`, site: 'lichess', url: `https://lichess.org/${id}`, start: at, end: at + 600, rated: true, timeClass: 'blitz', timeControl: '300+0', rules: 'chess',
  white: { name: 'me', rating: 1500, result: 'win' }, black: { name: 'them', rating: 1500, result: 'resigned' }, moves: plies(30),
})

/** Both sites. chess.com answers 304 to a matching etag, as the real one does. */
function fakeSites({ chesscom = {}, lichess = [], lichessStatus = 200 } = {}) {
  const calls = []
  const impl = async (url, { headers }) => {
    calls.push({ url, etag: headers['If-None-Match'] ?? null })
    const u = new URL(url)
    if (u.hostname === 'lichess.org') {
      if (lichessStatus !== 200) return new Response('', { status: lichessStatus })
      const since = Number(u.searchParams.get('since') ?? 0)
      return new Response(`${lichess.filter((g) => g.createdAt >= since).map((g) => JSON.stringify(g)).join('\n')}\n`, { status: 200 })
    }
    if (url.endsWith('/games/archives')) {
      return Response.json({ archives: Object.keys(chesscom).map((k) => `https://api.chess.com/pub/player/me/games/${k.replace('-', '/')}`) })
    }
    const key = url.match(/(\d{4})\/(\d{2})$/).slice(1).join('-')
    if (headers['If-None-Match'] === `etag-${key}`) return new Response(null, { status: 304 })
    return Response.json({ games: chesscom[key] }, { headers: { etag: `etag-${key}` } })
  }
  const months = () => calls.filter((c) => /\/\d{4}\/\d{2}$/.test(c.url))
  return { impl, calls, months, set: (over) => ({ lichessStatus } = { lichessStatus, ...over }) }
}

/** A user whose progress was saved before `movesStored` existed, unless `old` is false. */
async function user(usernames, { old = true } = {}) {
  const { store } = await testStore()
  const p = await store.loadProgress()
  p.settings.usernames = { chesscom: '', lichess: '', ...usernames }
  if (old) delete p.movesStored
  await store.saveProgress(p)
  return store
}

const MONTHS = { '2025-08': [['a', T]], '2025-09': [['b', T + 100]], '2025-10': [['c', T + 200]] }
const chesscomSide = () => Object.fromEntries(Object.entries(MONTHS).map(([k, gs]) => [k, gs.map(([id, end]) => ccRaw(id, end))]))
async function storeMonths(store) {
  for (const [key, gs] of Object.entries(MONTHS)) await store.saveMonth(key, gs.map(([id, end]) => ccStored(id, end)), `etag-${key}`)
}

test('a backfill fetches every chess.com month without etags, lengthens the games, and runs once', async () => {
  const store = await user({ chesscom: 'me' })
  await storeMonths(store)
  const api = fakeSites({ chesscom: chesscomSide() })
  assert.deepEqual(stateView(loadTree(), await store.loadProgress(), [], FULL_PLAN).catchingUp, { site: null })

  const first = await runSync({ store, fetchImpl: api.impl })
  assert.equal(api.months().length, 3, 'every month is fetched')
  assert.ok(api.months().every((c) => c.etag === null), 'with no etag, so none answers 304')
  assert.equal(first.added, 0)
  assert.equal(first.lengthened, 3)
  assert.equal(first.movesKept, MAX_PLIES / 2)
  assert.ok((await store.loadAllGames()).every((g) => g.moves.length === MAX_PLIES && g.verdict), 'longer, and still judged')
  const after = await store.loadProgress()
  assert.equal(after.movesStored.chesscom, MAX_PLIES)
  assert.equal(stateView(loadTree(), after, [], FULL_PLAN).catchingUp, null)

  api.calls.length = 0
  const second = await runSync({ store, fetchImpl: api.impl })
  assert.deepEqual(api.months().map((c) => c.url.slice(-7)), ['2025/09', '2025/10'], 'back to the two newest months')
  assert.ok(api.months().every((c) => c.etag), 'with their new etags')
  assert.equal(second.lengthened, 0)
})

test('a site that fails stays behind, and the other moves on', async () => {
  const store = await user({ chesscom: 'me', lichess: 'me' })
  await storeMonths(store)
  await store.saveGames([liStored('g1', T + 300)])
  const api = fakeSites({ chesscom: chesscomSide(), lichess: [liRaw('g1', T + 300)], lichessStatus: 503 })

  const first = await runSync({ store, fetchImpl: api.impl })
  assert.match(first.problem, /Lichess returned 503/)
  assert.equal(first.lengthened, 3)
  let p = await store.loadProgress()
  assert.equal(p.movesStored.chesscom, MAX_PLIES)
  assert.deepEqual(sitesBehind(p), ['lichess'])
  assert.deepEqual(stateView(loadTree(), p, [], FULL_PLAN).catchingUp, { site: 'lichess' })

  api.set({ lichessStatus: 200 })
  api.calls.length = 0
  const second = await runSync({ store, fetchImpl: api.impl })
  assert.equal(second.problem, null)
  assert.equal(second.lengthened, 1, 'only the Lichess game was still short')
  assert.equal(api.months().filter((c) => c.etag === null).length, 0, 'chess.com is not fetched in full a second time')
  const lichessCalls = api.calls.filter((c) => c.url.includes('lichess.org'))
  assert.match(lichessCalls[0].url, /max=1000/, 'the newest games again, before the usual requests')
  assert.equal(lichessCalls.length, 3)
  p = await store.loadProgress()
  assert.deepEqual(sitesBehind(p), [])
})

test('new progress never backfills', async () => {
  const store = await user({ chesscom: 'me' }, { old: false })
  await storeMonths(store)
  const api = fakeSites({ chesscom: chesscomSide() })
  const res = await runSync({ store, fetchImpl: api.impl })
  assert.deepEqual(api.months().map((c) => c.url.slice(-7)), ['2025/09', '2025/10'])
  assert.equal(res.lengthened, 0)
})
