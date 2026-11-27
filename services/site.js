// The shell shared by every public page: the marketing site, the privacy policy and the terms.
// These pages are plain HTML from the server, so search engines and answer engines read them whole.
import { Chess } from 'chess.js'

/** Where the app lives; the marketing site has the root. Keep in step with public/src/lib.js. */
export const APP_PATH = '/app'

export const SITE_NAME = 'Rank and File'
export const TAGLINE = 'Chess training for the rest of us'

/** The marketing pages, in the order the navigation and the sitemap list them. */
export const NAV = [['/', 'Home'], ['/features', 'Features'], ['/pricing', 'Pricing']]

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// "<" is escaped so no text in the data can close the script element.
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }

/** The position after a line of moves, as the board markup the app draws. `flip` shows it from Black's side. */
export function boardHtml(moves, { flip = false, label = 'Chess position' } = {}) {
  const chess = new Chess()
  for (const san of moves.split(/\s+/).filter(Boolean)) chess.move(san)
  const cells = []
  chess.fen().split(' ')[0].split('/').forEach((row, r) => {
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push({ r, f: f++, p: '' })
      else cells.push({ r, f: f++, p: ch })
    }
  })
  if (flip) cells.reverse()
  const squares = cells.map((c) => {
    const cls = [(c.r + c.f) % 2 ? 'd' : '', c.p && c.p === c.p.toUpperCase() ? 'w' : ''].filter(Boolean).join(' ')
    return `<i${cls ? ` class="${cls}"` : ''}>${c.p ? `${GLYPH[c.p.toLowerCase()]}\uFE0E` : ''}</i>`
  }).join('')
  return `<div class="board" role="img" aria-label="${esc(label)}">${squares}</div>`
}

/** Mission progress as the app's row of dots. */
export const pipsHtml = (n, of) => `<span class="pips" role="img" aria-label="${n} of ${of} games">${Array.from({ length: of }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`

/**
 * Questions and answers as an accordion plus the matching FAQPage data. Answers are plain
 * text. Each question is a native <details>, so it opens without script and a closed answer
 * is still in the page for search engines and find-in-page.
 */
export function faq(title, items) {
  return {
    html: `<section class="section faq" id="faq"><h2>${esc(title)}</h2>${items.map(([q, a]) => `<details class="qa"><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('')}</section>`,
    data: {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  }
}

/**
 * A whole public page. `path` is the page's own address, used for the canonical link and
 * to mark the current tab; `data` is a list of schema.org objects describing the page.
 */
export function sitePage({ config, path, title, description, body, data = [], index = true }) {
  const url = `${config.baseUrl}${path === '/' ? '/' : path}`
  const fullTitle = path === '/' ? title : `${title} · ${SITE_NAME}`
  const crumbs = path === '/' ? [] : [{
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${config.baseUrl}/` },
      { '@type': 'ListItem', position: 2, name: title, item: url },
    ],
  }]
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}">
  ${index ? '' : '<meta name="robots" content="noindex">\n  '}<link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta name="twitter:card" content="summary">
  <script src="/theme.js"></script>
  <link rel="stylesheet" href="/app.css">
  ${[...data, ...crumbs].map(jsonLd).join('\n  ')}
</head>
<body class="site">
  <header class="mast">
    <div class="dl caps"><span>Opening missions for chess.com and Lichess players</span><span class="sp"></span><a class="btn pri" href="${APP_PATH}">Log in</a></div>
    <a class="brand" href="/" aria-label="${SITE_NAME}">Rank <em>&amp;</em> File</a>
    <div class="tagline">${TAGLINE}</div>
    <nav class="tabs caps" aria-label="Site">${NAV.map(([href, name]) => `<a class="tab${href === path ? ' on' : ''}" href="${href}"${href === path ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>
  </header>
  <main class="site-main">
${body}
  </main>
  <footer class="foot">
    <nav class="caps" aria-label="Footer">${NAV.map(([href, name]) => `<a href="${href}">${name}</a>`).join('')}<a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${APP_PATH}">Log in</a></nav>
    <p>${SITE_NAME} is a study aid for after your games. It is not affiliated with or endorsed by chess.com or Lichess.</p>
  </footer>
</body>
</html>`
}
