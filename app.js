import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { createStore } from './services/store.js'
import syncRoutes from './routes/sync.js'
import settingsRoutes from './routes/settings.js'
import missionRoutes from './routes/missions.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

/** The one account this install serves until sign-in exists: the oldest user, created on first use. */
async function localUserId(pool) {
  const found = await pool.query('select id from users order by created_at limit 1')
  if (found.rows[0]) return found.rows[0].id
  return (await pool.query('insert into users default values returning id')).rows[0].id
}

export function buildApp({ pool, fetchImpl = fetch, logger = true } = {}) {
  const app = Fastify({ logger })
  const store = createStore(pool)
  app.decorate('ctx', { pool, store, fetchImpl })
  app.decorateRequest('cb', null)

  app.register(fastifyStatic, { root: path.join(ROOT, 'public') })

  // Everything under /api works on one user's data.
  app.register(async (api) => {
    let userId = null
    api.addHook('preHandler', async (req) => {
      userId ??= await localUserId(pool)
      req.cb = { store: store.forUser(userId), fetchImpl }
    })
    api.register(syncRoutes)
    api.register(settingsRoutes)
    api.register(missionRoutes)
  })
  return app
}
