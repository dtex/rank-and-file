// Signing in, the consent step, first-time setup, and the account section of Settings.
import { html, nothing } from 'lit'
import { View, api } from './lib.js'

const LOGIN_ERRORS = {
  'no-email': 'That account has no verified email address, which Chess Buddy needs. Verify it there, or use an email link.',
  expired: 'That sign-in attempt timed out. Try again.',
  provider: 'The sign-in could not be completed. Try again.',
  unavailable: 'That sign-in method is not available.',
}

const legal = html`<a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and
  <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>`

/** A centred card for the screens shown before the app itself. */
const gate = (body) => html`<div class="page gate"><div class="form">
  <a class="brand" href="/">Chess Buddy</a>${body}</div></div>`

class CbLogin extends View {
  static properties = { error: {}, options: { state: true }, email: { state: true }, sent: { state: true }, busy: { state: true }, problem: { state: true } }

  async connectedCallback() {
    super.connectedCallback()
    this.email = ''
    this.problem = LOGIN_ERRORS[this.error] ?? ''
    try {
      this.options = await api('/auth/options')
    } catch {
      this.options = { providers: [], magic: true }
    }
  }

  async send(e) {
    e.preventDefault()
    this.busy = true
    this.problem = ''
    try {
      this.sent = await api('/auth/magic', { method: 'POST', body: { email: this.email } })
    } catch (err) {
      this.problem = err.message
    } finally {
      this.busy = false
    }
  }

  render() {
    if (!this.options) return gate(html`<p class="muted">Loading…</p>`)
    if (this.sent) {
      return gate(html`<h2>Check your email</h2>
        <p>If <b>${this.email}</b> can receive mail, a sign-in link is on its way. It works once and expires in ${this.sent.minutes} minutes.</p>
        <div><button class="link" @click=${() => (this.sent = null)}>Use a different address</button></div>`)
    }
    return gate(html`
      <div><h2>Sign in</h2>
        <p class="muted" style="margin-top:6px">Opening missions tracked against your chess.com games. There is no password: use an account you already have, or a link sent to your email.</p></div>
      ${this.problem ? html`<p style="color:var(--bad);margin:0" role="alert">${this.problem}</p>` : nothing}
      ${this.options.providers.length
        ? html`<div class="stack">${this.options.providers.map((p) => html`<a class="btn wide" href="/auth/${p.id}/start">Continue with ${p.name}</a>`)}</div>
            <div class="eyebrow" style="text-align:center">or</div>`
        : nothing}
      <form class="stack" @submit=${(e) => this.send(e)}>
        <label>Email address
          <input id="login-email" type="email" required autocomplete="email" .value=${this.email} @input=${(e) => (this.email = e.target.value)}>
        </label>
        <button class="pri wide" ?disabled=${this.busy}>${this.busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      </form>
      <p class="muted" style="margin:0">Chess Buddy keeps your email address to sign you in. See the ${legal}.</p>`)
  }
}
customElements.define('cb-login', CbLogin)

/** Reached from an emailed link. The button makes the request, so a mail scanner opening the link changes nothing. */
class CbMagic extends View {
  static properties = { token: {}, busy: { state: true }, error: { state: true }, done: { state: true } }

  async confirm() {
    this.busy = true
    try {
      const res = await api('/auth/magic/verify', { method: 'POST', body: { token: this.token } })
      if (res.purpose === 'change_email') this.done = true
      else location.replace('/')
    } catch (err) {
      this.error = err.message
    } finally {
      this.busy = false
    }
  }

  render() {
    if (this.done) return gate(html`<h2>Email address confirmed</h2><p>Your account now uses the new address.</p><a class="btn pri" href="/">Continue</a>`)
    if (this.error) return gate(html`<h2>That link did not work</h2><p>${this.error}</p><a class="btn" href="/">Back to sign-in</a>`)
    return gate(html`<h2>Almost there</h2><p>Select the button to finish.</p>
      <div><button class="pri" ?disabled=${this.busy} @click=${() => this.confirm()}>${this.busy ? 'One moment…' : 'Continue to Chess Buddy'}</button></div>`)
  }
}
customElements.define('cb-magic', CbMagic)

/** First sign-in: age and terms are required, marketing email is a separate, unticked choice. */
class CbConsent extends View {
  static properties = { me: { attribute: false }, error: { state: true }, busy: { state: true } }

  constructor() {
    super()
    this.form = { age: false, terms: false, marketing: false }
  }

  async accept(e) {
    e.preventDefault()
    this.busy = true
    this.error = ''
    try {
      await api('/api/account/consent', { method: 'POST', body: this.form })
      this.dispatchEvent(new CustomEvent('cb-me', { bubbles: true }))
    } catch (err) {
      this.error = err.message
    } finally {
      this.busy = false
    }
  }

  async cancel() {
    this.busy = true
    try {
      await api('/api/account', { method: 'DELETE' })
    } finally {
      location.replace('/')
    }
  }

  render() {
    const t = this.me.consentText
    const f = this.form
    return gate(html`
      <div><h2>Before you start</h2><p class="muted" style="margin-top:6px">Signed in as ${this.me.email}.</p></div>
      <form class="stack" @submit=${(e) => this.accept(e)}>
        <label class="check"><input id="consent-age" type="checkbox" required @change=${(e) => (f.age = e.target.checked)}> ${t.age}</label>
        <label class="check"><input id="consent-terms" type="checkbox" required @change=${(e) => (f.terms = e.target.checked)}>
          <span>${t.terms} <span class="muted">(${legal})</span></span></label>
        <label class="check"><input id="consent-marketing" type="checkbox" @change=${(e) => (f.marketing = e.target.checked)}> <span>${t.marketing}</span></label>
        ${this.error ? html`<p style="color:var(--bad);margin:0" role="alert">${this.error}</p>` : nothing}
        <div class="row"><button class="pri" ?disabled=${this.busy}>Continue</button>
          <button type="button" ?disabled=${this.busy} @click=${() => this.cancel()}>Cancel and delete my account</button></div>
      </form>`)
  }
}
customElements.define('cb-consent', CbConsent)

/** Asks which chess.com account to follow. */
class CbWelcome extends View {
  static properties = { error: { state: true }, busy: { state: true } }

  async save(e) {
    e.preventDefault()
    this.busy = true
    this.error = ''
    try {
      const { settings, timeClassOptions } = await api('/api/settings')
      const timeClasses = settings.timeClasses.filter((t) => timeClassOptions.includes(t))
      await api('/api/settings', { method: 'PUT', body: { ...settings, timeClasses, username: this.username } })
      this.dispatchEvent(new CustomEvent('cb-me', { bubbles: true }))
    } catch (err) {
      this.error = err.message
    } finally {
      this.busy = false
    }
  }

  render() {
    return gate(html`
      <div><h2>Which chess.com account is yours?</h2>
        <p class="muted" style="margin-top:6px">Chess Buddy reads its finished games from chess.com's public records. It never asks for your chess.com password.</p></div>
      <form class="stack" @submit=${(e) => this.save(e)}>
        <label>chess.com username
          <input id="welcome-username" type="text" required autocomplete="off" spellcheck="false" @input=${(e) => (this.username = e.target.value.trim())}>
        </label>
        ${this.error ? html`<p style="color:var(--bad);margin:0" role="alert">${this.error}</p>` : nothing}
        <div><button class="pri" ?disabled=${this.busy}>${this.busy ? 'Saving…' : 'Start'}</button></div>
      </form>`)
  }
}
customElements.define('cb-welcome', CbWelcome)

const METHOD = { google: 'Google', github: 'GitHub', email: 'Email link' }

/** Email, sign-in methods, email preferences, data download and deletion. */
class CbAccount extends View {
  static properties = { me: { attribute: false }, msg: { state: true }, error: { state: true }, confirmDelete: { state: true }, busy: { state: true } }

  async run(fn) {
    this.msg = this.error = ''
    this.busy = true
    try {
      await fn()
    } catch (err) {
      this.error = err.message
    } finally {
      this.busy = false
    }
  }

  changeEmail(e) {
    e.preventDefault()
    const input = this.querySelector('#acct-email')
    return this.run(async () => {
      const res = await api('/api/account/email', { method: 'POST', body: { email: input.value } })
      this.msg = `If that address is free, a confirmation link is on its way to it. It expires in ${res.minutes} minutes.`
      input.value = ''
    })
  }

  setMarketing(on) {
    return this.run(async () => {
      await api('/api/account/marketing', { method: 'PUT', body: { on } })
      this.dispatchEvent(new CustomEvent('cb-me', { bubbles: true }))
    })
  }

  signOut() {
    return this.run(async () => {
      await api('/auth/logout', { method: 'POST' })
      location.replace('/')
    })
  }

  remove() {
    return this.run(async () => {
      await api('/api/account', { method: 'DELETE' })
      location.replace('/')
    })
  }

  render() {
    const me = this.me
    if (!me) return nothing
    return html`<div class="form">
      <h3>Account</h3>
      <div>Signed in as <b>${me.email}</b>
        <div class="muted">Sign-in methods used: ${me.methods.map((m) => METHOD[m] ?? m).join(', ') || 'none yet'}.
          Any method that confirms this address opens this account.</div></div>
      <form class="stack" @submit=${(e) => this.changeEmail(e)}>
        <label>Change email address
          <input id="acct-email" type="email" required autocomplete="email" placeholder="new address"></label>
        <div><button ?disabled=${this.busy}>Send confirmation link</button></div>
      </form>
      <label class="check"><input id="acct-marketing" type="checkbox" .checked=${me.marketing} ?disabled=${this.busy}
        @change=${(e) => this.setMarketing(e.target.checked)}> <span>${me.consentText.marketing}</span></label>
      ${this.msg ? html`<p class="muted" style="margin:0" role="status">${this.msg}</p>` : nothing}
      ${this.error ? html`<p style="color:var(--bad);margin:0" role="alert">${this.error}</p>` : nothing}
      <div class="row">
        <a class="btn" href="/api/account/export" download>Download my data</a>
        <button ?disabled=${this.busy} @click=${() => this.signOut()}>Sign out</button>
        <span class="sp"></span>
        ${this.confirmDelete ? nothing : html`<button class="link" style="color:var(--bad)" @click=${() => (this.confirmDelete = true)}>Delete account…</button>`}
      </div>
      ${this.confirmDelete
        ? html`<div class="mcard ask" style="margin:0">
            <p>This permanently deletes your account: your email address, games, missions and consent records. It cannot be undone.</p>
            <div class="row"><button class="pri" style="background:var(--bad);border-color:var(--bad)" ?disabled=${this.busy} @click=${() => this.remove()}>Delete my account</button>
              <button @click=${() => (this.confirmDelete = false)}>Cancel</button></div>
          </div>`
        : nothing}
      <p class="muted" style="margin:0">${legal}</p>
    </div>`
  }
}
customElements.define('cb-account', CbAccount)
