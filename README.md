# chess-buddy

Some tools that leverage the chess.com API to help me learn openings and mating skills.

## Opening missions

You get a mission for one opening per colour, play your normal chess.com games, and the app
counts the ones that actually reached that opening. Finish a mission and the next opening on
the map comes out of the fog.

```
npm install
npm run migrate    # creates the local Postgres database
npm start          # builds the front end, then serves http://localhost:3210
npm test
```

## Advice accuracy

Each opening page lists a few ideas. Once you have uncovered an opening, every game that reaches
it with your colour is scored on how well you followed them, as a percentage shown in the game
log (select the score to see idea by idea why). If your last 4 scored games in an opening average
below the target in Settings (70% to start with), you get an advice mission for it: average the
target or better over 4 new games. It runs beside your opening missions.

The scoring uses the `checks` next to each opening's `ideas` in `data/tree.json`, one per idea, or
`null` for an idea that is only something to know. The format is described at the top of
`services/checks.js`; `npm run tree:check` validates it. Ideas that did not come up in a game, or
that the game ended too soon to judge, are left out of that game's score.

## Storage

Progress and games live in a local Postgres database (`chess_buddy` by default; set `DATABASE_URL`
to use another). `npm start` applies any pending migrations from `migrations/`; `npm run migrate`
does the same and creates the database first if it is missing. Tests use `chess_buddy_test`.

`data/tree.json` is the opening flowchart and stays in the repository.

To bring over the JSON files an older version kept in `data/`, run `npm run import-data -- path/to/data`.
