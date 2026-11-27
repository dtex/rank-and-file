// The openings editor in tools/openings: it rewrites data/tree.json, so these run on a copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TREE_FILE, loadTree, popularityFileFor } from '../services/tree.js'
import { addOpening, deleteOpening, formatTree, newId, readTree, updateOpening } from '../tools/openings/tree-file.js'
import { PER_PLAYER, Sample, crawl, lichessArenas } from '../tools/openings/sample.js'
import { buildServer } from '../tools/openings/server.js'
import { isFinished, trimGame } from '../services/lichess.js'

const NOW = Date.UTC(2026, 10, 24)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openings-tool-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
let copies = 0
const copy = () => {
  const file = path.join(dir, `tree-${++copies}.json`)
  fs.copyFileSync(TREE_FILE, file)
  return file
}

let n = 0
const game = (moves, over = {}) => ({
  uuid: `s${++n}`, end: NOW / 1000 - 3600, rated: true, timeClass: 'blitz', rules: 'chess',
  white: { name: `w${n}`, rating: 1000 }, black: { name: `b${n}`, rating: 1200 }, moves: moves.split(' '), ...over,
})
/** A sample that already holds these games, with nothing on disk. */
const sampleOf = (chesscom, lichess = []) => {
  const sample = new Sample(path.join(dir, `sample-${++copies}.json`))
  sample.sites.chesscom = { fetchedAt: new Date(NOW).toISOString(), games: chesscom }
  sample.sites.lichess = { fetchedAt: new Date(NOW).toISOString(), games: lichess }
  return sample
}
const HEADERS = { host: 'localhost:3211' }
const call = async (app, method, url, payload) => {
  const res = await app.inject({ method, url, payload, headers: HEADERS })
  return { status: res.statusCode, body: res.json() }
}

test('the file is written exactly as it is kept by hand', () => {
  assert.equal(formatTree(readTree()), fs.readFileSync(TREE_FILE, 'utf8'))
})

test('a new opening goes after the last one beneath its parent, with history and the rest in a fixed order', () => {
  const raw = readTree()
  const next = addOpening(raw, {
    parent: 'kp', name: ' Test Defence ', aliases: ['Baker’s Defence', ' ', 'test defence', 'Baker’s Defence'], side: 'b', moves: 'e4  a6', eco: '', target: '',
    history: 'Named after a test.\n\nSecond paragraph.  ', ideas: ['Develop.', ' '], checks: [{ play: 'N*', within: 3 }, null], extra: { source: 'me', weight: 2 },
  }, 'kp-test')
  const added = next.find((x) => x.id === 'kp-test')
  assert.deepEqual(added, {
    id: 'kp-test', parent: 'kp', name: 'Test Defence', side: 'b', moves: 'e4 a6', aliases: ['Baker’s Defence'],
    history: 'Named after a test.\n\nSecond paragraph.', ideas: ['Develop.'], checks: [{ play: 'N*', within: 3 }], source: 'me', weight: 2,
  })
  // Everything beneath 1.e4 comes before it; the first opening outside comes after.
  const beneath = new Set(['kp'])
  for (const x of raw) if (beneath.has(x.parent)) beneath.add(x.id)
  const at = next.indexOf(added)
  assert.ok(next.slice(0, at).filter((x) => beneath.has(x.id)).length === beneath.size)
  assert.match(formatTree(next), /\{ "id": "kp-test", "parent": "kp", "name": "Test Defence", "side": "b", "moves": "e4 a6",\n {4}"aliases": \["Baker’s Defence"\],\n {4}"history": "Named after a test\.\\n\\nSecond paragraph\.",\n {4}"ideas": \["Develop\."\],\n {4}"checks": \[\{ "play": "N\*", "within": 3 \}\],\n {4}"source": "me",\n {4}"weight": 2 \}/)
  assert.equal(raw.length + 1, next.length, 'the tree passed in is left alone')
})

test('changes that would break the map are refused, in words', () => {
  const raw = readTree()
  const base = { parent: 'kp', name: 'X', side: 'b', moves: 'e4 a6' }
  assert.throws(() => addOpening(raw, base, 'open'), /already an opening with the id "open"/)
  assert.throws(() => addOpening(raw, { ...base, name: 'open game' }), /Two openings are called "open game"/)
  assert.throws(() => addOpening(raw, { ...base, moves: 'e4 e6 Ke3' }), /illegal move "Ke3"/)
  assert.throws(() => addOpening(raw, { ...base, moves: 'd4 d5' }), /must extend the moves of its parent "kp"/)
  assert.throws(() => addOpening(raw, { ...base, moves: 'e4 e5' }), /reach the same position/)
  assert.throws(() => addOpening(raw, { ...base, ideas: ['One'], checks: [{ play: 'zz' }] }), /"zz" is not a move/)
  assert.throws(() => addOpening(raw, { ...base, target: '2.5' }), /whole number/)
  assert.throws(() => updateOpening(raw, 'kp', { ...raw.find((x) => x.id === 'kp'), parent: 'open' }), /must extend the moves/)
  assert.throws(() => deleteOpening(raw, 'start'), /cannot be deleted/)
})

test('an opening keeps its id whatever else changes; deleting moves the ones beneath it up', () => {
  const raw = readTree()
  const kp = raw.find((x) => x.id === 'kp')
  const children = raw.filter((x) => x.parent === 'kp').map((x) => x.id)
  assert.ok(children.length)

  // A new name, and the old one kept as an alias. An id sent by the form is ignored.
  const renamed = updateOpening(raw, 'kp', { ...kp, id: 'e4', name: 'King’s Pawn Game', aliases: [kp.name, 'Open Games'] })
  const after = renamed.find((x) => x.id === 'kp')
  assert.deepEqual([after.name, after.aliases], ['King’s Pawn Game', [kp.name, 'Open Games']])
  assert.equal(renamed.some((x) => x.id === 'e4'), false)
  assert.deepEqual(renamed.filter((x) => x.parent === 'kp').map((x) => x.id), children)
  assert.equal(renamed.indexOf(after), raw.indexOf(kp), 'it keeps its place in the file')
  // The name another opening gave up is free to use, and an alias may repeat a name used elsewhere.
  assert.ok(updateOpening(renamed, 'open', { ...raw.find((x) => x.id === 'open'), name: kp.name, aliases: ['King’s Pawn Game'] }))

  // New ids are made up, not built from the name.
  const ids = Array.from({ length: 50 }, () => newId(raw))
  assert.ok(ids.every((id) => /^[a-z][a-z2-9]{7}$/.test(id) && !raw.some((x) => x.id === id)))
  assert.equal(new Set(ids).size, 50)

  const open = raw.find((x) => x.id === 'open')
  const below = raw.filter((x) => x.parent === 'open').map((x) => x.id)
  const removed = deleteOpening(raw, 'open')
  assert.equal(removed.some((x) => x.id === 'open'), false)
  for (const id of below) assert.equal(removed.find((x) => x.id === id).parent, open.parent)
})

test('the editor saves through its API and the app can load the result', async () => {
  const file = copy()
  const app = buildServer({ file, sample: sampleOf([game('e4 e5 Nf3'), game('e4 c5'), game('d4 d5'), game('Nf3 e5 e4')], [game('e4 e5')]) })

  const before = await call(app, 'GET', '/api/tree')
  const kp = before.body.openings.find((o) => o.id === 'kp')
  assert.deepEqual([kp.reach.chesscom, kp.reach.lichess], [{ n: 2, of: 4 }, { n: 1, of: 1 }])
  // A game that gets there by another move order counts, as it does for a player's mission.
  assert.deepEqual(before.body.openings.find((o) => o.id === 'knight').reach.chesscom, { n: 2, of: 4 })

  const saved = await call(app, 'PUT', '/api/openings/kp', { ...kp, history: 'Why it is called the King’s Pawn.' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.openings.find((o) => o.id === 'kp').history, 'Why it is called the King’s Pawn.')
  assert.equal(loadTree(file).byId.get('kp').history, 'Why it is called the King’s Pawn.')
  // Nothing else in the file moved.
  const lines = (f) => fs.readFileSync(f, 'utf8').split('\n')
  const changed = lines(file).filter((line, i) => line !== lines(TREE_FILE)[i])
  assert.equal(lines(file).length, lines(TREE_FILE).length)
  assert.deepEqual(changed, ['    "history": "Why it is called the King’s Pawn.",'])

  const added = await call(app, 'POST', '/api/openings', { id: 'mine', parent: 'kp', name: 'St. George Defence', aliases: ['Baker’s Defence'], side: 'b', moves: 'e4 a6' })
  assert.equal(added.status, 200)
  const id = added.body.id
  assert.match(id, /^[a-z][a-z2-9]{7}$/, 'the editor chooses the id')
  assert.deepEqual([added.body.openings.find((o) => o.id === id).depth, loadTree(file).byId.get(id).aliases], [2, ['Baker’s Defence']])

  const refused = await call(app, 'POST', '/api/openings', { parent: 'kp', name: 'Again', side: 'b', moves: 'e4 a6' })
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /reach the same position/)
  assert.equal(loadTree(file).nodes.some((x) => x.name === 'Again'), false, 'a refused change writes nothing')

  const gone = await call(app, 'DELETE', `/api/openings/${id}`)
  assert.equal(gone.body.openings.some((o) => o.id === id), false)
})

test('the chess.com figures are written beside the map for the app, on every save and every new chess.com sample', async () => {
  const file = copy()
  const figures = popularityFileFor(file)
  fs.rmSync(figures, { force: true })
  const sample = sampleOf([game('e4 e5 Nf3'), game('e4 c5'), game('d4 d5'), game('Nf3 e5 e4')], [game('e4 e5'), game('e4 e5')])
  const app = buildServer({ file, sample })
  assert.equal(loadTree(file).byId.get('kp').popularity, 0, 'no figures until the editor writes them')

  const added = await call(app, 'POST', '/api/openings', { parent: 'kp', name: 'St. George Defence', side: 'b', moves: 'e4 a6' })
  const written = JSON.parse(fs.readFileSync(figures, 'utf8'))
  assert.deepEqual([written.site, written.games, written.sampledAt], ['chess.com', 4, new Date(NOW).toISOString()])
  assert.deepEqual(Object.keys(written.reached), readTree(file).slice(1).map((x) => x.id), 'every opening, in map order')
  // chess.com's games only, and by any move order: 1.e4 e5 2.Nf3 is reached twice, 1.e4 e5 once, whatever Lichess has.
  const tree = loadTree(file)
  assert.deepEqual(['kp', 'open', 'knight', 'sicilian', 'qp', added.body.id].map((id) => tree.byId.get(id).popularity), [2, 1, 2, 1, 1, 0])

  await sample.refresh({ sources: { chesscom: async () => [game('e4 a6'), game('e4 a6')], lichess: async () => [game('d4')] }, now: NOW })
  assert.equal(loadTree(file).byId.get(added.body.id).popularity, 2)

  // Without a chess.com sample the figures on disk are kept.
  const empty = buildServer({ file, sample: sampleOf([]) })
  await call(empty, 'DELETE', `/api/openings/${added.body.id}`)
  assert.equal(JSON.parse(fs.readFileSync(figures, 'utf8')).games, 2)
})

test('a line can be tried before it is saved', async () => {
  const app = buildServer({ file: copy(), sample: sampleOf([game('e4 a6'), game('d4 d5')]) })
  const fine = (await call(app, 'POST', '/api/preview', { moves: 'e4 a6' })).body
  assert.deepEqual([fine.depth, fine.sameAs, fine.reach.chesscom], [2, null, { n: 1, of: 2 }])
  assert.match(fine.fen, /^rnbqkbnr\/1ppppppp\/p7\//)
  assert.equal((await call(app, 'POST', '/api/preview', { moves: 'e4 e5' })).body.sameAs.id, 'open')
  assert.match((await call(app, 'POST', '/api/preview', { moves: 'e4 e5 Ke3' })).body.error, /"Ke3" is not a legal move/)
})

test('the editor answers only its own page', async () => {
  const app = buildServer({ file: copy(), sample: sampleOf([]) })
  const from = (headers) => app.inject({ method: 'DELETE', url: '/api/openings/italian', headers })
  assert.equal((await from({ host: 'evil.example' })).statusCode, 403)
  assert.equal((await from({ host: 'localhost:3211', origin: 'https://evil.example' })).statusCode, 403)
  assert.equal((await from({ host: 'localhost:3211', origin: 'http://localhost:3211' })).statusCode, 200)
})

test('the sample follows opponents, takes a few recent rated games from each player, and keeps no names', async () => {
  // Every player has ten games: eight usable, one casual and one too old.
  const asked = []
  const source = {
    seeds: async () => ['seed'],
    recent: async (name) => {
      asked.push(name)
      if (name === 'gone') throw new Error('chess.com has no data')
      const usable = Array.from({ length: 8 }, (_, i) => game('e4 e5', { end: NOW / 1000 - i * 60, white: { name, rating: 1000 }, black: { name: i === 0 ? 'gone' : `${name}-opp${i}`, rating: 1100 } }))
      return [...usable, game('d4', { rated: false }), game('d4', { end: NOW / 1000 - 90 * 86400 })]
    },
  }
  const games = await crawl(source, { target: 20, now: NOW })
  assert.ok(games.length >= 20 && games.length < 20 + PER_PLAYER)
  assert.equal(asked[0], 'seed')
  assert.ok(asked.length > 3, 'it moved on to opponents')
  assert.ok(games.every((g) => g.moves.join(' ') === 'e4 e5'), 'casual and old games are left out')
  assert.deepEqual(Object.keys(games[0]).sort(), ['end', 'moves', 'rating', 'timeClass', 'uuid'])
  assert.equal(games[0].rating, 1050)

  const sample = sampleOf([game('d4')])
  await sample.refresh({ sources: { chesscom: (options) => crawl(source, options), lichess: async () => { throw new Error('Lichess returned 503') } }, target: 12, now: NOW })
  const status = sample.status()
  assert.equal(status.chesscom.running, null)
  assert.ok(status.chesscom.games >= 12)
  assert.equal(status.chesscom.rating, 1050)
  assert.equal(status.lichess.running.error, 'Lichess returned 503')
  assert.ok(new Sample(sample.file).sites.chesscom.games.length >= 12, 'it is kept on disk')
})

test('the Lichess sample takes an equal share of standard rated games from each finished arena', async () => {
  const raw = (id, over = {}) => ({
    id, rated: true, variant: 'standard', speed: 'blitz', status: 'mate', winner: 'white', createdAt: NOW - 3_600_000, lastMoveAt: NOW - 3_000_000,
    players: { white: { user: { name: 'someone' }, rating: 1400 }, black: { user: { name: 'other' }, rating: 1500 } }, moves: 'e4 e5 Nf3', ...over,
  })
  const arena = (id, key, nbPlayers, over = {}) => ({ id, nbPlayers, rated: true, variant: { key: 'standard' }, perf: { key }, ...over })
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url.replace('https://lichess.org/api/tournament', '').split('?')[0])
    if (url.endsWith('/api/tournament')) {
      return Response.json({ finished: [arena('bul', 'bullet', 900), arena('anti', 'antichess', 50, { variant: { key: 'antichess' } }), arena('ultra', 'ultraBullet', 99), arena('rap', 'rapid', 100), arena('bli', 'blitz', 500)] })
    }
    const id = url.match(/tournament\/(\w+)\/games/)[1]
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify(raw(`${id}${i}`, i === 0 ? { status: 'started' } : {})))
    return new Response(`${lines.join('\n')}\n`)
  }
  const games = await lichessArenas({ target: 30, now: NOW, fetchImpl }, { isFinished, trimGame })
  // Three arenas qualify, so ten lines from each, slowest games first; the unfinished game in each is dropped.
  assert.deepEqual(asked, ['', '/rap/games', '/bli/games', '/bul/games'])
  assert.equal(games.length, 27)
  assert.deepEqual(games[0], { uuid: 'lichess:rap1', end: (NOW - 3_000_000) / 1000, timeClass: 'blitz', rating: 1450, moves: ['e4', 'e5', 'Nf3'] })
})
