// The privacy policy and terms of use. The text describes what this code does;
// when either changes, update the other and bump POLICY_VERSION in services/accounts.js.
// Have a lawyer review both before taking sign-ups.
import { LINK_MINUTES, POLICY_VERSION, SESSION_DAYS } from '../services/accounts.js'
import { GIFT_RENEW_DAYS } from '../services/billing.js'
import { FREE_OPENINGS } from '../services/missions.js'
import { esc, sitePage } from '../services/site.js'

/** Both pages use the site's shell, set as a single column of text. */
const layout = (config, path, title, description, body) => sitePage({
  config, path, title, description,
  body: `<article class="legal">
    <h1>${title}</h1>
    <p class="muted">Version ${POLICY_VERSION}</p>
    ${body}
  </article>`,
})

export default async function legalRoutes(app) {
  const { config } = app.ctx
  const { legal } = config
  // A missing detail shows as an obvious gap rather than a wrong statement.
  const v = (value, what) => (value ? esc(value) : `<mark>[${what} not set]</mark>`)
  const operator = v(legal.operator, 'operator name')
  const contact = legal.contact ? `<a href="mailto:${esc(legal.contact)}">${esc(legal.contact)}</a>` : v('', 'contact email')

  app.get('/privacy', async (req, reply) => reply.type('text/html').send(layout(config, '/privacy', 'Privacy Policy', 'What Rank and File keeps about you, why, and what you can do about it.', `
    <p>Rank and File is run by ${operator} (“we”). This page says what we keep about you, why, and what you can do about it.
      Questions and requests go to ${contact}${legal.address ? `, or by post to ${esc(legal.address)}` : ''}.</p>

    <h2>What we keep</h2>
    <table>
      <tr><th>What</th><th>Why</th><th>Legal basis (GDPR)</th></tr>
      <tr><td>Your email address</td><td>To sign you in, to match your sign-in methods to one account, and to send sign-in links</td><td>Needed to provide the service</td></tr>
      <tr><td>Your account id at Google or GitHub, if you sign in with them</td><td>To recognise you when you sign in again</td><td>Needed to provide the service</td></tr>
      <tr><td>Your username on chess.com, on Lichess, or both, and the finished games those sites publish for it (moves of the opening, result, date, time control, and both players’ usernames and ratings)</td><td>To track your opening missions and score your games</td><td>Needed to provide the service</td></tr>
      <tr><td>Your settings, missions and progress</td><td>To run the app for you</td><td>Needed to provide the service</td></tr>
      <tr><td>Whether you asked for news and tips, and a dated record of each time you agreed or withdrew, with the wording you saw</td><td>To send marketing email only to people who asked, and to be able to show that they did</td><td>Your consent; legal obligation to keep proof of it</td></tr>
      <tr><td>A record that you accepted the terms and confirmed your age</td><td>To show that you did</td><td>Legitimate interest</td></tr>
      <tr><td>Sign-in sessions (times only; the session id is stored scrambled)</td><td>To keep you signed in</td><td>Needed to provide the service</td></tr>
      <tr><td>If you subscribe: Stripe’s ids for you and your subscription, its plan, state and renewal date</td><td>To know that you are a member</td><td>Needed to provide the service</td></tr>
      <tr><td>If you were gifted a membership: the address it was given to and its dates</td><td>To apply the gift</td><td>Needed to provide the service</td></tr>
      <tr><td>Server logs: the address your request came from, the time and the page</td><td>To keep the service secure and find faults</td><td>Legitimate interest</td></tr>
    </table>
    <p>We do not keep passwords (there are none), your name, or card details. Payments are taken by Stripe, and your card never reaches us.</p>

    <h2>Marketing email</h2>
    <p>We send news and tips only if you ticked the box asking for them. The box is never ticked for you, and saying no changes nothing about the app.
      You can stop at any time in Settings or with the unsubscribe link in every such email. Sign-in links and payment receipts are not marketing and are sent regardless.</p>

    <h2>Who else handles your data</h2>
    <ul>
      <li><b>Google</b>: delivers our email, and signs you in if you choose Google. We ask Google only for your email address.</li>
      <li><b>GitHub</b>: signs you in if you choose GitHub. We ask GitHub only for your email address.</li>
      <li><b>Stripe</b>: takes payment if you subscribe, and receives your email address for receipts.</li>
      <li><b>chess.com</b> and <b>Lichess</b>: we ask each site’s public API for the games of the username you give us for it. A site you give no username for is never contacted about you.</li>
      <li>The company that hosts our server.</li>
    </ul>
    <p><b>We do not sell your personal information, and we do not share it for advertising.</b> There are no advertising or analytics trackers on this site.</p>

    <h2>Cookies</h2>
    <p>We set one cookie, which keeps you signed in, and a second one for a few minutes while you sign in with Google or GitHub.
      Both are strictly necessary, so there is no cookie banner. We set no analytics or advertising cookies.</p>

    <h2>Where your data is and how long we keep it</h2>
    <p>Our database is in ${v(legal.dataLocation, 'data location')}. Google, GitHub and Stripe may process data in the United States and elsewhere under their own safeguards.</p>
    <ul>
      <li>Account data: until you delete your account.</li>
      <li>An account whose terms were never accepted: deleted after one day.</li>
      <li>Sign-in sessions: ${SESSION_DAYS} days after you last used them. Emailed links: valid for ${LINK_MINUTES} minutes and removed within a day.</li>
      <li>Server logs: up to 30 days.</li>
      <li>Payment records: Stripe keeps invoices for as long as tax and accounting law requires, also after you delete your account.</li>
    </ul>

    <h2>Your rights</h2>
    <p>Wherever you live, you can do the following yourself in Settings, at no cost:</p>
    <ul>
      <li><b>See and take your data</b>: “Download my data” gives you everything we hold on your account as a file.</li>
      <li><b>Correct it</b>: change your email address or your chess.com and Lichess usernames.</li>
      <li><b>Delete it</b>: “Delete account” removes your account and everything in it at once, ends any membership, and asks Stripe to remove you as a customer.</li>
      <li><b>Withdraw consent</b> to marketing email.</li>
    </ul>
    <p>You can also ask us to restrict or stop a use of your data, and you will never be treated worse for using any of these rights. Write to ${contact}; we answer within 30 days.
      If you are in the EU or UK you may complain to your data protection authority. If you are in California, the rights above are your rights to know, correct and delete under the CCPA, and an agent you authorise may make a request for you.</p>

    <h2>Children</h2>
    <p>Rank and File is for people aged 16 and over, and we ask you to confirm that when you first sign in. If you believe a younger person has an account, tell us and we will delete it.</p>

    <h2>Changes</h2>
    <p>If this policy changes in a way that matters, we will tell you in the app before it takes effect. The version date is at the top.</p>`)))

  app.get('/terms', async (req, reply) => reply.type('text/html').send(layout(config, '/terms', 'Terms of Use', 'The agreement for using Rank and File, including free use, membership and cancellation.', `
    <p>These terms are an agreement between you and ${operator} (“we”) for using Rank and File. Contact: ${contact}.</p>

    <h2>The service</h2>
    <p>Rank and File gives you opening missions and tracks them against the finished games that chess.com and Lichess publish for the usernames you give us.
      It is a study aid for after your games. Do not consult it during a game: that would break the fair play rules of both sites.
      Rank and File is not affiliated with or endorsed by chess.com or Lichess.</p>

    <h2>Your account</h2>
    <p>You must be 16 or older. You sign in with Google, GitHub or a link sent to your email; keep access to that email account secure, because it opens your Rank and File account.
      Give us only usernames that are yours.</p>

    <h2>Free use and membership</h2>
    <ul>
      <li>You can uncover ${FREE_OPENINGS} openings for free: the two you start with and four more.</li>
      <li>Membership uncovers the rest. It costs $5 a month or $50 a year, charged in advance through Stripe, and renews automatically until you cancel.</li>
      <li>You can cancel at any time under Settings, Manage billing. You keep membership until the end of the period you paid for.</li>
      <li>When a membership ends, openings beyond your first ${FREE_OPENINGS} are locked. Their progress is kept and returns if you subscribe again. Games played while an opening is locked do not count toward it.</li>
      <li>If you are a consumer in the EU or UK, you may cancel within 14 days of your first payment for a full refund by writing to us. Otherwise payments are not refunded, except where the law requires.</li>
      <li>If we change the price, we will tell you by email before your next renewal, and you can cancel before it applies.</li>
    </ul>

    <h2>Gifted memberships</h2>
    <p>We may give a membership to an email address for a set time. It starts when it is first used, cannot be exchanged for money, and we may withdraw it.
      In its last ${GIFT_RENEW_DAYS} days you can subscribe, and you are not charged until the gift ends.</p>

    <h2>Fair use</h2>
    <p>Do not try to get at other people’s data, disrupt the service, or use it to break the rules of chess.com or Lichess. We may suspend an account that does.</p>

    <h2>Availability and liability</h2>
    <p>Rank and File depends on the public data of chess.com and Lichess and is provided as it is, without a promise that it will always be available or free of mistakes.
      To the extent the law allows, our liability to you is limited to what you paid us in the 12 months before the claim. Nothing here limits rights you have as a consumer that cannot be limited.</p>

    <h2>Ending</h2>
    <p>You can delete your account at any time in Settings. We may close the service or an account with reasonable notice, refunding any time already paid for and not used.</p>

    <h2>Changes and law</h2>
    <p>If these terms change in a way that matters, we will tell you in the app before the change applies. These terms are governed by the law of ${v(legal.governingLaw, 'governing law')},
      without taking away protections of the law where you live.</p>`)))
}
