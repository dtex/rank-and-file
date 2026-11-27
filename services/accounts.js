// Users, the ways they sign in, sessions, emailed links and consent records.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { withTx } from './db.js'

/** Version of the terms and privacy policy, and of the consent wording below. Bump when either changes. */
export const POLICY_VERSION = '2026-11-26'
export const CONSENT_TEXT = {
  age: 'I am 16 or older.',
  terms: 'I accept the Terms of Use and have read the Privacy Policy.',
  marketing: 'Send me news and tips about Rank and File by email. This is optional and you can change it at any time in Settings.',
}

export const SESSION_DAYS = 30
export const LINK_MINUTES = 15
/** Emailed links one address may request within LINK_MINUTES. */
const LINKS_PER_WINDOW = 3

const sha = (s) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
export const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase()
export const isEmail = (s) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export function createAccounts(pool, { secret }) {
  const sign = (text) => createHmac('sha256', secret).update(text).digest('base64url')

  return {
    /**
     * The user for a proven identity, created on first sign-in. An identity seen
     * before always wins; otherwise a verified email joins the account that already has it.
     */
    async signIn({ provider, subject, email }) {
      email = normalizeEmail(email)
      return withTx(pool, async (db) => {
        const known = await db.query('select user_id from identities where provider = $1 and subject = $2', [provider, subject])
        if (known.rows[0]) return known.rows[0].user_id
        const byEmail = await db.query('select id from users where email = $1', [email])
        const userId = byEmail.rows[0]?.id ?? (await db.query('insert into users (email) values ($1) returning id', [email])).rows[0].id
        await db.query('insert into identities (provider, subject, user_id) values ($1, $2, $3)', [provider, subject, userId])
        return userId
      })
    },

    async createSession(userId) {
      const id = newToken()
      await pool.query(`insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + $3 * interval '1 day')`, [sha(id), userId, SESSION_DAYS])
      return id
    },

    /** The signed-in user for a session cookie, or null. Extends the session about once a day. */
    async sessionUser(id) {
      if (!id) return null
      const { rows } = await pool.query(
        `select u.*, s.last_seen_at from sessions s join users u on u.id = s.user_id where s.id_hash = $1 and s.expires_at > now()`,
        [sha(id)],
      )
      const user = rows[0]
      if (!user) return null
      if (Date.now() - new Date(user.last_seen_at).getTime() > 86_400_000) {
        await pool.query(`update sessions set last_seen_at = now(), expires_at = now() + $2 * interval '1 day' where id_hash = $1`, [sha(id), SESSION_DAYS])
      }
      return user
    },

    async endSession(id) {
      if (id) await pool.query('delete from sessions where id_hash = $1', [sha(id)])
    },

    /** A single-use token to email, or null when this address has asked too often. */
    async createLink(email, { purpose = 'login', userId = null } = {}) {
      email = normalizeEmail(email)
      const recent = await pool.query(`select count(*)::int as n from login_tokens where email = $1 and created_at > now() - $2 * interval '1 minute'`, [email, LINK_MINUTES])
      if (recent.rows[0].n >= LINKS_PER_WINDOW) return null
      const token = newToken()
      await pool.query(
        `insert into login_tokens (token_hash, email, purpose, user_id, expires_at) values ($1, $2, $3, $4, now() + $5 * interval '1 minute')`,
        [sha(token), email, purpose, userId, LINK_MINUTES],
      )
      return token
    },

    /** Use up an emailed token. Returns { email, purpose, userId } or null if it is unknown, used or expired. */
    async consumeLink(token) {
      const { rows } = await pool.query(
        `update login_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning email, purpose, user_id`,
        [sha(String(token ?? ''))],
      )
      return rows[0] ? { email: rows[0].email, purpose: rows[0].purpose, userId: rows[0].user_id } : null
    },

    /** Move an account to a confirmed new address. False when another account already has it. */
    async changeEmail(userId, email) {
      email = normalizeEmail(email)
      return withTx(pool, async (db) => {
        const taken = await db.query('select 1 from users where email = $1 and id <> $2', [email, userId])
        if (taken.rowCount) return false
        await db.query('update users set email = $2 where id = $1', [userId, email])
        await db.query(`delete from identities where user_id = $1 and provider = 'email'`, [userId])
        await db.query(`insert into identities (provider, subject, user_id) values ('email', $2, $1) on conflict do nothing`, [userId, email])
        return true
      })
    },

    async emailInUse(email) {
      return (await pool.query('select 1 from users where email = $1', [normalizeEmail(email)])).rowCount > 0
    },

    async methods(userId) {
      const { rows } = await pool.query('select provider from identities where user_id = $1 order by created_at', [userId])
      return rows.map((r) => r.provider)
    },

    /** The consent step at first sign-in. Age and terms are required; marketing is the user's choice. */
    async acceptTerms(userId, { marketing }) {
      await withTx(pool, async (db) => {
        await db.query(
          `update users set accepted_terms_at = now(), terms_version = $2, age_confirmed_at = now(), marketing_opt_in = $3 where id = $1`,
          [userId, POLICY_VERSION, !!marketing],
        )
        for (const [kind, granted] of [['age', true], ['terms', true], ['marketing', !!marketing]]) {
          await db.query(`insert into consents (user_id, kind, granted, version, source) values ($1, $2, $3, $4, 'signup')`, [userId, kind, granted, POLICY_VERSION])
        }
      })
    },

    /** Turn marketing email on or off, keeping a record of when and how. */
    async setMarketing(userId, on, source) {
      await withTx(pool, async (db) => {
        const res = await db.query('update users set marketing_opt_in = $2 where id = $1 and marketing_opt_in <> $2', [userId, !!on])
        if (res.rowCount) {
          await db.query(`insert into consents (user_id, kind, granted, version, source) values ($1, 'marketing', $2, $3, $4)`, [userId, !!on, POLICY_VERSION, source])
        }
      })
    },

    /** A token for the unsubscribe link in marketing email. It needs no sign-in and never expires. */
    unsubscribeToken(userId) {
      return `${userId}.${sign(`unsubscribe:${userId}`)}`
    },
    readUnsubscribeToken(token) {
      const [userId, mac] = String(token ?? '').split('.')
      if (!/^[0-9a-f-]{36}$/.test(userId || '') || !mac) return null
      const want = Buffer.from(sign(`unsubscribe:${userId}`))
      const got = Buffer.from(mac)
      return want.length === got.length && timingSafeEqual(want, got) ? userId : null
    },

    /** Everything held about a user, for "Download my data". */
    async exportData(userId) {
      const one = async (sql) => (await pool.query(sql, [userId])).rows
      const [user] = await one('select email, created_at, accepted_terms_at, terms_version, age_confirmed_at, marketing_opt_in from users where id = $1')
      const [progress] = await one('select data from progress where user_id = $1')
      return {
        exportedAt: new Date().toISOString(),
        account: user,
        signInMethods: await one('select provider, created_at from identities where user_id = $1 order by created_at'),
        consents: await one('select kind, granted, version, source, at from consents where user_id = $1 order by at, id'),
        sessions: await one('select created_at, last_seen_at, expires_at from sessions where user_id = $1 order by created_at'),
        gifts: await one('select days, note, created_at, redeemed_at, expires_at, revoked_at from gifts where redeemed_by = $1 order by created_at'),
        progress: progress?.data ?? null,
        games: (await one('select data, verdict from games where user_id = $1 order by ended_at, uuid')).map((r) => ({ ...r.data, verdict: r.verdict })),
      }
    },

    /** Remove the user and, through cascades, every row that belongs to them. */
    async deleteAccount(userId) {
      await withTx(pool, async (db) => {
        const { rows } = await db.query('select email from users where id = $1', [userId])
        if (rows[0]?.email) {
          await db.query('delete from login_tokens where email = $1', [rows[0].email])
          await db.query('delete from gifts where email = $1', [rows[0].email])
        }
        await db.query('delete from users where id = $1', [userId])
      })
    },

    /**
     * Housekeeping: drop expired sessions and links, and accounts that signed in
     * but never accepted the terms within a day (so their address is not kept).
     */
    async cleanup() {
      const sessions = await pool.query('delete from sessions where expires_at < now()')
      const links = await pool.query(`delete from login_tokens where expires_at < now() - interval '1 day'`)
      const users = await pool.query(
        `delete from users u where u.email is not null and u.accepted_terms_at is null and u.created_at < now() - interval '1 day'
           and not exists (select 1 from progress p where p.user_id = u.id)`,
      )
      return { sessions: sessions.rowCount, links: links.rowCount, users: users.rowCount }
    },
  }
}
