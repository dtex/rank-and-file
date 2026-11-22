// Pull new games from chess.com into the user's store.
import { fetchArchives, fetchMonth } from './chesscom.js'

/**
 * Fetches any month we don't have, and re-checks the two most recent months
 * (a game can finish in either). Unchanged months answer 304 and cost nothing.
 * Returns the games that were not stored before, oldest first.
 */
export async function pullGames({ store, username, fetchImpl = fetch }) {
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
  return added.sort((a, b) => a.end - b.end)
}
