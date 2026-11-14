/* Hyakusho - runs before the first paint.
   The opening animation plays once per browser tab. It is skipped when the visitor comes back
   (reload, returning from a shop page) or arrives on a link to one specific book. */
(function () {
  var root = document.documentElement;
  try {
    if (/^#book-\d{1,4}$/.test(location.hash) || sessionStorage.getItem('hyakusho-seen')) root.classList.add('is-returning');
    sessionStorage.setItem('hyakusho-seen', '1');
  } catch (e) { /* storage unavailable: play the opening */ }
})();
