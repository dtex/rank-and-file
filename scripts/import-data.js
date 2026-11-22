// One-off: load the old JSON files (data/progress.json and data/games/) into Postgres.
//   node scripts/import-data.js [dir]
// The data goes to the oldest user, which is created if there is none.
import fs from 'node:fs'
import path from 'node:path'
import { createPool, ensureDatabase, migrate } from '../services/db.js'
import { createStore } from '../services/store.js'

const dir = path.resolve(process.argv[2] || 'data')
const read = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)

const progress = read(path.join(dir, 'progress.json'), null)
if (!progress) {
  console.error(`No progress.json in ${dir}. Nothing to import.`)
  process.exit(1)
}
const meta = read(path.join(dir, 'games', '_meta.json'), { etags: {} })
const months = fs.readdirSync(path.join(dir, 'games')).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort()

await ensureDatabase()
const pool = createPool()
try {
  await migrate(pool)
  const found = await pool.query('select id from users order by created_at limit 1')
  const userId = found.rows[0]?.id ?? (await pool.query('insert into users default values returning id')).rows[0].id
  const store = createStore(pool).forUser(userId)
  if ((await store.loadAllGames()).length) {
    console.error('That user already has games in the database. Nothing was imported.')
    process.exit(1)
  }
  let total = 0
  for (const month of months) {
    const games = read(path.join(dir, 'games', `${month}.json`), [])
    total += (await store.saveMonth(month, games, meta.etags?.[month] ?? null)).length
  }
  await store.saveProgress(progress)
  console.log(`Imported ${total} games from ${months.length} months and ${Object.keys(progress.missions).length} missions for ${progress.settings.username}.`)
} finally {
  await pool.end()
}
