// The openings editor: a small site for this machine only that reads and rewrites
// data/tree.json. It is not part of the app; nothing in app.js or start.js loads it.
// Run it with "npm run openings".
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Chess } from 'chess.js'
import { TREE_FILE, positionKey, targetFor } from '../../services/tree.js'
import { EditError, KNOWN, addOpening, deleteOpening, newId, readTree, updateOpening, validate, writeTree } from './tree-file.js'
import { RECENT_DAYS, Sample } from './sample.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'

/** One opening as the page needs it: what is stored, what the app works out from it, and how often it is reached. */
function view(node, raw, sample) {
  const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !KNOWN.includes(k)))
  return {
    id: raw.id,
    parent: raw.parent,
    name: raw.name,
    aliases: raw.aliases ?? [],
    side: raw.side,
    moves: raw.moves,
    eco: raw.eco ?? '',
    target: raw.target ?? null,
    blurb: raw.blurb ?? '',
    history: raw.history ?? '',
    ideas: raw.ideas ?? [],
    checks: raw.checks ?? (raw.ideas ?? []).map(() => null),
    extra,
    depth: node.depth,
    defaultTarget: targetFor(node.depth),
    fen: node.fen,
    children: node.children.length,
    reach: sample.reach(node.key),
  }
}

export function buildServer({ file = TREE_FILE, sample = new Sample(), port = 3211 } = {}) {
  const app = Fastify()
  app.register(fastifyStatic, { root: path.join(HERE, 'public') })

  // The editor changes files, so it answers only its own page: not another site open in the
  // same browser, and not a name that has been pointed at this machine.
  const allowed = new Set([`localhost:${port}`, `${HOST}:${port}`])
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (!allowed.has(req.headers.host) || (origin && !allowed.has(origin.replace(/^https?:\/\//, '')))) {
      return reply.code(403).send({ error: 'The openings editor only answers its own page.' })
    }
  })
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof EditError) return reply.code(400).send({ error: err.message })
    reply.code(err.statusCode ?? 500).send({ error: err.message })
  })

  const state = () => {
    const raw = readTree(file)
    const tree = validate(raw)
    return { openings: raw.map((r) => view(tree.byId.get(r.id), r, sample)), sample: sample.status(), recentDays: RECENT_DAYS, file }
  }
  const save = (next) => {
    writeTree(next, file)
    return state()
  }

  app.get('/api/tree', async () => state())
  app.post('/api/openings', async (req) => {
    const raw = readTree(file)
    const id = newId(raw)
    return { ...save(addOpening(raw, req.body, id)), id }
  })
  app.put('/api/openings/:id', async (req) => save(updateOpening(readTree(file), req.params.id, req.body)))
  app.delete('/api/openings/:id', async (req) => save(deleteOpening(readTree(file), req.params.id)))

  /** The position a line of moves leads to, before it is saved: is it legal, is it already on the map, how often is it reached. */
  app.post('/api/preview', async (req) => {
    const moves = String(req.body?.moves ?? '').trim().split(/\s+/).filter(Boolean)
    const chess = new Chess()
    for (const san of moves) {
      try {
        chess.move(san)
      } catch {
        return { error: `"${san}" is not a legal move here.`, fen: chess.fen() }
      }
    }
    const key = positionKey(chess.fen())
    const same = validate(readTree(file)).nodes.find((n) => n.key === key)
    return { fen: chess.fen(), depth: moves.length, defaultTarget: targetFor(moves.length), sameAs: same ? { id: same.id, name: same.name } : null, reach: sample.reach(key) }
  })

  app.get('/api/sample', async () => sample.status())
  app.post('/api/sample/refresh', async () => {
    sample.refresh().catch(() => {}) // carries on after this answer; the page asks how it is going
    return sample.status()
  })

  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The same .env as the app, for the User-Agent the sites are given.
  try {
    process.loadEnvFile()
  } catch { /* no .env file */ }
  if (process.env.NODE_ENV === 'production') {
    console.error('The openings editor is for your own machine and does not run in production.')
    process.exit(1)
  }
  const port = Number(process.env.OPENINGS_PORT) || 3211
  const sample = new Sample()
  const app = buildServer({ sample, port })
  await app.listen({ port, host: HOST })
  console.log(`\nOpenings editor: http://localhost:${port}\nEditing ${TREE_FILE}\n`)
  if (sample.empty) {
    console.log('No sample of recent games yet. Gathering one from chess.com and Lichess, which can take ten minutes. The editor works meanwhile.\n')
    sample.refresh().then(() => {
      for (const [site, s] of Object.entries(sample.status())) console.log(s.running?.error ? `${s.label}: ${s.running.error}` : `${s.label}: ${s.games} games`)
    })
  }
}
