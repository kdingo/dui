// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// Lives in its own file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('dui-theme')
  if (t !== 'light' && t !== 'dark') {
    t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  document.documentElement.dataset.theme = t
} catch (e) {
  document.documentElement.dataset.theme = 'dark'
}
