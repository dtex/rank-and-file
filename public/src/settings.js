import { html, nothing } from 'lit'
import { SITES, THEMES, View, api, getTheme, setTheme } from './lib.js'
import './plan.js'

const LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' }

class CbSettings extends View {
  static properties = { me: { attribute: false }, data: { state: true }, msg: { state: true }, error: { state: true }, confirmReset: { state: true } }

  async connectedCallback() {
    super.connectedCallback()
    this.data = await api('/api/settings')
    this.form = structuredClone(this.data.settings)
  }

  async save(reset = false) {
    this.msg = this.error = ''
    try {
      const had = Object.values(this.data.settings.usernames).filter(Boolean).length
      const res = await api('/api/settings', { method: 'PUT', body: { ...this.form, reset } })
      // A site that was just added has games to fetch.
      const addedSite = Object.values(res.settings.usernames).filter(Boolean).length > had
      this.data = { ...this.data, settings: res.settings }
      this.confirmReset = false
      this.form = structuredClone(res.settings)
      this.msg = reset ? 'Started over. Syncing games for your accounts.'
        : addedSite ? 'Saved. Fetching games from the account you added; a long history can take a minute.'
        : 'Saved. The change applies to games synced from now on.'
      this.dispatchEvent(new CustomEvent('cb-reload', { detail: { sync: reset || addedSite }, bubbles: true }))
      if (reset || addedSite) this.dispatchEvent(new CustomEvent('cb-me', { bubbles: true }))
    } catch (err) {
      if (err.data?.needsReset) this.confirmReset = true
      else this.error = err.message
    }
  }

  toggle(tc, on) {
    const set = new Set(this.form.timeClasses)
    on ? set.add(tc) : set.delete(tc)
    this.form.timeClasses = [...set]
  }

  render() {
    if (!this.data) return html`<div class="page"><p class="muted">Loading…</p></div>`
    const f = this.form
    return html`<div class="page"><div>
      <h2>Settings</h2>
      <form class="form" @submit=${(e) => { e.preventDefault(); this.save() }}>
        <div>
          <label>Your accounts</label>
          <p class="muted" style="margin:4px 0 0">Games from both sites count toward the same missions. Fill in one or both.</p>
          ${SITES.map(([id, name]) => html`<label style="margin-top:12px">${name} username
            <input id="set-username-${id}" type="text" .value=${f.usernames[id]} autocomplete="off" spellcheck="false"
              @input=${(e) => (f.usernames[id] = e.target.value.trim())}>
          </label>`)}
          <p class="muted" style="margin-top:8px">Adding a site keeps your progress. Changing or removing a username starts over.</p>
        </div>
        <div>
          <label>Games that count toward missions</label>
          ${this.data.timeClassOptions.map((tc) => html`<label class="check">
            <input id="set-tc-${tc}" type="checkbox" .checked=${f.timeClasses.includes(tc)} @change=${(e) => this.toggle(tc, e.target.checked)}> ${LABEL[tc]}</label>`)}
          <label class="check" style="margin-top:12px">
            <input id="set-rated" type="checkbox" .checked=${f.ratedOnly} @change=${(e) => (f.ratedOnly = e.target.checked)}> Rated games only</label>
          <p class="muted" style="margin-top:8px">Chess960 and games that start from a set position, such as thematic tournaments, never count.</p>
        </div>
        <label>Advice accuracy target, in percent
          <input id="set-advice" type="number" min="0" max="100" step="5" .value=${String(f.adviceThreshold)}
            @input=${(e) => (f.adviceThreshold = Number(e.target.value))}>
          <span class="muted" style="font-weight:400;display:block;margin-top:6px">When your last 4 games in an opening follow its advice less than this on average,
            you get a mission to work on it. 0 switches these missions off.</span>
        </label>
        ${this.confirmReset
          ? html`<div class="mcard ask" style="margin:0">
              <p>Changing or removing a username deletes the stored games and all mission progress, then starts again with the accounts above.</p>
              <div class="row"><button type="button" class="pri" @click=${() => this.save(true)}>Start over</button>
              <button type="button" @click=${() => { this.confirmReset = false; f.usernames = { ...this.data.settings.usernames }; this.requestUpdate() }}>Cancel</button></div>
            </div>`
          : html`<div class="row"><button class="pri">Save settings</button>
              ${this.msg ? html`<span class="muted">${this.msg}</span>` : nothing}
              ${this.error ? html`<span style="color:var(--bad)">${this.error}</span>` : nothing}</div>`}
      </form>
      <div class="form"><h3>Appearance</h3>
        <div role="radiogroup" aria-label="Appearance">
          ${THEMES.map(([id, name]) => html`<label class="check">
            <input id="set-theme-${id}" type="radio" name="theme" .checked=${getTheme() === id} @change=${() => { setTheme(id); this.requestUpdate() }}> ${name}</label>`)}
          <p class="muted" style="margin-top:8px">Applies at once, on this device.</p>
        </div>
      </div>
      <div class="form"><h3>Membership</h3><cb-plan full .plan=${{ ...this.me?.plan, ...this.data.plan }}></cb-plan></div>
      <cb-account .me=${this.me}></cb-account>
    </div></div>`
  }
}
customElements.define('cb-settings', CbSettings)
