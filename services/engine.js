// Ties the pieces together: load state, sync, and keep missions moving.
import { pullGames } from './sync.js'
import { loadTree } from './tree.js'
import { applyEntitlement, fillSlots, processGames } from './missions.js'
import { FULL_PLAN } from './entitlement.js'
import { updateAdviceMissions } from './advice.js'
import { sitesBehind, withLock } from './store.js'
import { MAX_PLIES } from './chesscom.js'
import { SITE_NAMES, hasUsername } from './sites.js'

let tree = null
export function getTree() {
  return (tree ??= loadTree())
}

const now = () => Math.floor(Date.now() / 1000)

/** Run `fn` with nothing else reading or changing this user's progress meanwhile. */
export const locked = (store, fn) => withLock(store.userId, fn)

/**
 * Progress brought in line with the user's plan, with both mission slots filled
 * where the plan allows. Saves if anything changed.
 */
export async function loadState({ store, plan = FULL_PLAN }) {
  const progress = await store.loadProgress()
  if (!hasUsername(progress.settings)) {
    throw Object.assign(new Error(`Add your username on ${SITE_NAMES.replace(' and ', ' or ')} first.`), { statusCode: 409, needsUsername: true })
  }
  const relocked = applyEntitlement(getTree(), progress, plan.subscribed, now())
  const games = await store.loadAllGames()
  const started = fillSlots(getTree(), progress, now(), plan.limit, games)
  if (relocked || started.length) await store.saveProgress(progress)
  return { tree: getTree(), progress, games }
}

export async function runSync({ store, fetchImpl, plan = FULL_PLAN }) {
  // Missions must exist before new games are judged.
  const { progress: before } = await locked(store, () => loadState({ store, plan }))
  // The slow part, talking to the chess sites, runs without holding the lock.
  const behind = sitesBehind(before)
  const { added, lengthened, answered, problem } = await pullGames({ store, settings: before.settings, backfill: behind, fetchImpl })

  return locked(store, async () => {
    // Read again: a mission may have been switched while the games were downloading.
    const { progress, games } = await loadState({ store, plan })
    const { judged, events } = processGames(getTree(), progress, games, plan.limit)
    await store.saveVerdicts(judged)
    // After the verdicts, so an opening uncovered in this sync is already known.
    const advice = updateAdviceMissions(getTree(), progress, games)
    progress.lastSync = now()
    // Only a site that answered has its games at full length. One that failed is fetched again next time.
    for (const site of behind.filter((s) => answered.includes(s))) {
      progress.movesStored = { ...progress.movesStored, [site]: MAX_PLIES }
    }
    await store.saveProgress(progress)
    return {
      added: added.length,
      // Older games fetched again and stored with more moves, and how many moves games now keep.
      lengthened,
      movesKept: MAX_PLIES / 2,
      // One site could not be reached; the other's games are in.
      problem,
      counted: judged.filter((g) => g.verdict.type === 'counted').length,
      completed: events.length,
      adviceStarted: advice.filter((e) => e.type === 'advice_started').length,
      total: games.length,
      lastSync: progress.lastSync,
    }
  })
}
