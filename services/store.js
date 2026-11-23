// Postgres storage. Everything a user's missions depend on is reached through
// a store bound to that user, so one user's request can never touch another's rows.
import { withTx } from './db.js'
import { usernamesOf } from './sites.js'

export const DEFAULT_SETTINGS = {
  // The accounts to follow, one per site. Both empty until the user has told us; one is enough.
  usernames: { chesscom: '', lichess: '' },
  timeClasses: ['blitz', 'rapid', 'daily'],
  ratedOnly: true,
  adviceThreshold: 70,
}

export function newProgress(now = Math.floor(Date.now() / 1000)) {
  return {
    version: 1,
    createdAt: now,
    settings: structuredClone(DEFAULT_SETTINGS),
    missions: {},
    slots: { w: null, b: null },
    events: [],
    lastSync: null,
  }
}

/** Progress saved before Lichess was supported has a single `username`, which was the chess.com one. */
function upToDate(progress) {
  const { username, ...settings } = progress.settings ?? {}
  progress.settings = { ...settings, usernames: usernamesOf(progress.settings) }
  return progress
}

/** Insert games that are not stored yet, inside a transaction. Returns the ones that were new. */
async function insertGames(db, userId, games) {
  const added = []
  for (const g of games) {
    const { verdict = null, ...data } = g
    const res = await db.query(
      `insert into games (user_id, uuid, ended_at, data, verdict) values ($1, $2, $3, $4, $5)
       on conflict (user_id, uuid) do nothing`,
      [userId, g.uuid, g.end, JSON.stringify(data), verdict && JSON.stringify(verdict)],
    )
    if (res.rowCount) added.push(g)
  }
  return added
}

const toGame = (row) => (row.verdict ? { ...row.data, verdict: row.verdict } : row.data)

export function createStore(pool) {
  return {
    pool,
    /** The storage of one user. */
    forUser(userId) {
      return {
        userId,
        async loadProgress() {
          const { rows } = await pool.query('select data from progress where user_id = $1', [userId])
          return rows[0] ? upToDate(rows[0].data) : newProgress()
        },
        async saveProgress(p) {
          await pool.query(
            `insert into progress (user_id, data) values ($1, $2)
             on conflict (user_id) do update set data = excluded.data, updated_at = now()`,
            [userId, JSON.stringify(p)],
          )
        },
        /** chess.com months already fetched, as { '2026-11': etag | null }. */
        async loadMonths() {
          const { rows } = await pool.query('select month, etag from archive_months where user_id = $1', [userId])
          return Object.fromEntries(rows.map((r) => [r.month, r.etag]))
        },
        /** Record a fetched month. Returns the games that were not stored before. */
        async saveMonth(month, games, etag = null) {
          return withTx(pool, async (db) => {
            const added = await insertGames(db, userId, games)
            await db.query(
              `insert into archive_months (user_id, month, etag) values ($1, $2, $3)
               on conflict (user_id, month) do update set etag = coalesce(excluded.etag, archive_months.etag)`,
              [userId, month, etag],
            )
            return added
          })
        },
        /** Store games from a site that is not fetched by month. Returns the ones that were not stored before. */
        async saveGames(games) {
          if (!games.length) return []
          return withTx(pool, (db) => insertGames(db, userId, games))
        },
        /** When the newest stored game from `site` started, in unix seconds, or null with none stored. */
        async latestStart(site) {
          const { rows } = await pool.query(
            `select max((data->>'start')::bigint) as start from games where user_id = $1 and data->>'site' = $2`,
            [userId, site],
          )
          return rows[0].start === null ? null : Number(rows[0].start)
        },
        /** Every stored game, oldest first. */
        async loadAllGames() {
          const { rows } = await pool.query('select data, verdict from games where user_id = $1 order by ended_at, uuid', [userId])
          return rows.map(toGame)
        },
        /** Write back the verdicts of games that have just been judged. */
        async saveVerdicts(games) {
          if (!games.length) return
          await withTx(pool, async (db) => {
            for (const g of games) {
              await db.query('update games set verdict = $3 where user_id = $1 and uuid = $2', [userId, g.uuid, JSON.stringify(g.verdict)])
            }
          })
        },
        /** Delete every stored game and all progress. Used when a username changes. */
        async reset() {
          await withTx(pool, async (db) => {
            await db.query('delete from games where user_id = $1', [userId])
            await db.query('delete from archive_months where user_id = $1', [userId])
            await db.query('delete from progress where user_id = $1', [userId])
          })
        },
      }
    },
  }
}

export function monthKey(unixSeconds) {
  const d = new Date(unixSeconds * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Serialise work per key, so two requests from one user cannot interleave their read-change-write. */
const chains = new Map()
export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => {})
  chains.set(key, tail)
  tail.then(() => chains.get(key) === tail && chains.delete(key))
  return run
}
