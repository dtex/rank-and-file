// Applies the reader's choice of light or dark before the page is drawn, so it never flashes
// the wrong one. With no choice stored, the stylesheet follows the system setting.
// Loaded in the head of every page as an ordinary script; the choice is made in Settings.
try {
  const theme = localStorage.getItem('rf-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch {
  // Storage can be blocked; the system setting applies.
}
