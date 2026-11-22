// Postgres connection and migrations. The database always runs on this machine.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations')
export const DEFAULT_DATABASE_URL = 'postgres://localhost/rank_and_file'

// bigint columns hold unix seconds, which fit a JS number.
pg.types.setTypeParser(20, Number)

export function createPool(url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString: url, max: 10 })
}

/** Create the database named in `url` if it does not exist yet. */
export async function ensureDatabase(url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL) {
  const target = new URL(url)
  const name = decodeURIComponent(target.pathname.slice(1))
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsupported database name "${name}"`)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const client = new pg.Client({ connectionString: admin.href })
  await client.connect()
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name])
    if (!rowCount) await client.query(`create database ${name}`)
    return !rowCount
  } finally {
    await client.end()
  }
}

/** Apply every migration file that has not run yet, in name order. Returns the names applied. */
export async function migrate(pool, dir = MIGRATIONS_DIR) {
  const client = await pool.connect()
  const applied = []
  try {
    // One migrator at a time, even if two processes start together.
    await client.query('select pg_advisory_lock(727274)')
    await client.query('create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await client.query('select name from migrations')).rows.map((r) => r.name))
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue
      await client.query('begin')
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'))
        await client.query('insert into migrations (name) values ($1)', [file])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${file} failed: ${err.message}`)
      }
      applied.push(file)
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {})
    client.release()
  }
  return applied
}

/** Run `fn` inside a transaction on one connection. */
export async function withTx(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
