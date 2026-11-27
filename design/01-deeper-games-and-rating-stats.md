# Deeper games and results by opponent rating

Phases 1 and 2 of the middlegame work. Written 2026-11-26.

## Why

Players tell us the same story. Their rating rises quickly at first, then stalls. Stronger opponents know
the opening, and the game is decided around moves 10 to 20.

The app can't see that part of the game:

- Openings in [data/tree.json](../data/tree.json) are 1 to 8 plies deep, and their ideas are checked up to
  move 15 at the latest.
- Games are trimmed to `MAX_PLIES = 30` (move 15) when they are fetched
  ([services/chesscom.js](../services/chesscom.js), also imported by [services/lichess.js](../services/lichess.js)).
  Nothing after move 15 is stored.
- Each stored game keeps both players' ratings, but nothing looks at results by opponent strength.

Phase 1 stores more of each game, which the later work (critical replies, middlegame plans, find-the-move)
depends on. Phase 2 shows each player how their results in an opening change against stronger opponents. It
needs no new data, and it shows where the later work matters most.

The two phases are independent and can ship in either order or together.

---

## Phase 1: Store the first 30 moves

### The change

Raise `MAX_PLIES` from 30 to 60 in [services/chesscom.js](../services/chesscom.js). Everything that reads
the constant follows:

- `parseMoves` (chess.com) and `trimGame` (Lichess) keep up to 60 plies.
- `compileCheck` in [services/checks.js](../services/checks.js) allows `by` and `within` up to 30 instead of
  15. Existing checks stay valid.

### Backfilling games already stored

A game stored before the change keeps its 30 plies unless we fetch it again. Today nothing fetches it again:

- `insertGames` in [services/store.js](../services/store.js) does `on conflict do nothing`.
- `pullChesscom` only re-checks the two newest months. Older months it already has are skipped.
- `pullLichess` only asks for games since the newest one stored.

**Upsert that only lengthens.** `insertGames` becomes:

```sql
insert into games (user_id, uuid, ended_at, data, verdict) values ($1, $2, $3, $4, $5)
on conflict (user_id, uuid) do update set data = excluded.data
  where jsonb_array_length(games.data->'moves') < jsonb_array_length(excluded.data->'moves')
returning (xmax = 0) as inserted
```

- The verdict is never touched on update. Verdicts depend only on reaching an opening, which happens by ply
  8, so they are still right.
- `rowCount` is 1 for an update as well as an insert, so use the returned `inserted` column to decide what
  goes in `added`. Return the number of lengthened games separately as `lengthened`.

**A per-site marker in progress.** Add `movesStored: { chesscom, lichess }` to the progress document:

- `newProgress` sets both to `MAX_PLIES`, so new users never backfill.
- In older progress the field is missing, which means 30 for both sites.
- A site backfills on its next sync when its value is below `MAX_PLIES`.
- The value is set to `MAX_PLIES` only after that site's pull succeeds. A failed pull tries again next sync,
  and one site failing doesn't make the other fetch everything twice.

**What a backfill fetches:**

- **chess.com:** every month in the archive list, with no etag, so nothing comes back as 304. Each month's
  row in `archive_months` gets the new etag. A player with five years of games makes about 60 requests.
- **Lichess:** first `fetchGames(username, { max: FIRST_IMPORT })` (the newest 1,000 games), then the usual
  two incremental requests. Lichess games older than the newest 1,000 keep 30 plies. Fetching all of them
  could hold the shared Lichess queue (`inTurn`) for several minutes and stall every other user's sync. Old
  games matter least for the work that depends on this.

**Wiring.**

- `runSync` in [services/engine.js](../services/engine.js) already reads progress (`before`) before pulling.
  It passes `before.movesStored ?? {}` to `pullGames`.
- `pullGames` in [services/sync.js](../services/sync.js) passes `backfill: true` to a site's pull when that
  site needs it. It also returns `answered`, the sites that succeeded, alongside `added` and `problem`.
- Inside the lock, `runSync` sets `progress.movesStored[site] = MAX_PLIES` for each site in `answered`,
  before it saves.

### Effects to know about

- **Some accuracy scores change once, retroactively.** An idea whose window ran past ply 30 used to come out
  `na` ("the game ended too soon to judge") and can now be judged. Accuracy shown on opening pages and in the
  game log may shift for older games. Advice missions don't replay: `progress.advice.checkedTo` already
  covers those games.
- **Old and new games are mixed.** Games still at 30 plies (old Lichess games) look the same as games that
  really ended at move 15. Checks already return `na` when the game is shorter than their window, so a
  shortened game never counts as a failure. Code added later must keep that rule. Don't treat "fewer than 60
  plies" as "the game ended".
- **Size.** About 150 to 300 more bytes per game in `games.data`. `loadAllGames` reads every game on every
  request, which is fine at today's sizes but worth watching. The position-key cache in
  [services/matcher.js](../services/matcher.js) already rebuilds when `moves.length` changes.
- **The first sync after deploy is slow.** A chess.com backfill takes seconds to a minute. A Lichess
  backfill takes about a minute per user, and other users' Lichess syncs queue behind it. Deploy at a quiet
  hour.

### Tests

- [test/chesscom.test.js](../test/chesscom.test.js) and [test/lichess.test.js](../test/lichess.test.js):
  games are trimmed to 60 plies, and shorter games are kept whole.
- [test/store.test.js](../test/store.test.js):
  - a longer copy replaces a shorter one;
  - a shorter or equal copy changes nothing;
  - the verdict survives;
  - `added` holds only new games.
- A sync test with stubbed fetches:
  - a backfill fetches every chess.com month without etags and runs once;
  - a failed site keeps its marker below `MAX_PLIES` and the other site's marker moves on;
  - new progress never backfills.
- [test/advice.test.js](../test/advice.test.js): a check with `by: 20` compiles and is judged on a 40-ply
  game.

---

## Phase 2: Results by opponent rating

### What the player sees

On each opening's page, next to "Your record here", a small table:

| Opponents | Games | Won | Drawn | Lost | Score |
| --- | --- | --- | --- | --- | --- |
| Weaker (100+ below you) | 14 | 10 | 1 | 3 | 75% |
| About your level | 22 | 11 | 2 | 9 | 55% |
| Stronger (100+ above you) | 9 | 2 | 0 | 7 | 22% |

Below the table, a single line when there are enough games: "Your last 20 games here scored 41%, down from
58% in the 20 before."

In the outline on the Openings screen, an opening gets a short marker when the player is struggling there
against stronger opponents. The outline is in [public/src/openings.js](../public/src/openings.js). The map
tiles are already busy, so they don't get the marker.

### Definitions

- **Band:** the opponent's rating minus the player's own rating, both as recorded on that game. That's below
  -100 for weaker, -100 to +100 for about your level, and above +100 for stronger. The two sites' ratings
  differ in scale, but both numbers come from the same site, so the difference is fair. `BAND = 100` is a
  constant.
- **Score:** (wins + half the draws) / games, as a whole percentage. Results come from `userResult` in
  [services/matcher.js](../services/matcher.js).
- **Which games count:** games eligible under the player's settings (`ineligibleReason`), played with the
  opening's colour, that reached the opening. That's the set "Your record here" already uses (`sideGames`
  and `reached` in [services/views.js](../services/views.js)). Games without a rating for either side, such as
  Lichess games against the computer, are left out of the bands but still count in the record.
- **Trend:** shown when at least `TREND_WINDOW = 20` games come after the earlier window, comparing the
  newest 20 with the 20 before. If there are fewer, no line is shown.
- **Struggling:** at least `STRUGGLE_MIN_GAMES = 8` games against stronger opponents, scoring below
  `STRUGGLE_SCORE = 35`%. These are starting values. Phase 3 can use the same rule to decide which opening to
  work on first.

### Code

- **New [services/stats.js](../services/stats.js), pure functions:**
  - `ratingBands(node, games, settings)` returns `{ weaker, even, stronger }`, each
    `{ games, win, draw, loss, score }`, with `score` null when there are no games.
  - `scoreTrend(node, games, settings)` returns `{ recent, before }` or null.
  - `struggling(bands)` returns a boolean.
- **[services/views.js](../services/views.js):**
  - `openingView` adds `stats.byRating` and `stats.trend`.
  - `stateView` adds `struggling` to each opening in `nodes`. It already has the games.
- **[public/src/opening.js](../public/src/opening.js), [public/src/openings.js](../public/src/openings.js) and
  [public/app.css](../public/app.css):** the table and the trend line on the opening's page, styled like the
  existing record table, and the marker in the outline.

### Tests

New `test/stats.test.js`, building games the way [test/advice.test.js](../test/advice.test.js) does:

- band edges at exactly -100, +100 and 101;
- draws count as half;
- games without ratings are skipped;
- ineligible games and games with the other colour are left out;
- no trend line below 40 games;
- the struggling threshold.

---

## Rollout

1. Phase 2 can ship as soon as it's ready. It reads data that is already stored.
2. Phase 1: deploy, then watch the first syncs. Check sync time, Lichess queue wait, and the size of the
   `games` table before and after.
3. Update the README sections "Advice accuracy" (the move limit) and "chess.com and Lichess" (the one-time
   backfill). If a figure appears on `/features`, it's read from the code and needs no change.

## Open decisions

- **Free or member.** My suggestion is free for everyone. It's a view of data the player already has, and
  it shows them why the paid work is worth having.
- **Bands relative to the player or by fixed rating.** Relative bands, as above, keep meaning the same thing
  as the player climbs. Fixed buckets such as "1200 to 1400" are easier to read but drift.

## Not in this work

Critical replies, middlegame plans and find-the-move. The first two are in
[02-critical-replies-and-plans.md](02-critical-replies-and-plans.md).
