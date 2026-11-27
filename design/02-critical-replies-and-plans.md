# Critical replies and middlegame plans

Phases 3 and 4 of the middlegame work. Written 2026-11-26. Builds on
[01-deeper-games-and-rating-stats.md](01-deeper-games-and-rating-stats.md): phase 4 needs games stored to move
30, and phase 3 is better with them.

## Why

A player who climbs quickly on an opening's ideas starts meeting opponents who know the opening too. Those
opponents answer with the critical move, or the one sideline that works, and the player is lost by move 15.
The app has two blind spots here:

- **It doesn't look at the opponent's answer.** The opening page lists where games went instead of the
  opening ("elsewhere" in `openingView`, [services/views.js](../services/views.js)). Once a game reaches the
  opening, the app doesn't ask what the opponent played next or how the player did against it.
- **The ideas stop at the opening.** Each opening has about three ideas, checked up to move 15 at the latest.
  Nothing says what to aim for once the pieces are out: which pawn break, where the pieces belong, which
  trade to avoid.

**Phase 3, critical replies:** for each opening, show the player how they score against each reply, and give
them a mission for the reply that beats them.

**Phase 4, middlegame plans:** give each opening a few plans for moves 10 to 30, scored like the ideas, with
a mission when they aren't followed.

Both phases are about **two-thirds chess writing and one-third code**. The code is wasted without the
content, so the content work starts the day this plan is accepted. See "Content" below.

---

## Shared groundwork: missions about more than one kind of thing

Advice missions in [services/advice.js](../services/advice.js) are keyed by opening:
`progress.advice.missions[nodeId]`. Phases 3 and 4 need the same life cycle (start when recent games fall
short, finish when four new games meet the target) for two new kinds of subject:

| Subject | Key | Games scored | Starts when | Done when |
| --- | --- | --- | --- | --- |
| Opening ideas (today) | `italian` | reached the opening | last 4 average below target | 4 new average at or above target |
| Reply | `italian>d5` | reached the opening and met that reply | results against the reply are poor (phase 3) | 4 new games against it average at or above target on its ideas |
| Plans | `italian#plans` | reached the opening, long enough to judge a plan | last 4 plan scores average below target | 4 new average at or above target |

**Refactor before adding either phase.** Move `updateAdviceMissions` to a generic
`updateMissions(kind, subjects, progress, games)`:

- Each kind keeps its own state: `progress.advice` for ideas (unchanged, so existing data stays valid), and
  new `progress.replies` and `progress.plans`.
- The function takes a list of subjects, each with an `id`, a `score(game)` that returns a percentage or
  null, and a `shouldStart(history)` rule.
- The existing `firstRun` behaviour (judge where each subject stands today rather than replaying history)
  carries over for each kind.

**Do the refactor first, as its own change.** The advice tests in
[test/advice.test.js](../test/advice.test.js) must pass unchanged.

**At most one active mission per colour for each new kind.** Advice missions have no cap. A new kind
switched on for an existing player could start several missions at once. When more than one subject
qualifies, start the one with the lowest score. The others can start once it finishes.

**Events and the dialog:**

- New event types: `reply_started`, `reply_done`, `plans_started` and `plans_done`.
- `renderAdviceEvent` in [public/src/app.js](../public/src/app.js) becomes a single renderer that takes its
  heading, explanation and "what slipped" list from the event.
- `runSync` returns `replyStarted` and `plansStarted` next to `adviceStarted`.

**One game, three scores.** `gameAdvice` keeps returning `score` for an opening's ideas exactly as today, so
advice averages don't move. It adds `reply: { key, score, checks }` and `plans: { score, checks }` to each
opening it scores. The game log shows all three, labelled.

---

## Phase 3: Critical replies

### What a reply is

A reply is the opponent's continuation after the opening, up to and including their first move:

- Most openings end on the player's own move, so the reply is a single ply. For the Italian (`1.e4 e5 2.Nf3
  Nc6 3.Bc4`, playing White), the reply is Black's third move.
- The Four Knights (`fourknights`) ends on the opponent's move, so its reply is two plies: the player's move,
  then the opponent's answer, for example `Bb5 Nd4`. The definition covers both cases.

**Finding it in a game:**

1. Take `at`, the ply where the game reached the opening (`gameKeys(game).indexOf(node.key)`, as in
   `gameAdvice`). This handles transpositions.
2. Read plies from `at` until the first one the opponent plays.
3. Join them with spaces, with check marks removed.

A game that ended before the reply has no reply.

**Replies the map already covers.** Many replies lead straight into another opening on the map. After the
Italian, `3...Bc5` is the Giuoco Piano (`giuoco`) and `3...Nf6` is the Two Knights (`twoknights`). The player
reaches what comes next as their own later openings: `giuoco-c3`, `evans` and `knightattack`. Those replies
need no writing of their own:

- **On the opening page:** the reply row says "Studied in a later opening". If that opening is uncovered, it
  links there. If it's still hidden, it doesn't name it, so the fog keeps its secret.
- **In the tree:** the validator rejects a written reply whose position is an opening on the map.

The writing therefore goes where the map stops: the deepest openings, and sidelines the map doesn't follow.

### What the player sees

A new section on the opening page, "How they answer you", in place of or just below the "elsewhere" bars:

| Their reply | Games | Score | Against stronger | |
| --- | --- | --- | --- | --- |
| 3...Nf6 | 31 | 58% | 40% (10) | Studied in a later opening |
| 3...Bc5 | 24 | 63% | 50% (6) | Studied in a later opening |
| 3...Nd4 | 7 | 29% | 0% (3) | **Mission** · 2 of 4 games |
| 3...d6 | 5 | 70% | – | Ideas |

- Replies with written ideas expand to show the ideas, each with "followed N of M", like the opening's own
  ideas.
- Replies with neither writing nor a later opening get a Lichess explorer link at that position. The link is
  built the way `links.lichess` is built today.
- "Against stronger" uses the band from phase 2. It's left blank under 3 games.

### Starting and finishing a reply mission

Look at the latest `REPLY_WINDOW = 12` eligible games that met the reply, from any date. A mission starts when
all of these hold:

- the opening is uncovered and the reply has written ideas;
- at least `REPLY_MIN_GAMES = 6` games;
- a score at or below `REPLY_SCORE_MAX = 40`%;
- at least `REPLY_GAP = 15` points below the player's score in the opening overall. This is what separates
  "this reply beats you" from "you are losing everything at the moment".

It finishes when 4 games against the reply, played after it started, average the advice target (the existing
`adviceThreshold` setting) on the reply's ideas.

The mission starts on **results** but finishes on **ideas**, on purpose. Results against one reply are too
noisy to finish on: four games against stronger players can all be losses even when they were played well.
The ideas are what the player controls.

### Data format

In [data/tree.json](../data/tree.json), an opening gets an optional `replies` list:

```json
"replies": [
  {
    "moves": "Nd4",
    "name": "3...Nd4, the Blackburne Shilling",
    "ideas": [
      "Do not take on e5 with the knight: ...Qg5 hits it and g2 at once.",
      "Take on d4 with the knight, or castle and leave it.",
      "Aim c3 next to send the knight away."
    ],
    "checks": [{ "avoid": "Nxe5", "within": 1 }, { "play": "Nxd4|castle", "within": 1 }, { "play": "c3", "within": 3 }]
  }
]
```

**Rules for replies:**

- `moves` is the reply as defined above. It must be legal from the opening's position and end on the
  opponent's move.
- `ideas` and `checks` work as they do on the opening: one check, or `null`, per idea.
- A reply's checks are judged from the position after the reply: `evaluate(c, { moves, side, at: at +
  reply.plies.length })`, so `within` counts from there. `by` and `when` work as usual.
- `play` without `when` also accepts a move made before the reply, the same as on the opening. That's rarely
  wrong in practice. Writers can use `when` to tie a check to the reply when it matters.

**Validation**, in `buildTree` ([services/tree.js](../services/tree.js)):

- the moves are legal;
- the last ply is the opponent's, and no earlier ply is;
- the reply's position is not an opening on the map;
- no opening has two replies with the same moves;
- the checks compile.

`npm run tree:check` reports how many replies each opening has.

**The openings editor.** [tools/openings/tree-file.js](../tools/openings/tree-file.js):

- add `replies` (and phase 4's `plans`) to `BODY`;
- write each reply on its own line, so diffs stay readable;
- teach the editor page to add, edit and remove replies.

Validation comes free, because the editor already calls `buildTree`.

### Code

- **[services/stats.js](../services/stats.js)** (from phase 2): `replyKey(node, game)`, and
  `replyStats(node, games, settings)` returning `[{ key, label, games, score, stronger, covered, written }]`,
  most-played first.
- **[services/replies.js](../services/replies.js):** the reply subjects for `updateMissions`, and
  `shouldStart` as specified above.
- **[services/advice.js](../services/advice.js):** `gameAdvice` scores the reply's checks when the game met a
  written reply.
- **[services/engine.js](../services/engine.js):** `runSync` calls the reply update after
  `updateAdviceMissions`.
- **[services/views.js](../services/views.js) and [public/src/opening.js](../public/src/opening.js):** the
  "How they answer you" section, the mission line, and replies in the game log.

### Tests

- `replyKey`:
  - one-ply and two-ply replies (Four Knights);
  - transposition into the opening;
  - a game that ends before the reply;
  - check marks removed.
- Tree validation rejects:
  - an illegal reply;
  - a reply that ends on the player's move;
  - a reply onto a mapped opening;
  - two replies with the same moves.
- Mission rules:
  - no start below 6 games;
  - no start when the gap is under 15;
  - no start without written ideas;
  - only one active mission per colour, the lowest score first;
  - finishing on ideas, not results.
- The refactored advice missions: the existing tests pass unchanged.

---

## Phase 4: Middlegame plans

### What a plan is

A short statement of what to aim for after the opening, with a check where one is possible:

- "Prepare d4 with c3, and play it before move 12."
- "Keep the light-squared bishop; do not trade it for a knight."
- "Put a rook on the e-file once the centre opens."

Each opening gets about three. They're shown on the opening page under "After the opening", below the
ideas, with "followed N of M" like the ideas.

### Data format

Kept in the same shape as `ideas`/`checks` (parallel lists, `null` for a plan with no check), so writers and
the editor deal with one pattern:

```json
"plans": ["Prepare d4 with c3 and play it before move 12.", "Keep the light-squared bishop.", "Put a rook on the e-file once it opens."],
"planChecks": [{ "first": "c3", "then": "d4" }, { "avoid": "Bxf6|Bxc6|Bxe6", "by": 20 }, null]
```

The chess in this example and the reply example above only shows the format. It hasn't been reviewed as
content.

Phase 1 lifts the limit on `by` and `within` to move 30, which is what makes plan checks worth writing.

### One new check kind: `on`

Plans are often about where things stand, not which move was played. Add to
[services/checks.js](../services/checks.js):

```
{ on: "Pe5", at: 12 }          your pawn stands on e5 after your 12th move
{ on: "Pd4|Pe5", at: 12 }      either one
{ on: ["Bg2", "Pg3"], at: 10 } all of these (part credit, like setup)
{ on: "!Ke1", at: 10 }         your king is no longer on e1
```

- **Tokens:** a piece letter (`P` for a pawn) and a square, with `|` for alternatives and `!` for not.
- **Position:** after the player's move number `at`. That's the same ply arithmetic as `by`.
- **Short games:** `na` when the game is shorter than that, following the phase 1 rule that a short game is
  never a failure.
- **Validation:** `at` must be after the opening's last ply and no later than move 30.

**No new replay is needed.** The position keys that `gameKeys` in [services/matcher.js](../services/matcher.js)
already caches begin with the board's piece placement. Pass `keys` into `evaluate` and read the square from
`keys[ply + 1]`. Update the format description at the top of `checks.js`.

### Scoring and missions

- Each opening gets a plan score per game: the average of its plan checks that were judged, or null. It's
  kept apart from the ideas score.
- A plan mission (`italian#plans`) starts and finishes like an advice mission, with the same threshold and
  the same 4-game window, and at most one active per colour.
- Plans are **not** folded into the advice average. That would lower every player's averages the day plans
  arrive and start a wave of advice missions.

### Code

- **[services/checks.js](../services/checks.js):** the `on` kind and its tests.
- **[services/tree.js](../services/tree.js):** compile `planChecks` into `node.plans`, the same way `advice`
  is built from `ideas`.
- **[services/advice.js](../services/advice.js):** `gameAdvice` adds the plan score.
- **The plan subjects for `updateMissions`:** in `services/plans.js`, or alongside the advice subjects if
  they stay small.
- **Views:** "After the opening" on the opening page, plan checks in the game log, and the event dialog.

### Tests

- `on`:
  - a single square;
  - alternatives;
  - a list with part credit;
  - negation;
  - `na` on a short game;
  - `at` before the opening rejected.
- Plan scores never change the ideas score of the same game.
- Plan missions: start, finish, and the per-colour cap.

---

## Content

There are 60 openings. A rough count:

- **Replies:** the deepest openings and the common sidelines that aren't on the map. That's about 2 per
  opening that needs them, roughly 80 to 120 entries.
- **Plans:** about 3 for each opening, roughly 180 entries.

**What to write first.** Start with the openings players actually reach, and the replies they actually
meet, at the ratings where they stall. Two sources:

- **The Lichess opening explorer**, filtered to 1000 to 1800 ratings. It needs no user data, so it's the
  better first source.
- **Our own players' games,** added up across everyone: `scripts/reply-report.js` would print, for each
  opening, the most common replies with game counts, player counts and the combined score. It would print
  counts only, no usernames, and leave out any reply met by fewer than 3 players. The privacy policy covers
  this use from version 2026-11-26 ([routes/legal.js](../routes/legal.js)). It makes promises the report has to
  keep:
  - **Totals only.** No username, rating or single game appears in the output, and any move met by fewer than
    3 players is left out.
  - **Opting out.** A player who writes in is left out from then on. Add a migration with
    `users.excluded_from_totals boolean not null default false`, set by hand with a small script such as
    `npm run exclude-from-totals -- <email>` (like `npm run gift`), and have the report skip those users.
    Build this before the report's first run on production.
  - **Telling existing players.** The policy says changes that matter are announced in the app before they
    take effect. The app has no way to show such a notice yet. If anyone signed up under version 2026-11-22,
    show one before the report's first run on production.

**Who writes.** I can draft entries in the tree format from the explorer and the report. A strong player must
review every entry before it ships: a wrong idea taught as advice does real harm. Ship content in batches by
opening, most-reached first. Code for both phases can go live with partial content, because replies and plans
without writing just show the stats and the explorer link.

## Rollout

1. The refactor of advice missions into `updateMissions`, on its own.
2. Phase 3 code, with replies written for the 10 most-reached openings.
3. Phase 4 code, after phase 1 is live, with plans for the same 10 openings.
4. Content batches after that, with no code changes.
5. Update the README ("Advice accuracy" becomes about ideas, replies and plans) and `/features`.

## Open decisions

- **Free or member.** Replies and plans appear only for uncovered openings, so the four-opening free limit
  already decides how much a free player gets. I suggest no extra gating.
- **One target or three.** I suggest one threshold for ideas, replies and plans: the existing setting.
  Separate settings would mean more Settings for little gain.
- **Reply mission thresholds.** 6 games, 40% or less, and 15 points below the opening overall are starting
  values. Check them against real data from the reply report before launch.

## Not in this work

Find-the-move drills from the player's own games (phase 5) need engine evaluations and an interactive board.
They get their own plan.
