// Paint the remembered theme synchronously before extension modules resolve.
// Keeping this code in an external file is required in Chrome because extension page
// CSP blocks inline <script> bodies.
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('rss-reader:theme') === 'light' ? 'light' : 'dark';
} catch {
  // Ignore localStorage failures; the module path can still load the theme from
  // chrome.storage.local later.
}
