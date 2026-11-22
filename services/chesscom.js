// chess.com public API client. No login needed. Requests go out one at a time
// because the API rejects parallel bursts.
const BASE = 'https://api.chess.com/pub'
const USER_AGENT = 'chess-buddy/0.1 (personal opening tracker)'
const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** How many plies of each game are kept. Openings are decided well before this. */
export const MAX_PLIES = 30

async function get(url, etag, fetchImpl) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  if (etag) headers['If-None-Match'] = etag
  const res = await fetchImpl(url, { headers })
  if (res.status === 304) return { notModified: true }
  if (res.status === 404) throw new Error(`chess.com has no data at ${url}. Check the username in Settings.`)
  if (res.status === 429) throw new Error('chess.com is rate limiting requests. Wait a minute and sync again.')
  if (!res.ok) throw new Error(`chess.com returned ${res.status} for ${url}`)
  return { etag: res.headers.get('etag'), body: await res.json() }
}

/** Month keys ("2026-11") that have at least one finished game, oldest first. */
export async function fetchArchives(username, fetchImpl = fetch) {
  const { body } = await get(`${BASE}/player/${encodeURIComponent(username.toLowerCase())}/games/archives`, null, fetchImpl)
  return (body.archives || [])
    .map((u) => u.match(/(\d{4})\/(\d{2})$/))
    .filter(Boolean)
    .map((m) => `${m[1]}-${m[2]}`)
    .sort()
}

/** One month of games. Returns { notModified: true } when the etag still matches. */
export async function fetchMonth(username, key, etag, fetchImpl = fetch) {
  const [y, m] = key.split('-')
  const res = await get(`${BASE}/player/${encodeURIComponent(username.toLowerCase())}/games/${y}/${m}`, etag, fetchImpl)
  if (res.notModified) return res
  return { etag: res.etag, games: (res.body.games || []).filter((g) => isFinished(g)).map(trimGame) }
}

/**
 * True only for a game that is over. The monthly archive should hold nothing
 * else, but this is the guard that keeps a game still being played out of the
 * app, where its opening advice would be help during the game.
 */
export function isFinished(raw, now = Date.now() / 1000) {
  if (!raw || !Number.isFinite(raw.end_time) || raw.end_time > now) return false
  if (!raw.white?.result || !raw.black?.result) return false
  const result = raw.pgn?.match(/^\[Result "([^"]*)"\]/m)?.[1]
  return result !== '*'
}

/** Pull the SAN moves out of a chess.com PGN, dropping headers, clocks and move numbers. */
export function parseMoves(pgn, max = MAX_PLIES) {
  if (!pgn) return []
  const body = pgn
    .replace(/^\[.*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
  const moves = []
  for (const tok of body.split(/\s+/)) {
    if (!tok || /^\d+\.+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue
    moves.push(tok.replace(/^\d+\.+/, ''))
    if (moves.length >= max) break
  }
  return moves
}

/** Keep only what the app uses, so month files stay small in git. */
export function trimGame(raw) {
  const customStart = !!raw.initial_setup && raw.initial_setup !== STANDARD_START
  const game = {
    uuid: raw.uuid,
    url: raw.url,
    end: raw.end_time,
    rated: !!raw.rated,
    timeClass: raw.time_class,
    timeControl: raw.time_control,
    rules: raw.rules,
    white: { name: raw.white?.username, rating: raw.white?.rating, result: raw.white?.result },
    black: { name: raw.black?.username, rating: raw.black?.rating, result: raw.black?.result },
    moves: raw.rules === 'chess' && !customStart ? parseMoves(raw.pgn) : [],
  }
  if (customStart) game.customStart = true
  return game
}
