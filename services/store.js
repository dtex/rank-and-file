// JSON-file storage. Everything the app remembers lives under data/ so a git
// commit is the backup.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULT_SETTINGS = {
  username: 'dtexus',
  timeClasses: ['blitz', 'rapid', 'daily'],
  ratedOnly: true,
  adviceThreshold: 70,
}

export function createStore(dir = process.env.CB_DATA_DIR || path.join(ROOT, 'data')) {
  const gamesDir = path.join(dir, 'games')
  fs.mkdirSync(gamesDir, { recursive: true })

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      if (err.code === 'ENOENT') return fallback
      throw new Error(`Could not read ${file}: ${err.message}`)
    }
  }

  function writeJson(file, value, { compactRows = false } = {}) {
    // Month files keep one game per line so git diffs stay readable.
    const body = compactRows && Array.isArray(value)
      ? '[\n' + value.map((v) => JSON.stringify(v)).join(',\n') + '\n]\n'
      : JSON.stringify(value, null, 2) + '\n'
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, file)
  }

  const progressFile = path.join(dir, 'progress.json')
  const metaFile = path.join(gamesDir, '_meta.json')
  const monthFile = (key) => path.join(gamesDir, `${key}.json`)

  return {
    dir,
    loadProgress() {
      const p = readJson(progressFile, null)
      if (p) return p
      return {
        version: 1,
        createdAt: Math.floor(Date.now() / 1000),
        settings: structuredClone(DEFAULT_SETTINGS),
        missions: {},
        slots: { w: null, b: null },
        events: [],
        lastSync: null,
      }
    },
    saveProgress(p) {
      writeJson(progressFile, p)
    },
    loadMeta() {
      return readJson(metaFile, { etags: {} })
    },
    saveMeta(meta) {
      writeJson(metaFile, meta)
    },
    listMonths() {
      return fs
        .readdirSync(gamesDir)
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
        .map((f) => f.slice(0, 7))
        .sort()
    },
    loadMonth(key) {
      return readJson(monthFile(key), [])
    },
    saveMonth(key, games) {
      games.sort((a, b) => a.end - b.end)
      writeJson(monthFile(key), games, { compactRows: true })
    },
    /** Delete every stored game and all progress. Used when the username changes. */
    reset() {
      for (const key of this.listMonths()) fs.rmSync(monthFile(key))
      fs.rmSync(metaFile, { force: true })
      fs.rmSync(progressFile, { force: true })
    },
    /** Every stored game, oldest first. */
    loadAllGames() {
      const all = []
      for (const key of this.listMonths()) all.push(...this.loadMonth(key))
      return all.sort((a, b) => a.end - b.end)
    },
    /** Write back a set of changed games, grouped into their month files. */
    saveGames(games) {
      const byMonth = new Map()
      for (const g of games) {
        const key = monthKey(g.end)
        if (!byMonth.has(key)) byMonth.set(key, [])
        byMonth.get(key).push(g)
      }
      for (const [key, changed] of byMonth) {
        const existing = new Map(this.loadMonth(key).map((g) => [g.uuid, g]))
        for (const g of changed) existing.set(g.uuid, g)
        this.saveMonth(key, [...existing.values()])
      }
    },
  }
}

export function monthKey(unixSeconds) {
  const d = new Date(unixSeconds * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
