// The bar across the top of every comp page, and the frames. A frame is <iframe data-opt="a">: it loads
// screen.html with that option, in the light or dark the bar is set to.
window.Comp = {
  mount(current) {
    const pages = [['index.html', 'Overview'], ['a-lines.html', 'A · Lines'], ['b-by-colour.html', 'B · By colour'], ['c-diagrams.html', 'C · Diagrams'], ['d-step-through.html', 'D · Step through']]
    document.getElementById('top').innerHTML = `<div class="comp-top caps"><span>Instead of the outline</span>
      ${pages.map(([href, l]) => `<a class="${href === current ? 'on' : ''}" href="${href}">${l}</a>`).join('')}
      <span class="sp"></span>
      <span class="seg" role="group" aria-label="Appearance">${['Light', 'Dark'].map((t) => `<button data-theme-set="${t.toLowerCase()}">${t}</button>`).join('')}</span></div>`
    const set = (t) => {
      document.documentElement.dataset.theme = t
      document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)))
      document.querySelectorAll('iframe[data-opt]').forEach((f) => { f.src = `screen.html?opt=${f.dataset.opt}&theme=${t}` })
    }
    set(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => set(b.dataset.themeSet)))
  },
}
