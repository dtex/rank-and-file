// Tests that touch storage run against a real local database, rank_and_file_test,
// created and migrated on first use. Each test works on its own new user, so
// nothing needs wiping between tests.
import pg from 'pg'
import { ensureDatabase, migrate } from '../../services/db.js'
import { createStore } from '../../services/store.js'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost/rank_and_file_test'

let ready = null
export function testPool() {
  ready ??= (async () => {
    await ensureDatabase(TEST_DATABASE_URL)
    // Idle connections must not keep the test process alive.
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, allowExitOnIdle: true })
    await migrate(pool)
    await setEarlyPlaces(pool, 100)
    return pool
  })()
  return ready
}

/**
 * Set how many early-adopter places are taken by nobody in particular. Tests start with all 100
 * gone, so prices are the full ones; a test that frees some puts them back when it is done.
 */
export async function setEarlyPlaces(pool, taken) {
  await pool.query('delete from early_adopters')
  await pool.query('insert into early_adopters (user_id) select null from generate_series(1, $1)', [taken])
}

export async function newUser(pool) {
  return (await pool.query('insert into users default values returning id')).rows[0].id
}

/** A store bound to a brand-new user. */
export async function testStore() {
  const pool = await testPool()
  const userId = await newUser(pool)
  return { pool, userId, store: createStore(pool).forUser(userId) }
}
