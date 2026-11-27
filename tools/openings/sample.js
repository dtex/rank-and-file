// A sample of recent rated games from chess.com and Lichess, used to show how often
// each opening is actually reached.
//
// Neither site offers these figures without a login, so the sample is gathered from
// their public game records, in the way each site allows:
//   chess.com  start from a few active players, take each one's newest games, then
//              carry on with the opponents they met. Following opponents moves the
//              sample away from the starting players and into the general pool.
//   Lichess    limits how many players' games can be asked for, so the games come
//              from the arena tournaments that finished in the last hour or two,
//              the open ones and those capped at a rating. Each is one request.
// Player names are used only to find more games and are never written to disk.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gameKeys } from '../../services/matcher.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SAMPLE_FILE = path.join(HERE, '.cache', 'sample.json')

export const SITES = { chesscom: 'chess.com', lichess: 'Lichess' }
/** Games wanted from each site. */
export const TARGET_GAMES = 1500
/** Newest games taken from one player. Kept small so nobody's own repertoire weighs much. */
export const PER_PLAYER = 6
/** Only games that ended within this many days count as recent. */
export const RECENT_DAYS = 30
/** Players asked for before giving up on reaching the target. */
const MAX_PLAYERS = 600
const SEEDS = 40
/** Where chess.com's first players come from: the members of an active club. */
const CHESSCOM_CLUB = 'chess-com-developer-community'
/** Lichess tournaments drawn on at most, so no single one decides the figures; slower games first. */
const TOURNAMENTS = 6
const SPEED_ORDER = ['rapid', 'classical', 'blitz', 'bullet']
const USER_AGENT = () => process.env.LICHESS_USER_AGENT || process.env.CHESSCOM_USER_AGENT || 'rank-and-file/1.0 (opening tracker)'

const DAY = 86400
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pickAny = (list) => list.splice(Math.floor(Math.random() * list.length), 1)[0]

async function chesscomSeeds(fetchImpl) {
  const res = await fetchImpl(`https://api.chess.com/pub/club/${CHESSCOM_CLUB}/members`, { headers: { 'User-Agent': USER_AGENT(), Accept: 'application/json' } })
  if (!res.ok) throw new Error(`chess.com returned ${res.status} for the list of starting players`)
  const body = await res.json()
  return [...(body.weekly ?? []), ...(body.monthly ?? [])].map((m) => m.username).filter(Boolean)
}

/** Read a stream of JSON lines, stopping (and hanging up) once `limit` have arrived. */
async function jsonLines(res, limit) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const out = []
  let buffer = ''
  while (out.length < limit) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      try {
        out.push(JSON.parse(line))
      } catch { /* a blank or partial line */ }
    }
  }
  await reader.cancel().catch(() => {})
  return out.slice(0, limit)
}

/** Games from Lichess's newest finished arenas, an equal share from each. `trim` is lichess.js's trimGame. */
export async function lichessArenas({ target = TARGET_GAMES, now = Date.now(), fetchImpl = fetch, onProgress = () => {} }, { trimGame, isFinished }) {
  const headers = { 'User-Agent': USER_AGENT(), Accept: 'application/x-ndjson' }
  const listed = await fetchImpl('https://lichess.org/api/tournament', { headers: { ...headers, Accept: 'application/json' } })
  if (!listed.ok) throw new Error(`Lichess returned ${listed.status} for its list of tournaments`)
  const arenas = ((await listed.json()).finished ?? [])
    .filter((t) => t.variant?.key === 'standard' && t.rated && SPEED_ORDER.includes(t.perf?.key))
    .sort((a, b) => SPEED_ORDER.indexOf(a.perf.key) - SPEED_ORDER.indexOf(b.perf.key) || b.nbPlayers - a.nbPlayers)
  const share = Math.ceil(target / Math.min(TOURNAMENTS, arenas.length || 1))
  const games = new Map()
  for (const arena of arenas) {
    if (games.size >= target) break
    const res = await fetchImpl(`https://lichess.org/api/tournament/${arena.id}/games?tags=false&clocks=false&evals=false&opening=false`, { headers })
    if (res.status === 429) throw new Error('Lichess is rate limiting requests. Wait a minute and refresh again.')
    if (!res.ok) continue
    for (const raw of await jsonLines(res, Math.min(share, target - games.size))) {
      if (!isFinished(raw, now)) continue
      const g = trimGame(raw)
      if (usable(g, now)) games.set(g.uuid, record(g))
    }
    onProgress(games.size)
  }
  return [...games.values()]
}

/** The month whose archive holds a chess.com player's newest games: last month during the first week. */
function chesscomMonths(now) {
  const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const today = new Date(now)
  const months = [month(today)]
  if (today.getUTCDate() <= 7) months.push(month(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))))
  return months
}

/** How each site's sample is gathered. Loaded late so .env is read first. */
async function sources() {
  const chesscom = await import('../../services/chesscom.js')
  const lichess = await import('../../services/lichess.js')
  const players = {
    seeds: chesscomSeeds,
    async recent(name, now, fetchImpl) {
      const games = []
      for (const key of chesscomMonths(now)) games.push(...((await chesscom.fetchMonth(name, key, null, fetchImpl)).games ?? []))
      return games
    },
  }
  return { chesscom: (options) => crawl(players, options), lichess: (options) => lichessArenas(options, lichess) }
}

const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null)
/** What is kept of a game: enough to replay its opening and describe the sample, and nobody's name. */
const record = (g) => ({ uuid: g.uuid, end: g.end, timeClass: g.timeClass, rating: mean([g.white.rating, g.black.rating].filter(Number.isFinite)), moves: g.moves })
const usable = (g, now) => g.rated && g.rules === 'chess' && !g.customStart && g.moves?.length > 0 && g.end > now / 1000 - RECENT_DAYS * DAY

/**
 * Gather a sample by following players to their opponents. `source` lists the starting
 * players and one player's recent games; `onProgress` hears the count as it grows.
 * Returns the games as { uuid, end, timeClass, rating, moves }.
 */
export async function crawl(source, { target = TARGET_GAMES, now = Date.now(), fetchImpl = fetch, onProgress = () => {}, pause = sleep } = {}) {
  const queue = (await source.seeds(fetchImpl)).sort(() => Math.random() - 0.5).slice(0, SEEDS)
  const asked = new Set()
  const games = new Map()
  let failures = 0
  while (games.size < target && queue.length && asked.size < MAX_PLAYERS) {
    const name = pickAny(queue)
    const key = String(name).toLowerCase()
    if (asked.has(key)) continue
    asked.add(key)
    let recent
    try {
      recent = await source.recent(name, now, fetchImpl)
      failures = 0
    } catch (err) {
      // A player who closed their account or hid their games is skipped; a site that keeps failing ends the run.
      if (++failures >= 8) throw err
      if (/rate limiting/.test(err.message)) await pause(60_000)
      continue
    }
    const newest = recent.filter((g) => usable(g, now)).sort((a, b) => b.end - a.end).slice(0, PER_PLAYER)
    for (const g of newest) {
      if (games.has(g.uuid)) continue
      games.set(g.uuid, record(g))
      for (const p of [g.white, g.black]) if (p.name && !asked.has(p.name.toLowerCase())) queue.push(p.name)
    }
    onProgress(games.size)
  }
  return [...games.values()]
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}

/** Holds both sites' samples, keeps them on disk, and answers how often a position is reached. */
export class Sample {
  constructor(file = SAMPLE_FILE) {
    this.file = file
    this.sites = {}
    this.running = {}
    this.counts = {}
    for (const site of Object.keys(SITES)) this.sites[site] = { fetchedAt: null, games: [] }
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      for (const site of Object.keys(SITES)) if (saved.sites?.[site]) this.sites[site] = saved.sites[site]
    } catch { /* no sample yet */ }
  }

  get empty() {
    return Object.values(this.sites).every((s) => !s.games.length)
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ sites: this.sites }))
    fs.renameSync(tmp, this.file)
  }

  /** How many of a site's games pass through each position, counted once per game. */
  countsFor(site) {
    if (!this.counts[site]) {
      const counts = new Map()
      for (const game of this.sites[site].games) for (const key of new Set(gameKeys(game))) counts.set(key, (counts.get(key) ?? 0) + 1)
      this.counts[site] = counts
    }
    return this.counts[site]
  }

  /** { chesscom: { n, of }, lichess: { n, of } } for a position key; `of` is 0 when there is no sample. */
  reach(key) {
    const out = {}
    for (const site of Object.keys(SITES)) out[site] = { n: this.countsFor(site).get(key) ?? 0, of: this.sites[site].games.length }
    return out
  }

  /** What the page shows about the sample itself. */
  status() {
    const out = {}
    for (const [site, label] of Object.entries(SITES)) {
      const { games, fetchedAt } = this.sites[site]
      out[site] = { label, games: games.length, fetchedAt, rating: median(games.map((g) => g.rating)), running: this.running[site] ?? null }
    }
    return out
  }

  /** Start gathering a fresh sample for both sites, unless one is already under way. Resolves when both end. */
  refresh(options = {}) {
    return Promise.all(Object.keys(SITES).map((site) => this.refreshSite(site, options)))
  }

  async refreshSite(site, options) {
    if (this.running[site] && !this.running[site].error) return
    const state = (this.running[site] = { games: 0, target: options.target ?? TARGET_GAMES, error: null })
    try {
      const gather = options.sources?.[site] ?? (await sources())[site]
      const games = await gather({ ...options, onProgress: (n) => { state.games = n } })
      if (!games.length) throw new Error(`No recent games came back from ${SITES[site]}.`)
      // The old sample stays in use until the new one is complete.
      this.sites[site] = { fetchedAt: new Date(options.now ?? Date.now()).toISOString(), games }
      delete this.counts[site]
      this.save()
      this.running[site] = null
    } catch (err) {
      state.error = err.message
    }
  }
}
