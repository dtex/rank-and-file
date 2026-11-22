// Ties the pieces together: load state, sync, and keep missions moving.
import { pullGames } from './sync.js'
import { loadTree } from './tree.js'
import { fillSlots, processGames } from './missions.js'
import { updateAdviceMissions } from './advice.js'
import { withLock } from './store.js'

let tree = null
export function getTree() {
  return (tree ??= loadTree())
}

const now = () => Math.floor(Date.now() / 1000)

/** Run `fn` with nothing else reading or changing this user's progress meanwhile. */
export const locked = (store, fn) => withLock(store.userId, fn)

/** Progress with both mission slots filled where possible. Saves if anything changed. */
export async function loadState({ store }) {
  const progress = await store.loadProgress()
  if (!progress.settings.username) {
    throw Object.assign(new Error('Add your chess.com username first.'), { statusCode: 409, needsUsername: true })
  }
  if (fillSlots(getTree(), progress, now()).length) await store.saveProgress(progress)
  return { tree: getTree(), progress, games: await store.loadAllGames() }
}

export async function runSync({ store, fetchImpl }) {
  // Missions must exist before new games are judged.
  const { progress: before } = await locked(store, () => loadState({ store }))
  // The slow part, talking to chess.com, runs without holding the lock.
  const added = await pullGames({ store, username: before.settings.username, fetchImpl })

  return locked(store, async () => {
    // Read again: a mission may have been switched while the games were downloading.
    const { progress, games } = await loadState({ store })
    const { judged, events } = processGames(getTree(), progress, games)
    await store.saveVerdicts(judged)
    // After the verdicts, so an opening uncovered in this sync is already known.
    const advice = updateAdviceMissions(getTree(), progress, games)
    progress.lastSync = now()
    await store.saveProgress(progress)
    return {
      added: added.length,
      counted: judged.filter((g) => g.verdict.type === 'counted').length,
      completed: events.length,
      adviceStarted: advice.filter((e) => e.type === 'advice_started').length,
      total: games.length,
      lastSync: progress.lastSync,
    }
  })
}
