# Rank and File

Chess training for the rest of us. Opening missions tracked against your chess.com and Lichess games, for any number of players.

## The site and the app

The marketing site has the root: `/`, `/features` and `/pricing`, written in `routes/site.js` and
sharing a shell with `/privacy` and `/terms` (`services/site.js`). They are plain HTML from the
server, each with its questions and answers both on the page and as FAQPage data, plus
`/robots.txt` and `/sitemap.xml`. The figures they quote are read from the code and `data/tree.json`.

The app itself is one page at `/app`. Sign-in, emailed links and Stripe all return there.

## Opening missions

You get a mission for one opening per colour, play your normal games on chess.com or Lichess, and the app
counts the ones that actually reached that opening. Finish a mission and the next opening
comes out of the fog: of the hidden ones next to what you have uncovered, the one your last
1,000 games reached most often with that colour. With nothing to go on it follows the map's
main lines. Nobody picks the next opening themselves.

## chess.com and Lichess

A user gives a username on chess.com, on Lichess, or on both, and games from both feed the same
missions. Each site has a small client (`services/chesscom.js`, `services/lichess.js`) that trims
its games to one shared record, so nothing after `services/sync.js` cares where a game was played.
A game is matched to the user by the username for its own site.

chess.com files games by month, and unchanged months cost nothing to re-check. Lichess lists games
by start time: the first sync takes a user's newest 1,000 games, and later ones ask for everything
since a day before the newest game held (half a year for correspondence), so a game that was still
being played last time is picked up. Lichess asks for one request at a time and sends about 20
games a second, so a first import can take most of a minute and other users' Lichess syncs wait
behind it.

Adding a site keeps progress. Changing or removing a username starts that user over.

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

## Running it

You need Node 20.12 or newer and Postgres running on the same machine.

```
npm install
cp .env.example .env    # then fill it in; every setting is explained there
npm run migrate         # creates the rank_and_file database and its tables
npm start               # builds the front end, then serves http://localhost:3210
npm test                # uses its own database, rank_and_file_test
```

With an empty `.env` the app still runs for development: sign-in links are printed in the
terminal instead of emailed, Google and GitHub sign-in are not offered, and membership is
not on sale.

## Accounts and sign-in

There are no passwords. People sign in with Google, GitHub, or a link sent to their email.
An account is its verified email address, so every method that proves the same address opens
the same account. To add a provider, copy `services/auth/providers/google.js`, list it in
`services/auth/providers/index.js`, and add its id in `services/config.js`.

Sign-in links are sent over SMTP (`services/mailer.js`), set up for Google Workspace's relay.
The sending domain needs SPF and DKIM records.

At first sign-in a person confirms they are 16 or older, accepts the terms, and may tick a box
to get news and tips. Each choice is recorded in `consents` with the wording version. In
Settings they can change their email address and email preferences, download everything held
about them, and delete their account.

## Free use, membership and gifts

A free account keeps the two starting openings and can uncover four more. Membership
($5 a month or $50 a year, through Stripe) uncovers the rest. When a membership ends, openings
past the first six are locked with their progress kept, and come back on resubscribing.

Stripe setup, once:

1. Put `STRIPE_SECRET_KEY` in `.env` and run `node scripts/stripe-setup.js`. Add the two price lines it prints.
2. In Stripe, add a webhook endpoint at `<BASE_URL>/webhooks/stripe` for `checkout.session.completed` and
   `customer.subscription.created`, `.updated` and `.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Switch on the customer portal in Stripe's settings; it is where members cancel or change plan.

On your own machine, `stripe listen --forward-to localhost:3210/webhooks/stripe` delivers webhooks.

To gift a membership, for example to a beta tester:

```
npm run gift -- tester@example.com                  # one year
npm run gift -- tester@example.com --days 90 --note "beta"
npm run gift -- --revoke tester@example.com
npm run gift -- --list
```

The gift waits for that address and starts the first time the person uses the app signed in with it.

## Admins

List admin email addresses in `ADMIN_ACCOUNTS`, separated by commas. An admin who selects a hidden
tile on the map gets that opening's full study page without uncovering it. From there they can
carry on to the hidden openings beyond it.

## Marketing email

`npm run marketing-list` prints the addresses that opted in, each with its own unsubscribe link.
The app does not send marketing email itself. Every such email must include that person's link
and your postal address, and should go through a bulk-mail service, not the Google relay, which
is meant for an organisation's own mail and has sending limits.

## Going live

- Run with `NODE_ENV=production`, a fixed `SESSION_SECRET`, and an `https` `BASE_URL`.
- The app listens on 127.0.0.1. Put a reverse proxy with TLS in front and set `TRUST_PROXY=1`.
- Fill in the operator details in `.env`; `/privacy` and `/terms` show a marked gap for any that are missing.
- Have a lawyer review `/privacy` and `/terms` (the text is in `routes/legal.js`). When either changes, bump `POLICY_VERSION` in `services/accounts.js`.
- Accept the data processing terms of Google Workspace and Stripe.
- The privacy policy says server logs are kept up to 30 days. Set log rotation to match, or change the text.
- Back up the Postgres database; it is the only copy of everyone's progress.

## Storage

Everything lives in a local Postgres database (`rank_and_file` by default; set `DATABASE_URL` to
use another). `npm start` applies pending migrations from `migrations/`. `data/tree.json` is the
opening flowchart and stays in the repository.

To bring over the JSON files an older, single-user version kept in `data/`:

```
npm run import-data -- path/to/data
npm run claim -- you@example.com     # then sign in with that address
```
