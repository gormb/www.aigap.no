// The loader: the manifest, the data cache, the command line, the game script. A classic script: its top-level names are shared
// with the page's other scripts, which index.html loads in order (wasm-harness, wasm-compat, wasm-play, wasm-loader).

// The service worker's URL: ?swranges=wait|net and the isolation fallback as its own query
function swUrl() {
  const p = new URLSearchParams();
  if (query.get('swranges')) p.set('ranges', query.get('swranges'));
  if (pageMeta('ue-sw-isolation') === '1') p.set('isolate', '1');
  if (pageMeta('ue-sw-late-fill') === 'early') p.set('late', 'early');
  if (pageMeta('ue-sw-waves') === '1') p.set('waves', '1');

  const q = p.toString();
  return q ? 'sw.js?' + q : 'sw.js';
}

// The pool's start-up load: Emscripten posts the compiled module to every pool Worker (PTHREAD_POOL_SIZE, 56 at 16 or more
// cores) and runs main once all have instantiated it; 56 instantiating at once took ~1.2 s each where 16 take ~0.3 s
// (Chrome, Lyra's 254 MB module), so the pool held the runtime ~1.7 s on a warm visit. The page sends the load message
// (cmd 1) at once to the last ue-pool-first pool Workers (Emscripten hands out the last one first), answers 'loaded' (cmd 3)
// for the others and sends theirs ue-pool-batch at a time once the first ones are in; a thread started on a held Worker
// (cmd 2) releases its load message first, so the Worker still sees load before run. ?poolfirst=0 (or the meta 0) turns it off
const POOL_FIRST = Number(query.get('poolfirst') || pageMeta('ue-pool-first', '16')) || 0;
const POOL_BATCH = Math.max(1, Number(pageMeta('ue-pool-batch', '8')) || 8);
// Every Worker the game creates, with its time since navigation, as WORKER lines. Emscripten's pthread pool is created before
// main; a thread past it waits for a new Worker to load (serial at start-up)
(() => {
  const Native = window.Worker;
  if (!Native) return;
  let count = 0;
  const pool = [];          // the pthread Workers, in creation order
  const held = new Map();   // Worker -> its held load message [message, transfer]
  const loading = new Set();
  let first = -1;           // Workers still loading of the first tranche (-1 before it starts)
  const nativePost = Native.prototype.postMessage;
  const release = (w) => {
    const m = held.get(w);
    if (!m) return;
    held.delete(w);
    loading.add(w);
    nativePost.call(w, ...m);
  };
  const nextBatch = () => {
    // the Workers Emscripten hands out next first: the end of its unused list, the latest created
    const batch = [...held.keys()].slice(-POOL_BATCH);
    for (const w of batch) release(w);
    if (!held.size) console.log('PAGE POOL all released ' + Math.round(performance.now()));
  };
  const loaded = (w) => {
    if (!loading.delete(w)) return;
    if (first > 0 && --first === 0) console.log('PAGE POOL first ' + POOL_FIRST + ' loaded ' + Math.round(performance.now()));
    if (first === 0 && !loading.size && held.size) nextBatch();
    if (first === 0 && !loading.size && !held.size) console.log('PAGE POOL all loaded ' + Math.round(performance.now()));
  };
  window.Worker = function (url, options) {
    count += 1;
    console.log('WORKER ' + count + ' ' + Math.round(performance.now()) + (timings.runtime !== undefined ? ' after-runtime' : ''));
    const worker = new Native(url, options);
    if (POOL_FIRST > 0 && options && /^em-pthread/.test(options.name || '')) {
      pool.push(worker);
      worker.addEventListener('message', (e) => { if (e.data && e.data.cmd === 3) loaded(worker); });
      worker.postMessage = function (message, ...transfer) {
        const load = message && message.cmd === 1 && message.wasmModule instanceof WebAssembly.Module;
        if (load && timings.runtime === undefined && pool.indexOf(worker) < pool.length - POOL_FIRST) {
          held.set(worker, [message, ...transfer]);
          // Emscripten's pool promise resolves on 'loaded'; the Worker's own 'loaded' comes later and is a no-op there
          Promise.resolve().then(() => worker.onmessage && worker.onmessage(new MessageEvent('message', { data: { cmd: 3 } })));
          return;
        }
        if (held.has(worker)) {
          console.log('PAGE POOL thread on a held Worker ' + Math.round(performance.now()));
          release(worker);
        }
        if (load) {
          loading.add(worker);
          if (first < 0) first = Math.min(POOL_FIRST, pool.length);
        }
        return nativePost.call(worker, message, ...transfer);
      };
    }
    return worker;
  };
  window.Worker.prototype = Native.prototype;
})();
console.log('LOADTIME origin ' + Math.round(performance.timeOrigin));

// What a link's ?args= may pass (<meta name="ue-query-args">, setting QueryArgs; UAT writes all in Development,
// safe in Test and Shipping). safe: a map under /Game/ and the page's own switches; the rest are dropped with a PAGE ARGS line
const SAFE_QUERY_ARGS = [/^\/Game\/[A-Za-z0-9_\/.-]+$/, /^-culture=[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/i,
  /^-WebQualityPreset=(?:Low|Medium|High|Epic|Cinematic)$/i, /^-WebScreenPercentage=\d{2,3}$/i];
function linkArgs(args) {
  const mode = pageMeta('ue-query-args', 'safe');
  if (mode === 'all' || !args.length) return args;
  const kept = mode === 'off' ? [] : args.filter((a) => SAFE_QUERY_ARGS.some((re) => re.test(a)));
  if (kept.length !== args.length) console.log('PAGE ARGS dropped ' + (args.length - kept.length) + ' of ' + args.length + ' link arguments (ue-query-args ' + mode + ')');
  return kept;
}
// EngineTest: arguments split as a shell splits them: whitespace outside double quotes separates, and the quotes are
// removed (`"-ExecCmds=a b"` and `-ExecCmds="a b"` both give the one argument -ExecCmds=a b). The engine's main
// (LaunchWasm.cpp) quotes an argument's value again when it holds a space, so UE's parser reads the whole value; a token
// that kept its quotes reached UE as `"-ExecCmds=a` and ran only the first command
function splitArgs(text) {
  const out = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (const ch of String(text || '')) {
    if (ch === '"') { quoted = !quoted; started = true; continue; }
    if (!quoted && /\s/.test(ch)) { if (started) out.push(current); current = ''; started = false; continue; }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}
// UE-411539: a game code file (the script or the module) whose bytes differ from wasm-cache.json (size or sha1) is not run. The
// data cache (sw.js) fetches it once more with cache: 'reload'; one that still differs it refuses (HTTP 502, X-UE-Mismatch: what
// it found) and it tells the page ('mismatch'); the page checks the game script itself too (WebCrypto, the same once more), so a
// load without the data cache (?sw=0) runs no differing script either (the module is checked only by the data cache: hashing its
// 100+ MB here would hold another copy of it). The stop is the error card (failKind 'mismatch': UE_RUN ERROR). A data file that
// differs is a warning, once (the line under the bar, the toast), one PAGE MISMATCH line per file and the error report's
// 'mismatches'; the game loads on
const mismatchOf = (response) => {
  try { const h = response && response.status === 502 && response.headers.get('X-UE-Mismatch'); return h ? JSON.parse(h) : null; } catch (e) { return null; }
};
// {size, sha1} of the bytes when they differ from the listed file; null when they match or cannot be checked (no WebCrypto, no sha1)
async function bodyDiffers(bytes, listed) {
  if (!listed || !/^[0-9a-f]{40}$/i.test(listed.sha1 || '') || !(window.crypto && crypto.subtle)) return null;
  const sha1 = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sha1 === listed.sha1.toLowerCase() && (!listed.size || bytes.byteLength === listed.size) ? null : { size: bytes.byteLength, sha1 };
}
const mismatchText = (m) => {
  let file = String(m.url);
  try { file = new URL(m.url, location.href).pathname; } catch (e) { /* as given */ }
  const got = m.got || {};
  return `${file} is ${got.size ?? '?'} bytes, sha1 ${got.sha1 || '?'}; wasm-cache.json lists ${m.size} bytes, sha1 ${m.sha1}`;
};
const mismatchSeen = new Set();
let codeStopped = false;   // a game code file differed: the game script is not appended, or not started once loaded
function onMismatch(m) {
  if (!m || !m.url || mismatchSeen.has(m.url)) return;
  mismatchSeen.add(m.url);
  (window.ueMismatches = window.ueMismatches || []).push({ kind: m.kind, url: m.url, size: m.size, sha1: m.sha1, got: m.got });   // the error report
  if (m.kind === 'code') { codeStopped = true; failKind('mismatch', mismatchText(m)); return; }
  console.log('PAGE MISMATCH data ' + mismatchText(m) + '; loading on (read from the network, not kept)');
  if (window.ueMismatches.filter((x) => x.kind !== 'code').length > 1) return;
  const text = T('Some game files on this site do not match their list, so parts of the game may be missing or wrong. Reload the page later; if this repeats, tell the site.');
  notice(text);
  toast(text);
}
// A stop card that means the game cannot run here (fail() with a stop: the browser, GPU, device or site; its 'ue-error' carries
// the stop) ends this page's downloads (UE-411931: after the unsupported-GPU card the data cache went on loading and storing
// the whole game). The page's own early module request is aborted (with or without the data cache), the page posts no
// prefetch, tier or late release and starts no early module compile from then on, and the data cache is told ('stop': a load
// it already runs for the page goes on, as before); a page whose
// GPU check fails shows the card at once (it waited for the display rate, the command line and the shell while the prefetch
// ran: Lyra cold, 0.8 s, now 0.16-0.4 s)
let loadsStopped = false;
const pageLoads = typeof AbortController === 'function' ? new AbortController() : null;
function stopLoads(why) {
  if (loadsStopped) return;
  loadsStopped = true;
  if (pageLoads) pageLoads.abort();
  const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
  console.log('PAGE LOADS_STOPPED ' + why);
  if (controller) controller.postMessage({ type: 'stop', why });
  // a page the data cache does not control yet (a first visit before its claim) counts as running there: it is told too, once
  // the worker is active
  else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((r) => { if (r && r.active) r.active.postMessage({ type: 'stop', why }); }).catch(() => {});
  }
}
window.addEventListener('ue-error', (event) => { const d = event.detail || {}; if (d.kind === 'page' && d.stop) stopLoads(d.stop); });
// The host's kill switch for the data cache: wasm-cache.json is {"sw": "off"}
async function swKilled() {
  try { const list = await (await fetch('wasm-cache.json', { cache: 'no-cache' })).json(); return !!(list && !Array.isArray(list) && list.sw === 'off'); } catch (e) { return false; }
}

(async () => {
  mark('page');
  // A page opened from disk (file://) stops here, before the isolation fallback and any fetch: the compat check's first test
  // says to serve it, and the card is its own (wasm-play.js stop 'file'; UE-411308)
  if (window.ueCompat && window.ueCompat.fromDisk && window.ueCompat.fromDisk()) {
    ueSteps.set('browser', 'warn', 'opened from disk');
    fail(window.ueCompat.check(), 'file');
    return;
  }
  // Nothing starts (the service worker, the GPU device, the manifest, the download, the engine) before the start gate opens:
  // on an iPhone or iPad a link preview runs the page without a visit (wasm-gate.js, <meta name="ue-start-gate">)
  if (window.ueStartGate) await window.ueStartGate;
  // A host without header control (ue-sw-isolation 1): the service worker adds the isolation headers, then the
  // page reloads once under it. A second load that is still not isolated goes on to the compat check's message
  if (pageMeta('ue-sw-isolation') === '1' && !window.crossOriginIsolated && 'serviceWorker' in navigator && query.get('sw') !== '0') {
    let tried = false;
    try { tried = sessionStorage.getItem('ue.isolation.reload') === '1'; } catch (e) { tried = true; }
    // a host that turned the worker off ({"sw":"off"}) gets no register-and-reload loop
    if (!tried && await swKilled()) { tried = true; console.log('PAGE ISOLATION skipped: the data cache is off for this site'); }
    if (!tried) {
      try {
        const registration = await navigator.serviceWorker.register(swUrl());
        // wait for the isolating worker itself (an older worker without isolate=1 makes 'ready' resolve at once,
        // and the reload would not be isolated)
        await new Promise((resolve) => {
          const isolating = () => registration.active && /[?&]isolate=1(?:&|$)/.test(registration.active.scriptURL) && registration.active.state === 'activated';
          if (isolating()) { resolve(); return; }
          const poll = setInterval(() => { if (isolating()) { clearInterval(poll); resolve(); } }, 50);
          setTimeout(() => { clearInterval(poll); resolve(); }, 5000);
        });
        sessionStorage.setItem('ue.isolation.reload', '1');
        console.log('PAGE ISOLATION reload under the service worker');
        location.reload();
        return;
      } catch (e) { console.log('PAGE ISOLATION fallback failed: ' + e); }
    }
  }
  try { sessionStorage.removeItem('ue.isolation.reload'); } catch (e) { /* private window */ }
  // Stop at a browser that cannot run the game; the GPU adapter is asked for while the manifest loads
  ueSteps.set('browser', 'active');
  const unsupported = window.ueCompat ? window.ueCompat.check() : null;
  if (unsupported || window.ueCompatOnly) {
    if (unsupported) { ueSteps.set('browser', 'warn', 'not supported'); fail(unsupported, 'browser'); }
    return;
  }
  // The steps on the loading screen (wasm-play.js), each with what it found
  const who = window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser() : { name: 'browser', version: '' };
  const advice = window.ueCompat && window.ueCompat.advice ? window.ueCompat.advice() : null;
  ueSteps.set('browser', advice ? 'warn' : 'done', (who.name + ' ' + who.version).trim() + ', WebGPU on');
  // The advice line on the key hint's plate (index.html #notice.advice), and again on the playing page for 10 s (the toast),
  // where a player who missed the loading screen reads it
  if (advice) { notice(advice); $('notice').classList.add('advice'); if (!harness) toast(advice); }
  ueSteps.set('gpu', 'active');
  ueSteps.set('settings', 'active');
  const gpuProbe = window.ueCompat && window.ueCompat.probe ? window.ueCompat.probe() : Promise.resolve({ message: null });
  gpuProbe.then((gpu) => {
    const a = gpu.adapter;
    const name = a ? [a.vendor, a.architecture, a.device || a.description].filter(Boolean).join(' ') : '';
    // (a site stop, such as the phone build on a desktop GPU, is no fault of this GPU)
    const unusable = gpu.message && gpu.kind !== 'site';
    ueSteps.set('gpu', unusable ? 'warn' : 'done', unusable ? 'none usable' : (name || 'the browser does not name it') + (a && a.integrated ? ', integrated' : ''));
    // the card now, not after the command line (stopLoads); a bench page's own message is no GPU stop and waits as before
    if (gpu.message && !window.ueBench) fail(gpu.message, gpu.kind || 'gpu');
  });
  // The start arguments the compat check picks (the renderer tier when the stage has two, and with the GPU check on, the
  // starting resolution); the check runs while the files download
  const startArgs = window.ueCompat && window.ueCompat.startArgs ? window.ueCompat.startArgs() : Promise.resolve([]);
  // The page's GPU device (wasm-prewarm.js) is requested once the check has picked the tier, while the files download
  if (window.uePrewarm) window.uePrewarm.start(startArgs);
  startArgs.then(async () => {
    const p = window.ueCompat && window.ueCompat.pick ? window.ueCompat.pick() : { source: 'none' };
    const renderer = (p.tier === 'desktop' ? 'desktop renderer' : p.tier === 'deferred' ? 'deferred renderer' : 'forward renderer') + (p.preset ? ', ' + p.preset : '');
    const sp = p.screen_percentage ? ', ' + p.screen_percentage + ' % resolution' : '';
    // The textures' format: the chosen texture set's features (UAT -WasmAddTextureSet; startArgs waited for the choice, so it is
    // in already, and a page that never chose one does not wait), else the stage's ue-texture-formats
    const set = window.ueCompat && window.ueCompat.hasTextureSets && window.ueCompat.hasTextureSets()
      ? await Promise.race([window.ueCompat.textureSet(), new Promise((resolve) => setTimeout(() => resolve(null), 0))]) : null;
    const formats = set ? set.features : pageMeta('ue-texture-formats', 'texture-compression-bc').split(',').map((s) => s.trim());
    const textures = formats.includes('texture-compression-astc') ? ', ASTC textures' : formats.includes('texture-compression-bc') ? ', BC textures' : '';
    const detail = p.source === 'measured' && p.bench && p.bench.ms
      ? `took ${p.bench.total_ms < 1000 ? p.bench.total_ms + ' ms' : (p.bench.total_ms / 1000).toFixed(1) + ' s'}, ${p.bench.ms} ms per test draw: ${renderer}${sp}`
      : p.source === 'stored' ? `from this browser's last check: ${renderer}${sp}`
        : p.source === 'forced' ? `set by the link${sp}` : p.tier ? renderer : 'the defaults';
    ueSteps.set('settings', 'done', detail + textures);
  }, () => ueSteps.set('settings', 'warn', 'the defaults'));
  // The later pak chunks' containers (sw.js isLate) load whole once the game is ready; sw.js releases them itself 20 s after
  // the boot containers are in when the page has not
  let latePosted = false;
  // The tier the game runs, named in the late release so the worker needs no memory of it (a worker restarted since the pick has
  // none): the RHI's ('ue-webgpu-tier', below) once it has decided, else the page's pick
  let tierByRhi = null, tierByPick = null;
  const postLate = () => {
    if (latePosted || loadsStopped || !navigator.serviceWorker || !cached) return;   // an uncached load reads the late chunks directly
    // a page the worker does not control yet posts once it does
    if (!navigator.serviceWorker.controller) {
      console.log('LOADTIME late_waiting ' + Math.round(performance.now()));
      navigator.serviceWorker.addEventListener('controllerchange', postLate, { once: true });
      return;
    }
    latePosted = true;
    console.log('LOADTIME late_posted ' + Math.round(performance.now()));
    const tier = tierByRhi || tierByPick;
    navigator.serviceWorker.controller.postMessage(tier ? { type: 'prefetch-late', tier: tier === 'forward' ? 'mobile' : tier } : { type: 'prefetch-late' });
  };
  // The engine's ready event (wasm-play.js lists the names); a Shipping log prints no ready line
  for (const name of ['ue-ready', 'ue-site-ready', 'ue-interactive']) {
    window.addEventListener(name, () => { console.log('LOADTIME site_ready ' + Math.round(performance.now())); postLate(); });
  }
  // The page's own defaults first (index.html <meta name=ue-args>), e.g. the thread caps Chrome's Worker limit needs
  const defaults = splitArgs(pageMeta('ue-args'));
  // Arguments for one browser only (<meta name="ue-args-firefox">, -chrome, -safari, -edge), e.g. a cheaper auto
  // exposure where pipelines compile one at a time: "-ini:Engine:[ConsoleVariables]:r.EyeAdaptation.MethodOverride=2"
  const browserName = (window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser().name : '').toLowerCase();
  if (browserName) defaults.push(...splitArgs(pageMeta('ue-args-' + browserName)));
  // The device profile's arguments (wasm-profile.js: <meta name="ue-args-ios">, -android, -desktop) and its settings in the log.
  // They win over the page's and the browser's: UE reads a flag's first occurrence, so the profile's flags go first, and it applies
  // -ini: overrides in order (the last one wins; +Key adds to an array), so the profile's -ini: arguments go after every default
  const profile = window.ueProfile || null;
  const profileArgs = profile ? splitArgs(pageMeta('ue-args-' + profile.name)) : [];
  const profileIni = profileArgs.filter((a) => /^-ini:/i.test(a));
  defaults.unshift(...profileArgs.filter((a) => !/^-ini:/i.test(a)));
  // Threading and sound for this device class (wasm-compat.js threading(): the project settings' ue-threads-*, ue-sound-* and
  // ue-pool-* metas, ?threads= and ?sound=; the class is the device profile's). The defaults keep iOS single-threaded without
  // sound, Android and desktop threaded. The pool size goes to the game script's PTHREAD_POOL_SIZE expression
  // (window.ueProfile.poolSize, read before the pool is made); a device profile's pool=N, or a page script that set
  // ueProfile.poolSize itself, keeps it when it is a whole number from 1 to 128 (the expression's own test, WasmTargetRules.cs
  // PthreadPoolSize); any other value is dropped, so the threading settings' pool applies (a PAGE THREADS line names the refused
  // value). The choice is made once, here; no template script that runs later writes the pool, and a value a project's later
  // script writes is checked only by the expression, which falls back to the link's own rule. Single-threaded, the profile's
  // audio thread (wasm-profile.js; the order of its inputs, the WebKit 26 rule included, is in Docs/PageContract.md,
  // ue-audio-thread) gives sound one pthread of its own
  // (-WebAudioThread) instead of the game thread's mixer, which crackles and stops in long frames; ueProfile.audioThread then
  // holds whether it runs, and the link's iOS pool expression adds one for it
  const threading = window.ueCompat && window.ueCompat.threading ? window.ueCompat.threading() : null;
  if (threading) {
    defaults.push(...threading.args);
    // (the page's object is read and written inside try: a value that cannot be read or converted counts as none)
    try {
      window.ueProfile = window.ueProfile || {};
      window.ueProfile.audioThread = threading.audioThread;
      const pagePool = window.ueProfile.poolSize;
      let n = NaN;
      try { n = Number(pagePool); } catch (e) { n = NaN; }   // (Number throws on a Symbol)
      const validPool = Number.isInteger(n) && n >= 1 && n <= 128 ? n : 0;
      if (pagePool != null && pagePool !== '' && !validPool) {
        let shown = '';
        try { shown = String(pagePool); } catch (e) { shown = typeof pagePool; }
        console.log('PAGE THREADS pool ' + shown + ' refused: not a whole number from 1 to 128');
      }
      if (validPool) threading.why.pool = 'profile';
      window.ueProfile.poolSize = validPool || threading.pool || null;
    } catch (e) {
      console.log("PAGE THREADS the page's pool could not be read, the link's rule applies: " + e);
    }
    let pool = null;
    try { pool = window.ueProfile.poolSize || null; } catch (e) { pool = null; }
    console.log('WEB_THREADS ' + JSON.stringify({ ...threading, pool }));
    // UE-411514: ?threads=1 refused on iOS (wasm-compat.js threading()): the page says why, under the bar and on the playing page
    if (threading.refused) {
      console.log('PAGE THREADS ?threads=1 refused on ios: the threaded engine starts about 22 Workers, each with its own instance of the module, more than an iPhone or iPad tab may hold; single-threaded (?threads=force starts it threaded)');
      const text = T('This game runs single-threaded on iPhone and iPad: the threaded version needs more memory than Safari gives a tab.');
      notice(text);
      if (!harness) toast(text);
    }
  } else if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) {
    // wasm-compat.js did not load (or has no threading()): keep the template's iOS defaults, single-threaded without sound,
    // which an iPhone or iPad tab needs to start at all
    defaults.push('-nothreading', '-nosound');
    console.log('WEB_THREADS {"class":"ios","threads":"single","sound":false,"why":"wasm-compat.js threading() unavailable"}');
  }
  // Cache priming: a game that can start from a pre-baked file instead of building that data on its first start (a cache it
  // writes later, data that takes many pipelines to make) names it here. On a priming load the page passes the game its switches
  // (<meta name="ue-prime-args">) and asks the data cache to load the file with the start-up files (<meta name="ue-prime-file">,
  // its URL as wasm-cache.json lists it), so the engine's read does not wait for it. <meta name="ue-prime-when">: first (the
  // default: a browser that has not reached the game's ready state on this page before), serial (a browser that builds its
  // pipelines one at a time, where building is slowest) or always. Nothing happens while both are empty
  const primeArgs = splitArgs(pageMeta('ue-prime-args'));
  const primeFile = pageMeta('ue-prime-file').trim();
  const primedKey = 'ue.' + (pageMeta('ue-project') || 'game') + '.primed';
  let primeWhy = '';
  if (primeArgs.length || primeFile) {
    const when = pageMeta('ue-prime-when', 'first');
    let seen = false;
    try { seen = localStorage.getItem(primedKey) === '1'; } catch (e) { seen = false; }
    const who = window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser() : { name: '', os: '' };
    const serial = who.name === 'Firefox' || who.name === 'Safari' || who.os === 'iOS';
    primeWhy = when === 'always' ? 'always' : when === 'serial' ? (serial ? 'a browser that builds pipelines one at a time' : '') : (!seen ? 'a first visit' : '');
    if (primeWhy) {
      defaults.push(...primeArgs);
      console.log('PAGE PRIME ' + primeWhy + ': ' + (primeArgs.join(' ') || 'no arguments') + (primeFile ? ', ' + primeFile : ''));
    }
  }
  // the next load is no first visit once this one reached the game's ready state (the engine's ready event or line)
  const markPrimed = () => { if (primeArgs.length || primeFile) { try { localStorage.setItem(primedKey, '1'); } catch (e) { /* private window */ } } };
  window.addEventListener('ue-ready', markPrimed, { once: true });
  const project = pageMeta('ue-project');
  if (!project || project.includes('%')) {
    fail('This page names no project (<meta name="ue-project">): stage it with UAT (BuildCookRun -platform=Wasm), which fills it in.');
    return;
  }
  const status = $('status');
  const canvas = $('canvas');
  // The render target at most ue-max-dpr device pixels per CSS pixel (default 1). A touch screen (touch points and a coarse
  // primary pointer: the engine's test for its virtual joysticks, WasmPlatformMisc.cpp) gets at least ue-touch-dpr (default 2,
  // also for a page without the setting; at most the device's), the density a native phone build gives the game (Android's
  // r.MobileContentScaleFactor 1: 720 lines; iOS: contentScaleFactor 2). Widgets laid out and hit-tested in viewport pixels
  // need it: at 1 pixel per CSS pixel a phone's viewport has half the native pixels, so the templates' UMG thumbsticks (which
  // take any finger within 250 pixels of their centre) reached twice as far across the screen, and a finger sliding off the
  // movement stick drove the camera stick too. (The engine's own virtual joystick scales with the viewport either way.) The
  // 3D scene keeps the ue-max-dpr resolution: the engine renders it at Module.sceneScale (WasmApplication.cpp)
  const deviceDpr = window.devicePixelRatio || 1;
  const sceneDpr = Math.min(deviceDpr, Number(pageMeta('ue-max-dpr')) || 1);
  const touchScreen = navigator.maxTouchPoints > 0 && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  // ue-touch-dpr 1 (or less, 0 included) keeps the ue-max-dpr canvas, also when ue-max-dpr is below 1; no setting or a value
  // that is not a number gives the default 2
  const touchMeta = pageMeta('ue-touch-dpr').trim();
  const touchDpr = touchMeta !== '' && Number.isFinite(Number(touchMeta)) ? Number(touchMeta) : 2;
  let dpr = touchScreen && touchDpr > 1 ? Math.min(deviceDpr, Math.max(sceneDpr, touchDpr)) : sceneDpr;
  const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  // a custom page whose canvas has no CSS size grows with its buffer: the denser touch canvas would then no longer be dpr
  // device pixels per CSS pixel (the engine's input scale), so such a page keeps the ue-max-dpr canvas
  if (dpr > sceneDpr && (Math.abs(canvas.clientWidth - cssWidth) > 1 || Math.abs(canvas.clientHeight - cssHeight) > 1)) {
    dpr = sceneDpr;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }
  let manifest = [];
  let files = [];
  try {
    manifest = await (await fetch('wasm-manifest.json', { cache: 'no-cache' })).json();
    mark('manifest');
  } catch (e) {
    console.log('HARNESS ABORT no wasm-manifest.json: ' + e);
    fail('The game files are missing (wasm-manifest.json): ' + e);
    return;
  }
  let swOff = false;
  try {
    files = await (await fetch('wasm-cache.json', { cache: 'no-cache' })).json();
  } catch (e) {
    // a stage packaged before wasm-cache.json existed
  }
  if (!Array.isArray(files)) { swOff = !!(files && files.sw === 'off'); files = []; }   // {"sw": "off"}: the host's kill switch
  // A stage with two texture sets (wasm-compat.js textureSet): the files tagged with a set ("set": "bc", "set": "astc", the
  // added set's below Content/Paks/ASTC/) are that set's; only the chosen set's go to the engine and the data cache, so the
  // engine mounts one set's containers and the other set's are never fetched. An adapter that fits no set stops here, before
  // any game file is fetched
  // The manifest says whether the stage has texture sets too: without wasm-compat.js (it failed to load) the page cannot
  // choose a set, and it must not mount both
  const taggedSets = manifest.some((e) => e.set) || files.some((e) => e.set);
  const compatSets = !!(window.ueCompat && window.ueCompat.hasTextureSets && window.ueCompat.hasTextureSets());
  if (taggedSets && !(window.ueCompat && window.ueCompat.textureSet)) {
    console.log('HARNESS ABORT texture sets without wasm-compat.js');
    fail('The game could not start: its browser check (wasm-compat.js) did not load. Reload the page to try again.');
    return;
  }
  if (taggedSets || compatSets) {
    const set = await window.ueCompat.textureSet();
    if (!set) {
      const gpu = await gpuProbe;
      fail(gpu.message || 'This GPU has no texture format this game was cooked for.', window.ueBench ? undefined : (gpu.kind || 'gpu'));
      return;
    }
    const inSet = (e) => !e.set || e.set === set.name;
    manifest = manifest.filter(inSet);
    files = files.filter(inSet);
    // the RHI asks for ASTC only on an adapter without BC unless told to (WebGPUDevice.cpp -WebGPUASTC)
    if (set.features.includes('texture-compression-astc')) defaults.push('-WebGPUASTC');
    console.log(`PAGE TEXTURE_SET ${set.name}: ${manifest.filter((e) => e.set).length} of the set's own files mounted, ${manifest.length} in all`);
  }
  // A file split into parts (a host's per-file limit) loads only through the data cache: without it the game would
  // stop on a missing file deep in the load
  const splitFiles = files.filter((f) => Array.isArray(f.parts) && f.parts.length);
  // a late file is never split (PageContract.md; check_stage.py refuses it): before its release the data cache reads it as ranges
  // of its own URL, which a host of its parts does not serve, so the game would stop on a failed read during start-up.
  // Decided here, before the page binds the data cache, prefetches or compiles anything
  const splitLate = splitFiles.find((f) => f.late);
  if (splitLate) {
    fail('This site splits a file the game loads after it starts into parts, which this page cannot read. The site needs to send it whole: ' + splitLate.url);
    return;
  }
  if (loadsStopped) return;   // the GPU check failed while the lists loaded: no data cache, prefetch or module load
  // The data cache (sw.js): Brotli whole-file loads and a second visit from Cache Storage. On by default; ?sw=0 runs without it
  // and removes a registered one
  let cached = false;
  // adds the picked tier's start files to the start-up download count, once that count exists (below)
  let countTier = () => {};
  // posts the tier the RHI runs when it differs from the tier the page posted (its fallbacks): the RHI's 'ue-webgpu-tier' event
  // (WebGPUDevice.cpp, once, after its tier decision)
  let repostTier = () => {};
  window.addEventListener('ue-webgpu-tier', (event) => { const t = event.detail && event.detail.tier; if (t) { tierByRhi = t; repostTier(t); } });
  // the engine's command line before the pick's and a bench's arguments, once it is built (below, where window.Module is made)
  let resolveEngineArgs = null;
  const engineArgs = new Promise((resolve) => { resolveEngineArgs = resolve; });
  let swScope = null;   // the data cache's scope: the module's URL in 'module-compiled' is resolved against it, as sw.js lists it
  if ('serviceWorker' in navigator) {
    if (query.get('sw') === '0' || swOff) {
      // a page the worker still controls would keep reading through it: reload once it is gone
      const controlled = !!navigator.serviceWorker.controller;
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      let reloaded = false;
      try { reloaded = sessionStorage.getItem('ue.sw.unregistered') === '1'; } catch (e) { reloaded = true; }
      if (controlled && !reloaded) {
        try { sessionStorage.setItem('ue.sw.unregistered', '1'); } catch (e) { /* private window */ }
        location.reload();
        return;
      }
    } else {
      try {
        // ?swranges=wait registers the worker that waits for the whole-file load instead of reading ranges from the network
        const registration = await navigator.serviceWorker.register(swUrl());
        swScope = registration.scope;
        // (A reload of a page whose worker was already active, and a hard reload, which the worker never controls,
        // waited here for ever at "Starting..."): a first install waits for the worker's claim (up to 15 s); an already active
        // worker that does not control the page gets a second for it, then this load runs uncached (the fetch backend reads the
        // network directly)
        // A hard reload is not controlled by the active worker: ask it to claim the page (sw.js 'claim'), so the reload reads
        // the cached files instead of downloading the game again
        if (!navigator.serviceWorker.controller) {
          const active = registration.active;
          await new Promise(resolve => {
            navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            if (active) active.postMessage({ type: 'claim' });
            setTimeout(resolve, active ? 2000 : 15000);
          });
          if (active && navigator.serviceWorker.controller) console.log('PAGE SW_CLAIMED: the active worker took over this load (a hard reload)');
        }
        // the check failed while the worker registered: the card is up, nothing is prefetched
        if (loadsStopped) return;
        if (navigator.serviceWorker.controller) {
          cached = true;
          mark('sw');
          // The worker's 'mismatch' messages, listened for before this page binds its list and asks for its files (a message
          // with no listener yet is lost, and the worker tells each page once). The worker serves every page of its scope: a
          // mismatch counts here only for a file this page's own list names with the same sha1 (another tab's build may list
          // the same URL with another sha1 or size; an entry without a sha1 cannot tell builds apart and counts)
          const ownMismatch = (m) => {
            try {
              const href = new URL(m.url, location.href).href;
              const f = files.find((x) => new URL(x.url, location.href).href === href);
              return !!f && (!f.sha1 || String(f.sha1).toLowerCase() === String(m.sha1 || '').toLowerCase())
                && (!f.size || !m.size || f.size === m.size);
            } catch (e) { return false; }
          };
          navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data || {};
            if (data.type === 'mismatch' && ownMismatch(data)) onMismatch(data);
          });
          navigator.serviceWorker.controller.postMessage({ type: 'mismatches' });   // any found before this listener (another tab's load)
          // First the list this page read, so the worker serves this page (and its Workers) that build's files
          // even after a deploy or a worker restart; then every game file's whole-file load (sw.js prefetch)
          navigator.serviceWorker.controller.postMessage({ type: 'bind', files });
          navigator.serviceWorker.controller.postMessage({ type: 'prefetch' });
          // a priming load's pre-baked file loads with the start-up files (above: ue-prime-file)
          if (primeWhy && primeFile) navigator.serviceWorker.controller.postMessage({ type: 'prefetch-file', url: primeFile });
          // the desktop or deferred tier's loose files that the engine reads at start (global shaders and the pipeline list, about
          // 44 MB on Lyra's desktop tier) load once the page has picked that tier and the game's wasm is compiled (sw.js
          // prefetchTier); each mobile tier's shader libraries are in a container of their own (tagged with its tier), so a forward
          // pick posts 'mobile' and a deferred pick 'deferred', which load that tier's pipeline list and container. Loaded
          // alongside the wasm download, Chrome failed the wasm read
          // (253 MB, Development) with net::ERR_BLOB_OUT_OF_MEMORY on most desktop loads; the wasm is the critical path, and
          // the engine reads none of these files before its runtime is up
          const controller = navigator.serviceWorker.controller;
          const codeIn = Promise.race([marked('wasm_compiled'), marked('runtime')]);
          // (the mobile tier's own start files, its pipeline list and its shader container, load the same way)
          // (a pick that failed still posts, with the defaults the engine then starts with: sw.js holds a warm visit's late release
          // until the pick)
          Promise.all([engineArgs, startArgs.catch(() => []), codeIn]).then(([base, args]) => {
            // The engine reads its whole command line (the link's and the stage's arguments, the page's defaults, the harness's, then
            // the pick's and a bench's: script.onload), so the tier is read from all of it in the RHI's order (ueCompat.runningTier).
            // A start without tier switches (?compat=1, a harness run without ?tier=) runs the project's tier. A wrong guess costs
            // only this prefetch: the RHI mounts the tier it runs (WebGPUDevice.cpp)
            const all = base.concat(args || [], outside((window.ueBench && window.ueBench.args) || [], ''));
            // (without wasm-compat.js: forward, and the RHI's tier event corrects it)
            const running = window.ueCompat && typeof window.ueCompat.runningTier === 'function' ? window.ueCompat.runningTier(all) : 'forward';
            const tier = running === 'forward' ? 'mobile' : running;
            if (loadsStopped) return;
            if (tier !== 'mobile') console.log('LOADTIME tier_posted ' + Math.round(performance.now()));
            controller.postMessage({ type: 'prefetch-tier', tier });
            tierByPick = running;
            countTier(running);
            let posted = running;
            repostTier = (rhiTier) => {
              if (rhiTier === posted) return;
              console.log(`PAGE TIER the RHI runs ${rhiTier} (the page posted ${posted}): its files load instead`);
              posted = rhiTier;
              controller.postMessage({ type: 'prefetch-tier', tier: rhiTier === 'forward' ? 'mobile' : rhiTier });
              countTier(rhiTier);
            };
          }, () => {});
        } else {
          console.log('service worker not controlling this load (a hard reload): uncached');
        }
      } catch (e) {
        console.log('service worker unavailable: ' + e);
      }
    }
  }
  try { sessionStorage.removeItem('ue.sw.unregistered'); } catch (e) { /* private window */ }
  if (loadsStopped) return;
  // The game's module starts loading and compiling now, through the data cache, instead of when the game script runs:
  // before it the page measures the display's rate (up to 1 s of frames), reads the command line and the script, and
  // the module's 254 MB read and compile (or the load of its compiled code, which Chrome keeps for a cached response) waited
  // for all of it (measured). Module.instantiateWasm instantiates the compiled module; ?wasmearly=0 leaves
  // Emscripten's own instantiateStreaming at the script's start. The compile goes through wasm-harness.js's wrapper, so
  // wasm_compiled marks this compile (the instantiate of the compiled module is not counted), and the desktop or deferred tier's
  // prefetch (held above until wasm_compiled) follows it, still after the module's download. The page's GPU device
  // (wasm-prewarm.js) is untouched: it is handed over in Module.preinitializedWebGPUDevice when the script has loaded
  const earlyGame = pageMeta('ue-game');
  const earlyName = new RegExp('^' + (earlyGame && !earlyGame.startsWith('%') ? earlyGame : project).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:-Wasm-[A-Za-z]+)?\\.wasm$');
  const earlyListed = files.find((f) => f.url.startsWith(project + '/Binaries/Wasm/') && earlyName.test(f.url.split('/').pop()));
  // A page the data cache controls first takes the browser's HTTP cache copy of the module when there is one (sw.js puts it
  // there once; only-if-cached: no request to the host and no revalidation, the URL carries the file's sha1) and compiles that
  // response untouched: the browser keeps the code it compiled beside an HTTP cache entry and loads it on the next visit, which
  // a response the data cache builds from its stored pieces does not get (that cache entry is cleared and rewritten on every
  // visit). Without an HTTP cache copy it reads the data cache's copy, as before
  // The HTTP cache is asked only when the worker has put this module (this sha1) there and seen the browser keep it (sw.js
  // fillHttpCache writes its record, __ue/http-copy, in the data cache): Chrome logs every only-if-cached miss as a red
  // "net::ERR_CACHE_MISS", caught or not, so asking on every load put one console error on each cold visit (UE-410985), and on
  // every visit for a module over the HTTP cache's per-entry limit (UE-410984)
  let earlyFrom = 'data cache';
  const earlyHeld = () => (swScope && typeof caches !== 'undefined'
    ? caches.match(new URL('__ue/http-copy', swScope).href).then((r) => (r ? r.json() : null))
      .then((record) => !!(record && record.held && record.held[earlyListed.sha1]), () => false)
    : Promise.resolve(false));
  // (a stop aborts it, also one that comes while the HTTP cache record is read: stopLoads)
  const signal = pageLoads ? pageLoads.signal : undefined;
  const earlyResponse = () => {
    if (!cached || !earlyListed.sha1) return fetch(earlyListed.url, { credentials: 'same-origin', signal });
    return earlyHeld().then((held) => (!held ? fetch(earlyListed.url, { credentials: 'same-origin', signal })
      : fetch(earlyListed.url + '?v=' + earlyListed.sha1, { cache: 'only-if-cached', mode: 'same-origin', signal })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); earlyFrom = "browser's HTTP cache"; return r; })
        .catch(() => fetch(earlyListed.url, { credentials: 'same-origin', signal }))));
  };
  // the game's module as the stop card names it (wasm-play.js stopLead: a compile error of a module cut short)
  window.ueModuleFile = earlyListed ? earlyListed.url : '';
  // The bytes the fallback compiles are checked against the list first: a host that has the module cut short (an upload that
  // stopped) or not at all is named on the card as a missing file (wasm-play.js noteFileProblem), not as the raw CompileError
  // (an HTTP error is told before its body is read: a body that fails to arrive does not hide it)
  const moduleBytes = (r) => {
    const tell = (got) => window.ueFileProblem({ path: earlyListed.url, status: r.status || 0, expected: earlyListed.size || 0, got });
    if (!r.ok) tell(-1);
    return r.arrayBuffer().then((bytes) => {
      if (r.ok && earlyListed.size && bytes.byteLength < earlyListed.size) tell(bytes.byteLength);
      return bytes;
    });
  };
  const earlyModule = earlyListed && query.get('wasmearly') !== '0' && WebAssembly.compileStreaming && (cached || !splitFiles.length)
    ? WebAssembly.compileStreaming(earlyResponse()).catch((e) => {
      // a stop aborted the module's load (stopLoads): it is not loaded again
      if (loadsStopped) { console.log('PAGE WASM_EARLY stopped: ' + e); throw e; }
      console.log('PAGE WASM_EARLY compile failed, compiling from bytes: ' + e);
      // a module that differs from the list (the data cache's read of it errored, then it refuses it): the page stops
      // (the page's stop aborts this fetch too: stopLoads)
      return fetch(earlyListed.url, { credentials: 'same-origin', ...(pageLoads ? { signal: pageLoads.signal } : {}) }).then((r) => {
        const m = mismatchOf(r);
        if (m) { onMismatch(m); throw Object.assign(new Error('the game module differs from wasm-cache.json'), { mismatch: true }); }
        return moduleBytes(r);
      }).then((bytes) => WebAssembly.compile(bytes));
    })
    : null;
  if (earlyModule) {
    console.log('LOADTIME wasm_early ' + Math.round(performance.now()) + ' ' + earlyListed.url);
    earlyModule.then(() => {
      console.log('PAGE WASM_EARLY compiled from the ' + earlyFrom);
      // The module exists now (the engine's instance and the pthread Workers use it; the browser keeps its own copy of the
      // bytes in it): the data cache detaches the downloaded chunks it handed this compile (sw.js moduleCompiled) instead of
      // waiting for its 15 s fallback. Nothing on this page keeps the response or its bytes
      const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (cached && controller) controller.postMessage({ type: 'module-compiled', url: new URL(earlyListed.url, swScope || location.href).href });
    }, () => {});
  }
  if (!cached && splitFiles.length) {
    fail('This site splits large game files into parts, which only the page\'s data cache (service worker) can join, and it is not running'
      + (query.get('sw') === '0' ? ' (?sw=0 turned it off)' : '') + '. Reload the page; if this repeats, the site needs to send the files whole. First: ' + splitFiles[0].url);
    return;
  }
  // Progress: sw.js reports each whole-file load; the total is the game's binaries and containers, counted as they travel: a
  // file's Brotli size ("br" in wasm-cache.json, 0 for one served as it is), so the page counts wire bytes, not unpacked
  // bytes. sw.js reports unpacked bytes, scaled here by each file's ratio. The later pak chunks' containers (wasm-cache.json
  // "late": true, as sw.js isLate) load after the game is ready, in the background, so the step and the bar count the start-up
  // bytes only. The late text pak too (61 MB on Lyra): counted here, the total was reached only after ready on every cold visit
  // A tier's start files (its shader container below Content/TierPaks, its loose global shaders and pipeline list: sw.js
  // tierStartFiles) are counted once the page has picked that tier (countTier): the worker loads them with the start-up data, and
  // no other tier's
  const late = (f) => !!f.late;
  window.ueStageFiles = files.filter((f) => /\/Binaries\/Wasm\//.test(f.url)).map((f) => ({ url: f.url, sha1: f.sha1 }));   // for error reports
  const needed = files.filter(f => (/\/Binaries\/Wasm\/[^/]+\.(js|wasm)$/.test(f.url) || /\/Content\/Paks\//.test(f.url)) && !late(f));
  const wire = f => f.br || f.size;
  let total = needed.reduce((sum, f) => sum + wire(f), 0);
  const byUrl = new Map(needed.map(f => [new URL(f.url, location.href).href, f]));
  const loaded = new Map();
  let downloaded = false;
  ueSteps.set('download', 'active', total ? megabytes(total) + ' MB' : '');
  // The start-up download as counted here, for the pipeline hold (wasm-play.js pipelineHold): wire bytes in of the total, the
  // bytes that came over the network (not from this browser's cache) and when the last count arrived; none without the worker
  const boot = window.ueBootDownload = cached && total ? { total, bytes: 0, netBytes: 0, since: timings.sw || 0, at: 0 } : null;
  // The picked tier's start files count from the pick on, the same set the worker loads then (sw.js tierStartFiles: the tier's
  // container below Content/TierPaks and its loose GlobalShaderCache-, ShaderArchive-Global- and PipelinePrewarm- files), so the
  // step and the bar count what a start downloads before its first frame
  const tierStart = (f, tier) => f.tier === tier && !f.late && (/\/Content\/TierPaks\//.test(f.url)
    || /^(?:GlobalShaderCache-|ShaderArchive-Global-|PipelinePrewarm-)/i.test(f.url.split('/').pop()));
  countTier = (tier) => {
    const added = files.filter((f) => tierStart(f, tier) && !byUrl.has(new URL(f.url, location.href).href));
    for (const f of added) { byUrl.set(new URL(f.url, location.href).href, f); total += wire(f); }
    if (!added.length) return;
    downloaded = false;
    if (boot) boot.total = total;
  };
  if (cached) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'log') { console.log(data.text); return; }
      if (data.type === 'mismatch') return;   // the listener above (this page's own files only)
      // The worker could not keep the files (storage full) or was turned off by the host
      if (data.type === 'storage-low') { notice(T('This browser has no room to keep the game, so it downloads again on the next visit.')); return; }
      if (data.type === 'sw-off') { console.log('PAGE SW_OFF: the data cache is off for this site; this load runs uncached'); return; }
      if (data.type !== 'progress') return;
      const f = byUrl.get(data.url);
      if (!f) return;
      const before = loaded.get(data.url) || 0;
      loaded.set(data.url, f.size ? Math.min(data.loaded, f.size) * wire(f) / f.size : 0);
      const sum = [...loaded.values()].reduce((a, b) => a + b, 0);
      if (boot) { boot.bytes = sum; if (!data.cached) boot.netBytes += Math.max(0, loaded.get(data.url) - before); boot.at = performance.now(); }
      if (!total || downloaded) return;
      downloaded = sum >= 0.999 * total;
      progress(`Downloading ${megabytes(sum)} of ${megabytes(total)} MB` + (data.cached ? ' (from this browser)' : ''), 0.05 + 0.7 * sum / total, downloaded ? 'downloaded' : 'download');
      ueSteps.set('download', downloaded ? 'done' : 'active', `${megabytes(sum)} of ${megabytes(total)} MB` + (data.cached ? ', from this browser' : ''));
    });
  }
  progress(cached ? 'Downloading...' : 'Downloading the game...', 0.02, cached && total ? 'download' : undefined);
  // The display's rate, measured by index.html with requestAnimationFrame (window.ueDisplayHz): the engine reads it whenever the game's
  // settings apply (FWasmPlatformMisc::GetDefaultFrameRateLimit, the limit when FrameRateLimit is 0), so it is measured first
  if (window.ueDisplayHzReady) await Promise.race([window.ueDisplayHzReady, new Promise((r) => setTimeout(r, 1000))]);
  // A device profile's frame cap (wasm-profile.js fps=N, the lower of it and the display's rate) becomes a ceiling on the game's
  // frame rate: the page bridge holds t.MaxFPS at or below it (WasmPageBridge.cpp ApplyWebStartSettings), so the game's own
  // settings updates cannot lift it, where a t.MaxFPS value alone was undone during start-up. Shipping too
  if (profile && profile.fps) defaults.push('-WebFrameRateLimit=' + Math.min(profile.fps, window.ueDisplayHz || profile.fps));
  // The stage's UECommandLine.txt (UAT writes it: the map and the project's arguments), as a native game reads it. The query's
  // arguments go first: UE takes a map only from the first token and reads a flag's first occurrence, so ?args=/Game/Maps/X
  // opens that map and a query flag overrides a staged one or a default. -project= is left out for a game built for its
  // project; a Blueprint-only project runs the engine's UnrealGame, which has no project of its own and reads it from
  // -project= (the staged ../../../<Project>/<Project>.uproject, a path in the page's file system)
  const staged = await fetch('UECommandLine.txt', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const engineGame = pageMeta('ue-game') === 'UnrealGame';
  const stagedArgs = splitArgs(staged).filter((a) => engineGame || !/^-project=/i.test(a));
  const queryArgs = linkArgs(splitArgs(query.get('args') || ''));
  // (a tier switch written with '/', such as ?args=/WebGPUSM5, is a switch, not a map: the engine reads it as one)
  const isMap = (a) => a && !a.startsWith('-') && !/^\/webgpu(no)?(sm5|mobiledeferred)$/i.test(a);
  const map = isMap(queryArgs[0]) ? queryArgs.shift() : isMap(stagedArgs[0]) ? stagedArgs.shift() : null;
  if (isMap(stagedArgs[0])) stagedArgs.shift();
  if (staged) console.log('LOADTIME staged_cmdline ' + Math.round(performance.now()) + ' ' + staged.trim());
  // window.ueExtraArgs: arguments a page script adds before the game starts (an intro shell, a bench)
  // The browser's language for the engine (navigator.language is not readable from the engine's pthreads), unless
  // the link or the stage names a culture. As a default the engine applies only when the player has no saved
  // culture (WasmPage: -WebBrowserLang); -culture= would override the player's choice on every visit
  if (![...queryArgs, ...stagedArgs, ...defaults].some((a) => /^-culture=/i.test(a)) && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(navigator.language || '')) defaults.push('-WebBrowserLang=' + navigator.language);
  // An intro shell sets window.ueExtraArgs; wait for its script (at most 3 s) so a cached load does not
  // build the command line before it ran
  if (window.ueShellReady) await Promise.race([window.ueShellReady, new Promise((r) => setTimeout(r, 3000))]);
  // After this tab's GPU fallback the pick's forward switches decide the tier: a tier switch from anywhere else is dropped
  // (wasm-compat.js dropTierSwitches, UE-414087), so the start runs the forward renderer its toast names
  const outside = (list, where) => (window.ueCompat && window.ueCompat.dropTierSwitches ? window.ueCompat.dropTierSwitches(list, where) : list);
  const args = (map ? outside([map], 'the map argument') : []).concat(outside(queryArgs, "the link's ?args="), outside(stagedArgs, 'the staged command line'),
    outside(window.ueExtraArgs || [], 'window.ueExtraArgs'), outside(defaults, "the page's ue-args"), outside(profileIni, 'the device profile'),
    // -ForceRes: the display metrics report r.SetRes' 1280x720, so without it the engine picked a smaller window (888x500);
    // the canvas is already at its density (ue-max-dpr, or ue-touch-dpr on a touch screen)
    ['-resx=' + canvas.width, '-resy=' + canvas.height, '-windowed', '-ForceRes'],
    // the harness's own arguments (wasm-harness.js: the page's time origin for the engine's boot markers)
    (window.__harness && window.__harness.ueArgs) || []);
  resolveEngineArgs(args.slice());
  window.Module = {
    arguments: args,
    // the module compiled since the page started it (above); Emscripten passes the imports and takes the instance
    ...(earlyModule ? { instantiateWasm: (imports, done) => {
      // (a module that differs from wasm-cache.json has stopped the page already: onMismatch)
      earlyModule.then((module) => WebAssembly.instantiate(module, imports).then((instance) => done(instance, module)))
        .catch((e) => { if (e && e.mismatch) return; console.log('HARNESS ABORT wasm instantiate: ' + e); fail('The game could not start: ' + e); });
      return {};
    } } : {}),
    canvas: canvas,
    // the exact factor the canvas was sized with above: the engine sizes the canvas and maps pointer and touch coordinates with
    // it for the page's life (WasmApplication.cpp), so a turn of the phone during loading cannot change it (UE-411884)
    canvasScale: dpr,
    // a touch screen's canvas denser than ue-max-dpr: the 3D scene's share of it (r.SecondaryScreenPercentage.GameViewport)
    ...(dpr > sceneDpr ? { sceneScale: sceneDpr / dpr } : {}),
    wasmManifest: manifest.map(e => ({ path: e.path, url: e.url, size: e.size, late: e.late })),   // late: the small-chunk fetch backend
    locateFile: (file) => project + '/Binaries/Wasm/' + file,
    print: t => {
      mark('first_print');
      rememberLine(t);   // the last engine lines for an error report
      if (!logPrinting) logPrinting = true;   // this build's log reaches the page, so the cover waits for the ready line
      const failure = classifyLine(t);
      if (failure) failKind(failure, t);
      // The ready line (wasm-play.js): 'UE_RUN READY' from the engine's page bridge; the older names for one release
      if (t.includes('UE_RUN HOLD') || t.includes('UE_RUN SETTLED')) pipelineHold.line(t);   // the pipeline hold (wasm-play.js)
      // the game's own ready signal (wasm-play.js readySignal, <meta name="ue-ready" content="game">)
      if (t.includes('UE_RUN GAME_READY_EXPECTED')) readySignal.expect();
      else if (t.includes('UE_RUN GAME_READY')) readySignal.signal();
      if (t.includes('UE_RUN READY') || t.includes('LOADING_READY'))
      {
        mark('ready_line');
        markPrimed();
        gameReady();
        // the game is up: the later pak chunks' containers load now (sw.js 'prefetch-late')
        postLate();
      }
      console.log(t);
    },
    printErr: t => {
      rememberLine(t);
      crashNote('err', t);   // the JavaScript stack of a crash, for the crash report (wasm-play.js)
      const failure = classifyLine(t);
      if (failure) failKind(failure, t);
      // a trap or an abort that ends a pthread reaches this thread only as these lines (Build/Link/wasm_crash.js, Emscripten):
      // with error reports on (an endpoint, crashUrl in wasm-play.js), a stop with its card, so the report goes; without, the
      // page goes on as before
      else if (!crashUrl()) { /* error reports off */ }
      // (a wasm trap or an abort only, which leave the module's state undefined: a JavaScript exception in a pthread's callback
      // is recorded for a later report, and the game goes on)
      else if (t.startsWith('UE_CRASH_STACK ')) {
        let m = ''; try { m = String(JSON.parse(t.slice(15)).message || ''); } catch (e) { m = ''; }
        if (crashStackFatal(t)) fail(m || 'A game thread stopped with an error.');
      }
      // (Emscripten's own "worker sent an error!" line for the same exception stops nothing: the hook's line above decides)
      console.error(t);
    },
    onAbort: m => { console.log('HARNESS ABORT ' + m); crashNote('abort', m); fail(String(m || 'aborted')); },
    // Emscripten's exit (the engine called exit after RequestExit) ends the game like 'ue-exit'
    onExit: code => gameEnded(Number(code) || 0),
    setStatus: t => { status.textContent = t; },
    // The files are in and the runtime is up; the engine now starts and loads the startup level under the cover (siteStarted,
    // wasm-play.js). No page fallback for the late chunks here: sw.js releases them 20 s after the boot containers
    onRuntimeInitialized: () => {
      mark('runtime');
      if (!cached) ueSteps.set('download', 'done', total ? megabytes(total) + ' MB' : '');   // no worker, no byte counts
      ueSteps.set('engine', 'done', ueSteps.took('engine'));
      progress('Loading the level...', 0.8);
      siteStarted(/firefox/i.test(navigator.userAgent) ? 12 : 4);
    },
  };
  window.addEventListener('error', (event) => {
    if (!event.message || !/Aborted|RuntimeError/.test(event.message)) return;
    crashNote('error', event.error && event.error.stack ? event.error.stack : event.message);
    fail(event.message);
  });
  // a trap in a promise callback on this thread (a WebGPU callback, the module's start): the game's own, an abort or a
  // WebAssembly.RuntimeError (a trap, or Emscripten's abort; a JavaScript error is not the game's crash). Only with error reports
  // on (crashUrl), as a pthread's stop above
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // (WebAssembly.RuntimeError, else by its name where the constructor is not there)
    const runtimeError = typeof WebAssembly === 'object' && typeof WebAssembly.RuntimeError === 'function' ? WebAssembly.RuntimeError : null;
    if (!reason || !crashUrl() || !(runtimeError ? reason instanceof runtimeError : reason.name === 'RuntimeError')) return;
    if (!(/Aborted\(/.test(String(reason)) || /wasm-function\[/.test(String(reason.stack || '')))) return;
    crashNote('error', reason.stack ? String(reason) + '\n' + reason.stack : String(reason));
    fail(String(reason));
  });
  const gpu = await gpuProbe;
  if (gpu.message) {
    fail(gpu.message, window.ueBench ? undefined : (gpu.kind || 'gpu'));   // (a bench page's own message is no GPU stop)

    return;
  }
  for (const warning of window.ueCompat && window.ueCompat.warnings ? window.ueCompat.warnings(gpu.adapter) : []) console.log('WEB_COMPAT warning: ' + warning);
  const script = document.createElement('script');
  // The game's script: <Game>.js (Development) or <Game>-Wasm-<Config>.js, as wasm-cache.json lists it
  // (by name, not the first .js there, which could be a worklet or worker script). <Game> is the game
  // target's name (ue-game, e.g. LyraGame for project Lyra); a page staged without it uses the project's name
  const gameMeta = pageMeta('ue-game');
  const game = gameMeta && !gameMeta.startsWith('%') ? gameMeta : project;
  const scriptName = new RegExp('^' + game.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:-Wasm-[A-Za-z]+)?\\.js$');
  const listed = files.find(f => f.url.startsWith(project + '/Binaries/Wasm/') && scriptName.test(f.url.split('/').pop()));
  // Without the listing (the host's kill switch {"sw":"off"}, or a stage packaged before wasm-cache.json) the page does not know
  // the script's -Wasm-<Config> suffix: it asks for each name (HEAD), <Game>.js first, and keeps the one the host has (a
  // Shipping stage's <Game>.js is a 404, UE-412638). A host that refuses HEAD (not a 404) leaves <Game>.js, as before
  let scriptUrl = listed ? listed.url : null;
  // (a HEAD that does not settle within 5 s ends the search like a refused one: a stalled host does not hold the start)
  const probeWait = () => new Promise((resolve) => setTimeout(() => resolve(0), 5000));
  for (const config of listed ? [] : ['', 'Shipping', 'Test', 'DebugGame']) {
    const url = project + '/Binaries/Wasm/' + game + (config ? '-Wasm-' + config : '') + '.js';
    const status = await Promise.race([fetch(url, { method: 'HEAD', cache: 'no-cache' }).then((r) => (r.ok ? 200 : r.status), () => 0), probeWait()]);
    if (status === 200) { scriptUrl = url; break; }
    if (status !== 404) break;
  }
  if (!scriptUrl) scriptUrl = project + '/Binaries/Wasm/' + game + '.js';
  if (!listed) {
    console.log('PAGE SCRIPT unlisted: ' + scriptUrl);
    window.ueStageFiles.push({ url: scriptUrl });   // the error report and wasm-memory.js see the script's configuration
  }
  // Fetch the game script once and hand the same Blob URL to every pthread Worker (Module.mainScriptUrlOrBlob): the pool
  // otherwise refetches it per Worker (56 x 273 KB on one game). ?blob=0 loads it by URL
  script.src = scriptUrl;
  let scriptText = null;   // the game script, where the page read it (a device profile's memory checks the glue takes it)
  let firstDiffers = null;   // {size, sha1} of a first glue body that differed: a second fetch that fails then stops the page too
  if (query.get('blob') !== '0') {
    try {
      let response = await fetch(scriptUrl);
      if (mismatchOf(response)) { onMismatch(mismatchOf(response)); return; }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      let bytes = await response.arrayBuffer();
      // the page's own check (a load without the data cache, or one whose worker read the script from the network): once more
      // with cache: 'reload', then no script that still differs runs
      let got = await bodyDiffers(bytes, listed);
      if (got) {
        firstDiffers = got;
        console.log(`PAGE MISMATCH ${scriptUrl}: ${got.size} bytes sha1 ${got.sha1}, the list says ${listed.size} bytes sha1 ${listed.sha1}; fetching it again (cache: reload)`);
        response = await fetch(scriptUrl, { cache: 'reload' });
        if (mismatchOf(response)) { onMismatch(mismatchOf(response)); return; }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        bytes = await response.arrayBuffer();
        got = await bodyDiffers(bytes, listed);
        if (got) { onMismatch({ kind: 'code', url: new URL(scriptUrl, location.href).href, size: listed.size, sha1: listed.sha1, got }); return; }
      }
      const text = scriptText = new TextDecoder().decode(bytes);
      // A script linked without mainScriptUrlOrBlob in INCOMING_MODULE_JS_API does not read it, and its ASSERTIONS build aborts
      // when the property is set (ignoredModuleProp("mainScriptUrlOrBlob")): use the Blob only for a script that reads it
      const readsBlob = /Module\[["']mainScriptUrlOrBlob["']\]|Module\.mainScriptUrlOrBlob\b/.test(text)
        && !/ignoredModuleProp\(["']mainScriptUrlOrBlob["']\)/.test(text);
      if (readsBlob) {
        script.src = window.Module.mainScriptUrlOrBlob = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      }
    } catch (e) {
      if (firstDiffers) {
        console.log(`PAGE MISMATCH ${scriptUrl}: the second fetch failed (${e}); the script that differed is not run`);
        onMismatch({ kind: 'code', url: new URL(scriptUrl, location.href).href, size: listed.size, sha1: listed.sha1, got: firstDiffers });
        return;
      }
      console.log('game script Blob unavailable, loading by URL: ' + e);
    }
  }
  script.onload = async () => {
    mark('script');
    ueSteps.set('engine', 'active');
    coverTo('engine');
    progress('Starting the engine...', 0.76);
    // a throw in the GPU check (or a bench script) starts the game with the defaults instead of stopping silently
    let picked = [];
    try { picked = await startArgs; } catch (e) { console.log('WEB_COMPAT start arguments failed, using the defaults: ' + e); }
    // the pick's task-graph worker count (wasm-compat.js workerCap) gives way to a count the page's own arguments or a staged
    // wasm-bench.js already name, whatever their order (the engine reads the first -WebWorkerThreads=, in any case)
    const namesCount = (list) => Array.isArray(list) && list.some((a) => /^-WebWorkerThreads=/i.test(a));
    if (namesCount(window.Module.arguments) || namesCount(window.ueBench && window.ueBench.args)) picked = picked.filter((a) => !/^-WebWorkerThreads=/i.test(a));
    window.Module.arguments.push(...picked);
    if (window.ueBench && window.ueBench.args) window.Module.arguments.push(...outside(window.ueBench.args, 'wasm-bench.js'));   // a staged wasm-bench.js
    // The device wasm-prewarm.js made during the download, for the engine's WebGPU RHI to take (it checks the device has what
    // it would request itself); not ready within 2 s, the RHI requests its own
    if (window.uePrewarm) {
      const device = await window.uePrewarm.device(2000);
      if (device) window.Module.preinitializedWebGPUDevice = device;
    }
    // A device profile's fixed memory (wasm-profile.js), only for a game script the page read that takes it: a glue linked with
    // wasmMemory in INCOMING_MODULE_JS_API reads it (wasmMemory = Module["wasmMemory"]); one linked without it ignores it (with
    // ASSERTIONS it aborts), so any other glue gets none and makes its own memory, as before
    // (only wasm-profile.js's own profile has these members; a profile object a page script made has neither)
    if (profile && Array.isArray(profile.memoryPages) && profile.memoryPages.length && typeof profile.applyMemory === 'function') {
      const takes = scriptText !== null && /\bwasmMemory\s*=\s*Module\s*(?:\[\s*["']wasmMemory["']\s*\]|\.wasmMemory\b)/.test(scriptText);
      if (!takes) console.log('PAGE PROFILE memory not applied: ' + (scriptText === null ? 'the page did not read the game script (?blob=0)' : 'this build does not take a page memory'));
      else profile.applyMemory(window.Module, { lowered: pageMeta('ue-memory64') === 'lowered' });
    }
    if (profile && (profile.configured || profile.forced) && typeof profile.describe === 'function') {
      try { console.log(profile.describe()); } catch (e) { console.log('PAGE PROFILE ' + profile.name + ': its settings could not be printed: ' + e); }
    }
    if (codeStopped) return;   // a code file differed while the script loaded (onMismatch has stopped the page)
    // (a start-up error's stack goes to the crash report, as a trap's does: crashNote, wasm-play.js)
    const startFailed = (e) => { if (e && e.stack) crashNote('start', String(e) + '\n' + e.stack); fail(String(e)); };
    try { createUEModule(window.Module).catch(startFailed); } catch (e) { startFailed(e); }
  };
  script.onerror = () => fail('The game script could not be loaded: ' + script.src);
  if (codeStopped) return;
  document.body.appendChild(script);
})();
