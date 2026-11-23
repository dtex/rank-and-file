// Lichess public API client. No login needed for public games. Lichess asks for one
// request at a time and a User-Agent that says who is calling, so requests queue here
// across all users.
import { MAX_PLIES } from './chesscom.js'

const BASE = 'https://lichess.org'
const USER_AGENT = process.env.LICHESS_USER_AGENT || process.env.CHESSCOM_USER_AGENT || 'rank-and-file/1.0 (opening tracker)'
const DAY = 86400

/** The first import takes this many of the newest games; older ones would only add to the wait. */
export const FIRST_IMPORT = 1000
/** How far back each sync looks again for games that were still being played last time. */
export const LIVE_OVERLAP = DAY
export const CORRESPONDENCE_OVERLAP = 180 * DAY
/** Lichess has no data before this, and rejects an earlier `since`. */
const EPOCH_MS = 1356998400070

// Lichess's speeds, as the time controls in Settings. chess.com's "rapid" has no upper limit, so classical joins it.
const TIME_CLASS = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'rapid', correspondence: 'daily' }
/** Games that never became a game, or are not over. */
const NOT_PLAYED = ['created', 'started', 'aborted', 'noStart']

let queue = Promise.resolve()
function inTurn(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

/**
 * A user's finished games, as trimmed game records in no particular order.
 * `since` is in unix seconds; `max` keeps the newest that many; `perfType` narrows to one kind.
 */
export function fetchGames(username, { since, max, perfType } = {}, fetchImpl = fetch) {
  const q = new URLSearchParams({ tags: 'false', clocks: 'false', evals: 'false', opening: 'false' })
  if (since) q.set('since', String(Math.max(EPOCH_MS, since * 1000)))
  if (max) q.set('max', String(max))
  if (perfType) q.set('perfType', perfType)
  const url = `${BASE}/api/games/user/${encodeURIComponent(username)}?${q}`
  return inTurn(async () => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/x-ndjson' } })
    if (res.status === 404) throw new Error(`Lichess has no player called ${username}. Check the username in Settings.`)
    if (res.status === 429) throw new Error('Lichess is rate limiting requests. Wait a minute and sync again.')
    if (!res.ok) throw new Error(`Lichess returned ${res.status} for ${username}'s games`)
    const games = []
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue
      let raw
      try {
        raw = JSON.parse(line)
      } catch {
        continue // a line cut short by a dropped connection
      }
      if (isFinished(raw)) games.push(trimGame(raw))
    }
    return games
  })
}

/**
 * True only for a game that is over. The export leaves out games in progress
 * unless asked, but this is the guard that keeps one out of the app, where its
 * opening advice would be help during the game.
 */
export function isFinished(raw, now = Date.now()) {
  if (!raw?.id || !raw.status || NOT_PLAYED.includes(raw.status)) return false
  return Number.isFinite(raw.lastMoveAt) && raw.lastMoveAt <= now
}

const player = (p) => ({ name: p?.user?.name ?? (p?.aiLevel ? `Stockfish level ${p.aiLevel}` : null), rating: p?.rating ?? null })

/** The same record chess.com games are trimmed to, so nothing after this point cares where a game was played. */
export function trimGame(raw) {
  const standard = raw.variant === 'standard'
  const customStart = raw.variant === 'fromPosition'
  // Results use chess.com's words, which the rest of the app reads: "win", a drawn result, or anything else for a loss.
  const drawn = raw.status === 'stalemate' ? 'stalemate' : 'agreed'
  const result = (colour) => (!raw.winner ? drawn : raw.winner === colour ? 'win' : raw.status === 'mate' ? 'checkmated' : raw.status === 'resign' ? 'resigned' : 'timeout')
  const game = {
    uuid: `lichess:${raw.id}`,
    site: 'lichess',
    url: `${BASE}/${raw.id}`,
    // Lichess lists games by when they started, so the start is what the next sync resumes from.
    start: Math.floor(raw.createdAt / 1000),
    end: Math.floor(raw.lastMoveAt / 1000),
    rated: !!raw.rated,
    timeClass: TIME_CLASS[raw.speed] ?? raw.speed,
    timeControl: raw.clock ? `${raw.clock.initial}+${raw.clock.increment}` : raw.daysPerTurn ? `1/${raw.daysPerTurn * DAY}` : '-',
    rules: standard || customStart ? 'chess' : String(raw.variant).toLowerCase(),
    white: { ...player(raw.players?.white), result: result('white') },
    black: { ...player(raw.players?.black), result: result('black') },
    moves: standard ? String(raw.moves || '').split(/\s+/).filter(Boolean).slice(0, MAX_PLIES) : [],
  }
  if (customStart) game.customStart = true
  return game
}
