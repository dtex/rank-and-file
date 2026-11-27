// Pull new games from chess.com and Lichess into the user's store.
import { fetchArchives, fetchMonth } from './chesscom.js'
import { CORRESPONDENCE_OVERLAP, FIRST_IMPORT, LIVE_OVERLAP, fetchGames } from './lichess.js'
import { usernamesOf } from './sites.js'

/** Add what one save returned to the running totals of a pull. */
function tally(total, saved) {
  total.added.push(...saved.added)
  total.lengthened += saved.lengthened
  return total
}

/**
 * chess.com files games by month. Fetches any month we don't have, and re-checks
 * the two most recent months (a game can finish in either). Unchanged months
 * answer 304 and cost nothing. A backfill fetches every month afresh, with no
 * etag, so that games stored with fewer moves come back whole.
 */
async function pullChesscom({ store, username, fetchImpl, backfill }) {
  const months = await fetchArchives(username, fetchImpl)
  const have = await store.loadMonths()
  const recent = new Set(months.slice(-2))
  const total = { added: [], lengthened: 0 }

  for (const key of months) {
    const known = key in have
    if (known && !recent.has(key) && !backfill) continue
    const res = await fetchMonth(username, key, known && !backfill ? have[key] : null, fetchImpl)
    if (res.notModified) continue
    tally(total, await store.saveMonth(key, res.games, res.etag))
  }
  return total
}

/**
 * Lichess lists games by when they started. The first time, take the newest
 * FIRST_IMPORT. After that, ask for everything since shortly before the newest
 * game we hold: a game still being played last time is not in that answer, so
 * each sync looks back a day, and half a year for correspondence games, which
 * can run for months. Games already stored are skipped on saving.
 *
 * A backfill takes the newest FIRST_IMPORT again before the usual requests. Older
 * games keep the moves they have: fetching a long history would hold the queue
 * that every user's Lichess requests share.
 */
async function pullLichess({ store, username, fetchImpl, backfill }) {
  const latest = await store.latestStart('lichess')
  if (latest === null) return store.saveGames(await fetchGames(username, { max: FIRST_IMPORT }, fetchImpl))
  const total = { added: [], lengthened: 0 }
  if (backfill) tally(total, await store.saveGames(await fetchGames(username, { max: FIRST_IMPORT }, fetchImpl)))
  const live = await fetchGames(username, { since: latest - LIVE_OVERLAP }, fetchImpl)
  const slow = await fetchGames(username, { since: latest - CORRESPONDENCE_OVERLAP, perfType: 'correspondence' }, fetchImpl)
  return tally(total, await store.saveGames([...live, ...slow]))
}

const PULL = { chesscom: pullChesscom, lichess: pullLichess }

/**
 * Fetch new games for every account the user follows. `backfill` names the sites whose
 * stored games should be fetched again to lengthen them. Returns:
 *   added       the games that were not stored before, oldest first
 *   lengthened  how many stored games came back with more moves
 *   answered    the sites that were read without a failure
 *   problem     the message of a site that failed while another answered
 * When nothing answered, the failure is thrown.
 */
export async function pullGames({ store, settings, backfill = [], fetchImpl = fetch }) {
  const total = { added: [], lengthened: 0 }
  const answered = []
  let failure = null
  for (const [site, username] of Object.entries(usernamesOf(settings))) {
    if (!username) continue
    try {
      tally(total, await PULL[site]({ store, username, fetchImpl, backfill: backfill.includes(site) }))
      answered.push(site)
    } catch (err) {
      failure ??= err
    }
  }
  if (failure && !answered.length) throw failure
  return { added: total.added.sort((a, b) => a.end - b.end), lengthened: total.lengthened, answered, problem: failure?.message ?? null }
}
