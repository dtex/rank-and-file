// The marketing site: home, features and pricing, plus robots.txt and the sitemap.
// Every figure quoted here comes from the code that enforces it, so the pages cannot drift from the app.
import { readFileSync } from 'node:fs'
import { ADVICE_WINDOW } from '../services/advice.js'
import { FREE_OPENINGS, RANK_WINDOW } from '../services/missions.js'
import { APP_PATH, NAV, SITE_NAME, TAGLINE, boardHtml, esc, faq, pipsHtml, sitePage } from '../services/site.js'
import { DEFAULT_SETTINGS } from '../services/store.js'
import { TREE_FILE, targetFor } from '../services/tree.js'

const PRICE = { month: '$5', year: '$50' }

const tree = JSON.parse(readFileSync(TREE_FILE, 'utf8'))
const OPENINGS = tree.filter((n) => n.moves).length
const node = (id) => tree.find((n) => n.id === id)
const target = (n) => n.target ?? targetFor(n.moves.split(/\s+/).length)
const TARGET_MAX = targetFor(1)
const TARGET_MIN = targetFor(99)
const THRESHOLD = DEFAULT_SETTINGS.adviceThreshold
const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi']

/** An opening as the map draws it: a captioned diagram with its progress. */
function tile(id, status, count) {
  const n = node(id)
  const of = target(n)
  const last = n.moves.split(/\s+/).at(-1)
  return `<div class="node ${status}">
      ${boardHtml(n.moves, { flip: n.side === 'b', label: `${n.name}, after ${n.moves}` })}
      <span class="mvn">${esc(last)}</span>
      <span class="nm">${esc(n.name)}</span>
      <span class="pr caps">${pipsHtml(count, of)}</span>
    </div>`
}

const cta = (label = 'Start free') => `<a class="btn pri" href="${APP_PATH}">${label}</a>`

const software = (config) => ({
  '@context': 'https://schema.org', '@type': 'SoftwareApplication',
  name: SITE_NAME, url: `${config.baseUrl}/`, applicationCategory: 'GameApplication', operatingSystem: 'Web',
  description: 'Chess opening training that sets opening missions and tracks them against your own chess.com games.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', description: `${FREE_OPENINGS} openings` },
    { '@type': 'Offer', name: 'Membership, monthly', price: '5.00', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Membership, yearly', price: '50.00', priceCurrency: 'USD' },
  ],
})

const HOME_FAQ = [
  ['What is Rank and File?',
    `Rank and File is a web app that teaches chess openings through the games you already play on chess.com. It gives you one opening mission for White and one for Black, counts the games that reach that opening, and uncovers the next opening when a mission is complete.`],
  ['How does Rank and File work?',
    `You sign in, enter your chess.com username, and play your normal games. Rank and File reads your finished games from chess.com's public records, counts the ones that reached your mission opening, and scores how closely you followed that opening's ideas. Each completed mission uncovers a new opening on your map.`],
  ['What is an opening mission?',
    `An opening mission is a goal to reach one named opening position, with one colour, in a set number of your own games. Missions need between ${TARGET_MIN} and ${TARGET_MAX} games: first moves such as 1.e4 need ${TARGET_MAX}, and deep lines that depend on your opponent need fewer. A game counts whether you win, lose or draw.`],
  ['Is Rank and File free?',
    `Yes. A free account includes ${FREE_OPENINGS} openings: the two you start with and four more that you uncover. A membership costs ${PRICE.month} a month or ${PRICE.year} a year and uncovers the rest of the ${OPENINGS} openings on the map.`],
  ['Do I need a chess.com account to use Rank and File?',
    `Yes. Rank and File tracks missions against games played on chess.com, so you need a chess.com username with games on it. You never give Rank and File your chess.com password; it reads only the finished games that chess.com publishes for your username.`],
  ['Does Rank and File work with Lichess?',
    `No. Rank and File reads games from chess.com only.`],
  ['Is Rank and File allowed under chess.com fair play rules?',
    `Rank and File is a study aid for after your games. It reads only finished games and gives no help in a game in progress. Looking at opening advice from any source while a game is being played would break chess.com's fair play rules, so use it between games.`],
  ['Who is Rank and File for?',
    `Rank and File is for beginners and club players who want a sound opening repertoire without memorising long lines of theory. It teaches a few ideas per opening and has you practise them in real games, one opening at a time. You must be 16 or older to have an account.`],
  ['How is Rank and File different from an opening trainer or a course?',
    `Most opening trainers drill moves against a computer. Rank and File has no drills: your own rated games are the practice, and the app measures whether you reached the opening and followed its ideas. You do not choose the next opening either; it is the one your recent games reach most often.`],
  ['Is Rank and File affiliated with chess.com?',
    `No. Rank and File is independent and is not affiliated with or endorsed by chess.com. It uses the public game records chess.com makes available.`],
]

const FEATURES_FAQ = [
  ['Which chess openings does Rank and File cover?',
    `Rank and File covers ${OPENINGS} openings and variations for White and Black. They include the Italian Game, Ruy Lopez, Scotch Game, Sicilian Defense, French Defense, Caro-Kann Defense, Scandinavian Defense, Queen's Gambit, Slav Defense, London System, King's Indian setup, Dutch Defense, English Opening and Réti Opening.`],
  ['How does Rank and File choose which opening I learn next?',
    `When you complete a mission, Rank and File looks at the hidden openings next to the ones you have uncovered and picks the one your last ${RANK_WINDOW.toLocaleString('en-US')} games reached most often with that colour. If your games give it nothing to go on, it follows the main lines of the map.`],
  ['Can I choose which opening to study next?',
    `No. The next opening is always the one you meet most often in your own games, so you study what you will actually face. You can return to any opening you have already uncovered.`],
  ['How many games does it take to complete an opening mission?',
    `Between ${TARGET_MIN} and ${TARGET_MAX} games. A first move such as 1.e4 needs ${TARGET_MAX} games, a second move needs ${targetFor(2)}, and deeper lines need fewer because reaching them depends more on your opponent. Only games finished after the mission started count.`],
  ['What is advice accuracy?',
    `Advice accuracy is the percentage of an opening's ideas you followed in one game. Each opening lists a few ideas, such as developing a piece or not bringing the queen out early, and every game that reaches the opening is checked against them move by move. Ideas that did not come up in a game are left out of its score.`],
  ['What is an advice mission?',
    `An advice mission is a short task to follow an opening's ideas more closely. You get one when your last ${ADVICE_WINDOW} scored games in an opening average below your target, which starts at ${THRESHOLD}%. To complete it, average the target or better over ${ADVICE_WINDOW} new games. You can change the target, or switch advice missions off, in Settings.`],
  ['Which of my chess.com games count toward a mission?',
    `By default, rated blitz, rapid and daily games count. You can add bullet, drop any time control, or include unrated games in Settings. Chess960 games and games that start from a set position, such as thematic tournaments, never count.`],
  ['Why did one of my games not count?',
    `The game log gives a reason for every game. The usual ones are that your opponent left the line before the opening was reached, that you left it yourself, that the game ended too early, or that its time control is switched off in your settings.`],
  ['Does Rank and File use a chess engine?',
    `No. Rank and File does not run an engine on your games or rate individual moves. It checks whether a game reached an opening position and whether your moves matched that opening's written ideas.`],
  ['What data does Rank and File keep, and can I delete it?',
    `Rank and File keeps your email address, your chess.com username, the opening moves and results of your finished games, and your progress. It has no passwords, no advertising and no analytics trackers. In Settings you can download everything held about you or delete your account at once.`],
]

const PRICING_FAQ = [
  ['How much does Rank and File cost?',
    `Rank and File is free for your first ${FREE_OPENINGS} openings. A membership costs ${PRICE.month} a month or ${PRICE.year} a year and opens all ${OPENINGS} openings on the map.`],
  ['What do I get for free?',
    `A free account has every feature of the app: missions, the map, advice accuracy, advice missions and the game log. The only limit is the number of openings: the two you start with and four more.`],
  ['Can I cancel my membership?',
    `Yes, at any time, under Settings and then Manage billing. You keep your membership until the end of the period you paid for, and it does not renew after that.`],
  ['What happens to my progress if my membership ends?',
    `Openings beyond your first ${FREE_OPENINGS} are locked and their progress is kept. They come back, with that progress, if you subscribe again. Games played while an opening is locked do not count toward it.`],
  ['How do I pay?',
    `Payment is taken by Stripe, by card, in advance for each month or year. Rank and File never sees or stores your card details.`],
  ['Can I get a refund?',
    `If you are a consumer in the EU or UK you may cancel within 14 days of your first payment for a full refund by writing to us. Otherwise payments are not refunded, except where the law requires. The Terms of Use have the details.`],
]

function home(config) {
  const italian = node('italian')
  const questions = faq('Questions and answers', HOME_FAQ)
  const body = `
    <section class="lead">
      <div>
        <div class="caps kicker">Opening training from your own games</div>
        <h1>Learn chess openings in the games you already play</h1>
        <p class="stand">Rank and File gives you one opening to aim for with each colour, watches your chess.com games, and counts the ones that get there. Finish the mission and the next opening comes out of the fog.</p>
        <p class="actions">${cta()} <a class="btn" href="/features">See how it works</a></p>
        <p class="fine">Free for your first ${FREE_OPENINGS} openings. No password and no card needed.</p>
      </div>
      <figure>
        ${boardHtml(italian.moves, { label: `${italian.name}, after ${italian.moves}` })}
        <figcaption><b>Mission</b>${esc(italian.name)}, after 3.Bc4. Reach this position as White in ${target(italian)} of your own games. ${pipsHtml(3, target(italian))}</figcaption>
      </figure>
    </section>

    <section class="section">
      <h2>How it works</h2>
      <ol class="steps">
        <li><b>i</b><div><h3>Give it your chess.com username</h3><p>Sign in with Google, GitHub or a link sent to your email, then enter your username. Rank and File reads the finished games chess.com publishes for it. It never asks for your chess.com password.</p></div></li>
        <li><b>ii</b><div><h3>Play your normal games</h3><p>You have one mission for White and one for Black. Every game that reaches your mission opening counts, win or lose, and is scored on how well you followed that opening's ideas.</p></div></li>
        <li><b>iii</b><div><h3>Uncover the next opening</h3><p>Complete a mission and a new opening appears on your map: the one your own games reach most often. You always study what you actually face.</p></div></li>
      </ol>
    </section>

    <section class="section">
      <div class="caps kicker">The map</div>
      <h2>A repertoire that grows one opening at a time</h2>
      <p class="stand">${OPENINGS} openings sit on one map, most of them under fog. You start with the first move for each colour and work outward.</p>
      <div class="cards strip">
        ${tile('kp', 'done', target(node('kp')))}
        ${tile('open', 'active', 5)}
        ${tile('knight', 'active', 2)}
        ${tile('italian', 'hidden', 0)}
      </div>
      <p class="fine">Left to right: a completed mission, the two missions in progress, and an opening still to be uncovered.</p>
    </section>

    <section class="section cols">
      <div><h3>A few ideas, not pages of theory</h3><p>Each opening comes with a handful of plain ideas: which piece to develop, which pawn to defend, what not to do. That is all you are asked to remember.</p></div>
      <div><h3>Scored on what you played</h3><p>Every game that reaches an opening gets an advice accuracy percentage, with a line for each idea saying whether you followed it.</p></div>
      <div><h3>Help where you slip</h3><p>If your accuracy in an opening drops below your target, you get a short advice mission to bring it back up over ${ADVICE_WINDOW} games.</p></div>
      <div><h3>Nothing to sell but the app</h3><p>No advertising, no trackers and no passwords. You can download or delete your data at any time.</p></div>
    </section>
    <p class="actions"><a class="btn" href="/features">All features</a> <a class="btn" href="/pricing">Pricing</a></p>

    ${questions.html}

    <section class="section close">
      <h2>Start with your next game</h2>
      <p class="stand">Your first ${FREE_OPENINGS} openings are free.</p>
      <p class="actions">${cta()}</p>
    </section>`
  return sitePage({
    config, path: '/',
    title: `${SITE_NAME}: learn chess openings from your own chess.com games`,
    description: `${SITE_NAME} sets you one chess opening mission per colour and tracks it against your own chess.com games. Free for your first ${FREE_OPENINGS} openings.`,
    body,
    data: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, alternateName: 'Rank & File', url: `${config.baseUrl}/`, description: TAGLINE },
      software(config),
      questions.data,
    ],
  })
}

function features(config) {
  const open = node('open')
  const questions = faq('Questions about the features', FEATURES_FAQ)
  const feature = (kicker, title, text, extra = '') => `
    <section class="section feature">
      <div><div class="caps kicker">${kicker}</div><h2>${title}</h2></div>
      <div>${text}${extra}</div>
    </section>`
  const body = `
    <section class="lead solo">
      <div>
        <div class="caps kicker">Features</div>
        <h1>Everything Rank and File does</h1>
        <p class="stand">Opening missions, a map of ${OPENINGS} openings, and a score for how well you followed each opening's ideas, all measured on your own chess.com games.</p>
      </div>
    </section>
    ${feature('Missions', 'One opening for White, one for Black',
      `<p>An opening mission asks you to reach one named position, with one colour, in a set number of your own games. You hold two at a time, one per colour, so there is always something to aim for whichever side you are given.</p>
       <p>First moves need ${TARGET_MAX} games. Deeper lines need as few as ${TARGET_MIN}, because whether you reach them depends more on your opponent. A game counts whether you win, lose or draw.</p>`)}
    ${feature('The map', `${OPENINGS} openings, uncovered as you go`,
      `<p>Every opening is a captioned diagram on one map, joined to the opening it grows from. The ones you have not reached yet stay under fog. Completing a mission uncovers the next.</p>
       <p>The map runs from 1.e4 and 1.d4 to the Italian Game, Ruy Lopez, Sicilian, French, Caro-Kann, Queen's Gambit, London System and more.</p>`)}
    ${feature('What comes next', 'Your games choose the next opening',
      `<p>Nobody picks their next opening by hand. Of the hidden openings next to what you have uncovered, Rank and File takes the one your last ${RANK_WINDOW.toLocaleString('en-US')} games reached most often with that colour.</p>
       <p>If your opponents keep answering 1.e4 with the Sicilian, the Sicilian is what you study next.</p>`)}
    ${feature('Ideas', 'A few ideas for each opening',
      `<p>Each opening has a study page with its position, the moves that reach it, and a short list of ideas written for players who do not want to memorise theory. These are the ideas for the ${esc(open.name)}, played as Black:</p>`,
      `<ol class="ideas">${open.ideas.map((t, i) => `<li><b>${roman[i]}</b><div>${esc(t)}</div></li>`).join('')}</ol>`)}
    ${feature('Advice accuracy', 'A score for every game',
      `<p>Once you have uncovered an opening, every game that reaches it with your colour is scored on how well you followed its ideas, as a percentage. Select the score in the game log to see, idea by idea, what you followed and what you did not.</p>
       <p>Ideas that did not come up, or that the game ended too soon to judge, are left out of the score.</p>`)}
    ${feature('Advice missions', 'Extra practice where you need it',
      `<p>If your last ${ADVICE_WINDOW} scored games in an opening average below your target (${THRESHOLD}% to start with), you get an advice mission for it: average the target or better over ${ADVICE_WINDOW} new games. It runs beside your two opening missions.</p>
       <p>You can raise or lower the target in Settings, or switch advice missions off.</p>`)}
    ${feature('The game log', 'A reason for every game',
      `<p>Each game is listed with its result and a verdict: counted, your opponent left the line, you left the line, ended early, or not eligible. Where someone left the line, the log shows the move that was played and the move the opening needed.</p>`)}
    ${feature('Your record', 'How each opening is going',
      `<p>An opening's study page shows how often your games reach it, your wins, draws and losses from it, how often you followed each idea, and where your other games went instead.</p>`)}
    ${feature('Settings', 'Count the games you care about',
      `<p>Choose which time controls count toward missions: bullet, blitz, rapid and daily. Count rated games only, or unrated ones too. Chess960 and games from a set position never count.</p>`)}
    ${feature('Privacy', 'No passwords, no trackers',
      `<p>You sign in with Google, GitHub or an emailed link, so there is no password to lose. There is no advertising and no analytics tracking. You can download everything held about you, or delete your account, in Settings. The <a href="/privacy">privacy policy</a> has the full list.</p>`)}
    <p class="actions">${cta()} <a class="btn" href="/pricing">See pricing</a></p>

    ${questions.html}`
  return sitePage({
    config, path: '/features', title: 'Features',
    description: `Opening missions, a map of ${OPENINGS} chess openings, advice accuracy scores and a game log, all tracked against your own chess.com games.`,
    body, data: [questions.data],
  })
}

function pricing(config, onSale) {
  const questions = faq('Questions about pricing', PRICING_FAQ)
  const body = `
    <section class="lead solo">
      <div>
        <div class="caps kicker">Pricing</div>
        <h1>Free to start, ${PRICE.month} a month for the whole map</h1>
        <p class="stand">Every feature is in the free plan. Membership only changes how many openings you can uncover.</p>
      </div>
    </section>
    <section class="plans">
      <div class="box">
        <h2 class="eyebrow">Free</h2>
        <p class="pull">$0</p>
        <p>${FREE_OPENINGS} openings, for as long as you like.</p>
        <ul>
          <li>The two openings you start with, and four more</li>
          <li>Opening missions for White and Black</li>
          <li>Advice accuracy and advice missions</li>
          <li>The full game log</li>
          <li>No card needed</li>
        </ul>
        <p class="actions">${cta()}</p>
      </div>
      <div class="box">
        <h2 class="eyebrow">Membership</h2>
        <p class="pull">${PRICE.month}<small> a month</small></p>
        <p>Or ${PRICE.year} a year, which is two months free.</p>
        <ul>
          <li>All ${OPENINGS} openings on the map</li>
          <li>Everything in the free plan</li>
          <li>Cancel at any time; you keep what you paid for</li>
          <li>Progress is kept if you stop, and returns if you come back</li>
        </ul>
        <p class="actions">${cta('Start free, upgrade later')}</p>
        <p class="fine">${onSale ? 'You subscribe inside the app, under Settings, once you have an account.' : 'Membership is not on sale yet. Free accounts are open now.'}</p>
      </div>
    </section>
    <p class="fine">Prices are in US dollars. Payment is taken by Stripe and renews until you cancel. See the <a href="/terms">Terms of Use</a>.</p>

    ${questions.html}`
  return sitePage({
    config, path: '/pricing', title: 'Pricing',
    description: `${SITE_NAME} is free for your first ${FREE_OPENINGS} chess openings. Membership is ${PRICE.month} a month or ${PRICE.year} a year for all ${OPENINGS}.`,
    body, data: [software(config), questions.data],
  })
}

export default async function siteRoutes(app) {
  const { config, billing } = app.ctx
  const html = (reply, page) => reply.type('text/html').header('Cache-Control', 'public, max-age=300').send(page)
  // The pages do not change while the server runs, so each is built once.
  const pages = { '/': home(config), '/features': features(config), '/pricing': pricing(config, billing.enabled) }
  for (const [path, page] of Object.entries(pages)) app.get(path, async (req, reply) => html(reply, page))

  app.get(APP_PATH, async (req, reply) => reply.sendFile('app.html'))
  app.get(`${APP_PATH}/`, async (req, reply) => reply.redirect(301, APP_PATH))

  app.get('/robots.txt', async (req, reply) => reply.type('text/plain').send(
    `User-agent: *\nDisallow: /api/\nDisallow: /auth/\nDisallow: ${APP_PATH}\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`))
  app.get('/sitemap.xml', async (req, reply) => reply.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      [...NAV.map(([p]) => p), '/privacy', '/terms'].map((p) => `  <url><loc>${esc(config.baseUrl + p)}</loc></url>`).join('\n')}\n</urlset>\n`))
}
