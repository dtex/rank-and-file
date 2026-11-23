// Pull new games from chess.com and Lichess into the user's store.
import { fetchArchives, fetchMonth } from './chesscom.js'
import { CORRESPONDENCE_OVERLAP, FIRST_IMPORT, LIVE_OVERLAP, fetchGames } from './lichess.js'
import { usernamesOf } from './sites.js'

/**
 * chess.com files games by month. Fetches any month we don't have, and re-checks
 * the two most recent months (a game can finish in either). Unchanged months
 * answer 304 and cost nothing.
 */
async function pullChesscom({ store, username, fetchImpl }) {
  const months = await fetchArchives(username, fetchImpl)
  const have = await store.loadMonths()
  const recent = new Set(months.slice(-2))
  const added = []

  for (const key of months) {
    const known = key in have
    if (known && !recent.has(key)) continue
    const res = await fetchMonth(username, key, known ? have[key] : null, fetchImpl)
    if (res.notModified) continue
    added.push(...(await store.saveMonth(key, res.games, res.etag)))
  }
  return added
}

/**
 * Lichess lists games by when they started. The first time, take the newest
 * FIRST_IMPORT. After that, ask for everything since shortly before the newest
 * game we hold: a game still being played last time is not in that answer, so
 * each sync looks back a day, and half a year for correspondence games, which
 * can run for months. Games already stored are skipped on saving.
 */
async function pullLichess({ store, username, fetchImpl }) {
  const latest = await store.latestStart('lichess')
  if (latest === null) return store.saveGames(await fetchGames(username, { max: FIRST_IMPORT }, fetchImpl))
  const live = await fetchGames(username, { since: latest - LIVE_OVERLAP }, fetchImpl)
  const slow = await fetchGames(username, { since: latest - CORRESPONDENCE_OVERLAP, perfType: 'correspondence' }, fetchImpl)
  return store.saveGames([...live, ...slow])
}

const PULL = { chesscom: pullChesscom, lichess: pullLichess }

/**
 * Fetch new games for every account the user follows. Returns { added, problem }:
 * the games that were not stored before, oldest first, and the message of a site
 * that failed while the other answered. When nothing answered, the failure is thrown.
 */
export async function pullGames({ store, settings, fetchImpl = fetch }) {
  const added = []
  let failure = null
  let answered = 0
  for (const [site, username] of Object.entries(usernamesOf(settings))) {
    if (!username) continue
    try {
      added.push(...(await PULL[site]({ store, username, fetchImpl })))
      answered++
    } catch (err) {
      failure ??= err
    }
  }
  if (failure && !answered) throw failure
  return { added: added.sort((a, b) => a.end - b.end), problem: failure?.message ?? null }
}
