# chess-buddy

Some tools that leverage the chess.com API to help me learn openings and mating skills.

## Opening missions

You get a mission for one opening per colour, play your normal chess.com games, and the app
counts the ones that actually reached that opening. Finish a mission and the next opening on
the map comes out of the fog.

```
npm install
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

Everything the app remembers is in `data/`:

- `data/tree.json` – the opening flowchart
- `data/progress.json` – settings, missions and what you have uncovered
- `data/games/YYYY-MM.json` – your games, trimmed to the first 30 plies

Commit and push `data/` (or use **Save to GitHub** in the app) to back up your progress.
