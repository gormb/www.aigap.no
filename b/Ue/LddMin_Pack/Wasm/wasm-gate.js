// The start gate: on an iPhone or iPad nothing loads until the page is a real visit. A classic script that index.html loads after
// wasm-harness.js and before wasm-compat.js; window.ueStartGate is the promise the compat report, the prewarm and the loader wait
// for.
//
// UE-411970: a long press on a link to the game in iOS opens a link preview, which runs the page in a live web view that takes
// no touch; the loader started the service worker, the GPU device, the manifest, the whole download and the engine in it, and
// the prewarm fetched its pack. Here the page starts on the first of: a touch or key, an earlier user activation
// (navigator.userActivation.hasBeenActive), an installed home-screen app (display-mode standalone, navigator.standalone), or
// the page visible and focused (document.hasFocus()) for 200 ms. A preview is visible but never focused, so it waits on the cover
// with "Tap to start" and a line that tells a player to open the page in Safari.
// <meta name="ue-start-gate"> (?startgate= overrides it): auto (the default: the gate on iOS only), tap (on iOS, always wait for
// one touch or key), focus (the gate on every device) or off. A harness run (?harness=1) is not gated unless the link names
// ?startgate=. Each load logs PAGE VISIT gate, wait and start lines with what the page saw.
window.ueStartGate = (() => {
  const FOCUS_MS = 200;
  const WAIT_MS = 600;
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // ?startgate= names the gate even with no value (the page's setting then decides the mode)
  const linkMode = query.has('startgate') ? query.get('startgate') : null;
  const harnessRun = query.get('harness') === '1';
  let mode = (linkMode || pageMeta('ue-start-gate', 'auto') || 'auto').trim().toLowerCase();
  if (!['auto', 'tap', 'focus', 'off'].includes(mode)) mode = 'auto';
  const gated = mode === 'focus' || ((mode === 'auto' || mode === 'tap') && ios);
  const visible = () => document.visibilityState === undefined || document.visibilityState === 'visible';
  const focused = () => (typeof document.hasFocus === 'function' ? !!document.hasFocus() : true);
  const activated = () => !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  const standalone = () => {
    if (navigator.standalone === true) return true;
    try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; }
  };
  const t0 = Math.round(performance.now());
  const seen = () => 'visibility=' + (document.visibilityState || 'unknown') + ' focus=' + (focused() ? 1 : 0) + ' activation=' + (activated() ? 1 : 0)
    + ' standalone=' + (standalone() ? 1 : 0) + ' size=' + (window.innerWidth || 0) + 'x' + (window.innerHeight || 0)
    + ' screen=' + ((window.screen && window.screen.width) || 0) + 'x' + ((window.screen && window.screen.height) || 0);
  const say = (what, extra) => console.log('PAGE VISIT ' + what + ' ' + Math.round(performance.now()) + ' mode=' + mode + ' ios=' + (ios ? 1 : 0)
    + (extra ? ' ' + extra : '') + ' ' + seen());
  // the loader reloads the page once, and only after this gate opened (wasm-loader.js waits for it first), for the isolation
  // fallback (ue.isolation.reload) or after unregistering a data cache for ?sw=0 (ue.sw.unregistered): that reload is the same
  // visit, so it does not wait for another tap
  const reloaded = (() => {
    try {
      return sessionStorage.getItem('ue.isolation.reload') === '1' ? 'isolation-reload' : sessionStorage.getItem('ue.sw.unregistered') === '1' ? 'sw-reload' : '';
    } catch (e) { return ''; }
  })();
  // why the page starts at once: a harness run, the gate off, a device it does not apply to, or the loader's reload
  const openAt = harnessRun && linkMode === null ? 'harness' : mode === 'off' ? 'off' : !gated ? 'not-ios' : reloaded;
  say('gate', 'open=' + (openAt || '0'));
  if (openAt) return Promise.resolve(openAt);
  return new Promise((resolve) => {
    const gestures = ['pointerdown', 'touchstart', 'touchend', 'keydown', 'click'];
    let waiting = false;
    let done = false;
    let since = 0;
    let poll = 0;
    let waitTimer = 0;
    const open = (reason) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(waitTimer);
      for (const type of gestures) window.removeEventListener(type, tapped, true);
      if (waiting) {
        const cover = $('cover');
        if (cover && cover.classList) cover.classList.remove('gate');
        $('progress-text').textContent = T('Starting...');
        const n = $('notice');
        n.hidden = true;
        n.textContent = '';
      }
      say('start', 'reason=' + reason + ' after=' + (Math.round(performance.now()) - t0) + 'ms');
      resolve(reason);
    };
    const tapped = (event) => open(event.type === 'keydown' ? 'key' : 'tap');
    const wait = () => {
      if (waiting || done) return;
      waiting = true;
      const cover = $('cover');
      if (cover && cover.classList) cover.classList.add('gate');
      $('progress-text').textContent = T('Tap to start');
      const n = $('notice');
      n.textContent = T('Seeing this in a link preview? Open the page in Safari to play.');
      n.hidden = false;
      say('wait');
    };
    for (const type of gestures) window.addEventListener(type, tapped, true);
    if (mode === 'tap') { wait(); return; }
    if (standalone()) { open('standalone'); return; }
    if (activated()) { open('activation'); return; }
    // visible and focused for FOCUS_MS without a break; checked every 50 ms (no event says that hasFocus changed in every
    // browser) and on the events that say it may have
    const check = () => {
      if (done) return;
      if (activated()) { open('activation'); return; }
      if (!(visible() && focused())) { since = 0; return; }
      const now = performance.now();
      if (!since) since = now;
      if (now - since >= FOCUS_MS) open('focus');
    };
    poll = setInterval(check, 50);
    for (const type of ['focus', 'pageshow']) window.addEventListener(type, check);
    // a blur between two polls starts the focus time again (focused for FOCUS_MS without a break)
    window.addEventListener('blur', () => { since = 0; });
    document.addEventListener('visibilitychange', check);
    // the cover says what it waits for once the page has not started well after the focus time (a slow device's timers on a
    // real visit do not flash it)
    waitTimer = setTimeout(wait, WAIT_MS);
    check();
  });
})();
