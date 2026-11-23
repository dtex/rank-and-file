// The sites games are read from. A user may follow an account on either or both,
// and games from both feed the same missions.
export const SITES = {
  chesscom: { name: 'chess.com' },
  lichess: { name: 'Lichess' },
}
export const SITE_IDS = Object.keys(SITES)

/** Both sites named in a sentence: "chess.com and Lichess". */
export const SITE_NAMES = SITE_IDS.map((id) => SITES[id].name).join(' and ')

/** Games stored before Lichess was supported carry no site; they are all from chess.com. */
export const gameSite = (game) => game.site ?? 'chesscom'

/** { chesscom, lichess } with '' for a site the user has not given. Reads the older single `username` as chess.com. */
export function usernamesOf(settings = {}) {
  const given = settings.usernames ?? { chesscom: settings.username }
  return Object.fromEntries(SITE_IDS.map((id) => [id, String(given[id] ?? '').trim()]))
}

export const hasUsername = (settings) => Object.values(usernamesOf(settings)).some(Boolean)

/** The accounts being followed, for showing: "donovan on chess.com, dbuck on Lichess". */
export const describeAccounts = (settings) =>
  Object.entries(usernamesOf(settings)).filter(([, name]) => name).map(([id, name]) => `${name} on ${SITES[id].name}`).join(', ')
