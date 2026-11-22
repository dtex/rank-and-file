import { html, nothing } from 'lit'
import { View, api } from './lib.js'

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
      const res = await api('/api/settings', { method: 'PUT', body: { ...this.form, reset } })
      this.data = { ...this.data, settings: res.settings }
      this.confirmReset = false
      this.msg = reset ? 'Started over. Syncing games for the new username.' : 'Saved. The change applies to games synced from now on.'
      this.dispatchEvent(new CustomEvent('cb-reload', { detail: { sync: reset }, bubbles: true }))
      if (reset) this.dispatchEvent(new CustomEvent('cb-me', { bubbles: true }))
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
        <label>chess.com username
          <input id="set-username" type="text" .value=${f.username} autocomplete="off" spellcheck="false"
            @input=${(e) => (f.username = e.target.value.trim())}>
        </label>
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
              <p>Changing the username deletes the stored games and all mission progress, then starts again as <b>${f.username}</b>.</p>
              <div class="row"><button type="button" class="pri" @click=${() => this.save(true)}>Start over as ${f.username}</button>
              <button type="button" @click=${() => { this.confirmReset = false; f.username = this.data.settings.username; this.requestUpdate() }}>Cancel</button></div>
            </div>`
          : html`<div class="row"><button class="pri">Save settings</button>
              ${this.msg ? html`<span class="muted">${this.msg}</span>` : nothing}
              ${this.error ? html`<span style="color:var(--bad)">${this.error}</span>` : nothing}</div>`}
      </form>
      <cb-account .me=${this.me}></cb-account>
    </div></div>`
  }
}
customElements.define('cb-settings', CbSettings)
