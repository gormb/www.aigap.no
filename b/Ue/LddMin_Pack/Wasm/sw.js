// The game's data cache. Serves the game's binaries and the files of
// wasm-manifest.json from Cache Storage, keyed by each file's sha1, and answers the fetch backend's range reads from the
// cached copy. A file not yet cached is fetched whole once (Brotli at transport where the host has it) and its reads wait
// for that copy. A second visit fetches only the page, the manifests and this script.
// wasm-cache.json (UAT, WasmPlatform.Automation.cs) lists the files: {url, size, sha1, br}.
// one cache per page scope (two games on one origin no longer prune each other's files); v1 was one name for
// the whole origin and is removed when this worker activates
const SW_VERSION = 2;
const CACHE = 'ue-data-v2:' + new URL(self.registration.scope).pathname;
const OLD_CACHES = ['ue-data-v1'];
// wasm-cache.json replaced by {"sw": "off"} on the host turns the worker off for every visitor: it deletes this scope's
// cache, unregisters, and the page loads uncached (the kill switch for a broken worker)
let killed = false;
// Storage: a fill that would not fit the origin's quota is not started; the file is read from the network (the page tells
// the player once, 'storage-low')
let storageLow = false;
let manifestPromise = null;
// the fetch handler opened this scope's cache for every request (325 CacheStorage::Open
// round trips to the browser on a warm Lyra visit, one per engine read); the handle is kept for the worker's life
let cacheHandle = null;
const openCache = () => cacheHandle || (cacheHandle = caches.open(CACHE).catch((e) => { cacheHandle = null; throw e; }));
const pending = new Map();  // url -> promise of the cached Response
const writes = new Map();   // url?v=sha1 -> its whole-file load's cache writes, settled (fill), until they end
const errors = [];
const blobs = new Map();
// (the game's first pakchunk0.ucas read, bytes 0-1 MiB, waited 967 ms for the whole 49.7 MB download, and the
// engine's init with it): a file still downloading -> what has arrived ({parts, loaded, done, wake}), so a range read is answered
// as soon as its own bytes are in
const arriving = new Map();
const starting = new Map();  // url?v=sha1 -> a promise of its arriving entry, or null once there is none (cached, failed)    // url?v=sha1 -> the cached file's Blob (disk-backed; slices are cheap)

// UE-411931: a page that stops on a card the game cannot get past here (the browser, GPU, device or site stops; wasm-loader.js
// stopLoads) posts {type: 'stop', why}. Its own loads stopped, but a whole-file load this worker ran for it went on: the .wasm
// finished, the containers started about 14 s after the card and 259 MB were stored. The stop is that page's only: the whole-file
// loads (and their staged pieces) that no other page asked for are aborted, their queued cache writes are dropped, and from then
// on that page's prefetch messages and timers start nothing, its reads start no load and store nothing (they are answered from
// what is cached or loading, else from the network, a code file checked as one this worker cannot store: uncachedCode), and its
// module copy into the HTTP cache is aborted. Other pages' loads, reads and writes go on; what an aborted load stored is left to
// the next visit (an index entry is written last, so a partial file is never read, and its pieces are reused or pruned)
const stoppedPages = new Set();   // window client ids
// (only a window counts as a page: one that is bound, or has posted this worker a message (its 'bind' is posted before its reads, and
// is recorded before bind() has stored it); a Worker's requests are '', a client that never stops, since this worker cannot be sure
// which page a Worker belongs to)
const windowIds = new Set();   // window client ids that posted a message
const pageOf = (clientId) => (clientId && (bound.has(clientId) || windowIds.has(clientId) || stoppedPages.has(clientId)) ? clientId : '');
// url?v=sha1 -> {abort, pages, settled}: a whole-file load's (or its staged pieces') AbortController, the pages that asked for it
// ('' for a client this worker cannot tie to a page, which never stops), and a promise of the end of the load, its cache writes
// and its deletions. A stop aborts a load once every page in it has stopped; it stays here, aborted (so a fetch it makes later is
// aborted too), until it has settled, and a new load of the file waits for that (fill)
const loads = new Map();
function interest(key, page) {
  let load = loads.get(key);
  if (!load) loads.set(key, load = { abort: typeof AbortController === 'function' ? new AbortController() : null, pages: new Set(), settled: null });
  if (!loadAborted(load)) load.pages.add(page || '');
  return load;
}
const loadAborted = (load) => !!(load && load.abort && load.abort.signal.aborted);
// a load's fetch options, with its stop signal
const signalled = (key, init) => { const load = loads.get(key); return load && load.abort ? { ...init, signal: load.abort.signal } : init; };
const pageAborts = new Map();   // page -> the AbortController of its module copy into the HTTP cache (fillHttpCache)
function stopLoads(page, why) {
  if (!page) return;
  stoppedPages.add(page);
  if (pageAborts.has(page)) pageAborts.get(page).abort();
  const aborted = [];
  for (const [key, load] of [...loads]) {
    if (loadAborted(load) || ![...load.pages].every((id) => stoppedPages.has(id))) continue;
    if (load.abort) load.abort.abort();
    for (const piece of [...tails.keys()]) if (piece.startsWith(key + '#')) tails.delete(piece);
    if (!load.settled) loads.delete(key);   // (staged pieces only: no load to settle)
    if (pending.has(key)) aborted.push(key.split('?')[0].split('/').pop());
  }
  post({ type: 'log', text: `SW STOP ${why || 'page'}: ${aborted.length} load(s) of this page aborted${aborted.length ? ' (' + aborted.join(', ') + ')' : ''}; it starts no load and stores nothing from now on` });
}
// a page's load: none for a page that stopped
const fillFor = (page, url, entry) => fill(url, entry, page);
self.addEventListener('install', () => self.skipWaiting());
// the page asks for every game file at once, before the engine asks for any of them, so the
// downloads overlap the wasm compile and the engine's start (the wasm and script first, then the containers)
// containers of later pak chunks (pakchunk1 and up: audio, unused attachments) are not needed before
// the level, so they stay out of the start-up prefetch; until the page says the level is up ('prefetch-late', at
// LOADING_READY), the engine's reads of them go to the network as plain ranges instead of waiting for the whole file
// only the later chunks' .ucas waits; their .pak and .utoc (a few KB) load with the start-up data, so the
// engine's mount of late/ (after pakchunk0's, whose .ucas it waits for) reads them from the cache instead of the network
// The optional containers (pakchunk<N>optional: for example textures' top mips) are late too, and so is the late text pak:
// BaseWasmPakFileRules.ini [WasmLateText] puts the text and fonts a first visit does not read there (Lyra: 64 MB of Brotli).
// UAT tags each of these "late": true in wasm-cache.json (WasmPlatform.Automation.cs IsLate); the page never matches chunk
// numbers. A tier's container is late only where it is a cold shader container's code (isTierContainer)
const isLate = (entry) => !!(entry && entry.late);
// A tier's shader container (BaseWasmPakFileRules.ini [WasmForwardTierContainer], [WasmDeferredTierContainer]: each mobile tier's
// shader libraries in a container of their own, so the first chunk's container carries neither tier's): UAT stages it below
// Content/TierPaks/<tier>/Paks/ (or a texture set's folder below that), outside the boot-time pak scan, and tags its .ucas, .utoc and
// .pak "tier": "forward" or "deferred" (WasmPlatform.Automation.cs TierOf). The engine mounts only the running tier's container,
// once its WebGPU RHI has made the final tier decision (WebGPUDevice.cpp), so no start reads another tier's container. None of
// them is shared start-up data: the page's pick loads its own tier's container whole (prefetchTier, tierStartFiles); a read of
// another tier's container (the RHI fell back from the pick) starts that file's one whole-file load
// A tier's cold shader container (Content/TierPaks/<tier>/Cold/Paks, tagged "cold"; BaseWasmPakFileRules.ini [WasmForwardTierCold],
// [WasmDeferredTierCold]) is one of these too, the one tier container that is late: its .pak and .utoc load at the pick with the
// tier's container (the RHI mounts both), its code (.ucas, "late") only after this page's late release (prefetchLate), and nothing
// reads it ahead (tierStartFiles skips late files)
const isTierContainer = (url, entry) => !!(entry && entry.tier) && /\/Content\/TierPaks\//.test(url);
// The tier each page picked, by its bound file list (manifestFor: one map per page), for the warm release that waits for that
// tier's start files and for the tier-tagged late files of a ready release whose message names no known tier (a page from before
// 'prefetch-late' carried one; a worker restarted since the pick has lost this). A fallback's re-post (wasm-loader.js, the
// RHI's 'ue-webgpu-tier' event) replaces the pick, so at ready this is the tier the RHI runs. Per page, not per worker: one worker serves every open page and its I/O workers, and another page of the
// site may have picked another tier
const tierPicked = new WeakMap();
// The tiers whose late files a page's late release has loaded (prefetchLate at ready, or a pick or re-post after it: prefetchTier)
const lateTiers = new WeakMap();
const lateTiersLoaded = (map) => { if (!lateTiers.has(map)) lateTiers.set(map, new Set()); return lateTiers.get(map); };
// The bound file lists (pages) whose late release happened: the page's 'prefetch-late', its warm release or the worker's 20 s
// timer for it. Per page: one worker serves every page and reload of the site until it stops, and a later page's start must not
// load its late files because an earlier page was released. lateReleased only says whether any page was (the /__sw report)
const released = new WeakSet();
// The bound file lists whose page sent its ready release ('prefetch-late'): the RHI has decided its tier by then
const readyReleased = new WeakSet();
let lateReleased = false;
// Whether a request's page was released, for its reads: only a bound page's own list counts. A client with no binding gets the
// newest list (manifestFor), one map shared by every unbound client, so its release would say nothing about this client's page
const releasedPage = (map) => released.has(map) && [...bound.values()].some((b) => b.map === map);
// A page's late files: the untagged ones and its tier's (another tier's late file, such as its cold shader code, is never this
// page's); with no tier, the untagged ones
const pageLate = (map, tier) => [...map.entries()].filter(([, entry]) => isLate(entry) && (!entry.tier || entry.tier === tier));
self.addEventListener('message', (event) => {
  indexStore();   // before the first fill queues a write
  const from = event.source && event.source.id;
  if (from && event.source.type === 'window') windowIds.add(from);   // (pageOf)
  // a page this worker did not see navigate (a hard reload it then claimed) binds before it reads: the same retry as a navigation
  if (event.data && event.data.type === 'bind') retryBroken();
  if (event.data && event.data.type === 'bind' && from) event.waitUntil(bind(from, event.data.files));
  // a page that stopped on a card the game cannot get past here (wasm-loader.js stopLoads): its loads end now (stopLoads)
  if (event.data && event.data.type === 'stop') stopLoads(from, String(event.data.why || ''));
  if (event.data && event.data.type === 'prefetch') event.waitUntil(prefetch(from));
  // a page's mismatch listener is up: every mismatch so far, whether or not this page was told (it may have had no listener)
  if (event.data && event.data.type === 'mismatches' && from) {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
      const client = clients.find((c) => c.id === from);
      if (client) for (const [key, message] of mismatches) { told.add(from + ' ' + key); client.postMessage(message); }
    }).catch(() => {}));
  }
  // the ready release names the tier the page's game runs (wasm-loader.js postLate: the RHI's, else the pick)
  if (event.data && event.data.type === 'prefetch-late') event.waitUntil(prefetchLate(from, 'page', event.data.tier));
  if (event.data && event.data.type === 'prefetch-tier') event.waitUntil(prefetchTier(from, event.data.tier));
  // the page's WebAssembly.Module exists: the module's downloaded chunks that page read are detached (moduleCompiled)
  if (event.data && event.data.type === 'module-compiled' && typeof event.data.url === 'string') moduleCompiled(event.data.url, from);
  // a page's priming load: its pre-baked file (index.html ue-prime-file) loads with the start-up files
  if (event.data && event.data.type === 'prefetch-file' && typeof event.data.url === 'string') event.waitUntil(prefetchFile(from, event.data.url));
  // A hard reload (Ctrl+F5, Ctrl+Shift+R) loads the page without this worker, and its every request (the game's ~280 MB
  // of Lyra) went to the network with the files already in Cache Storage. The page asks the active worker to take it over:
  // clients.claim() controls an uncontrolled page in scope, and the files are still checked against wasm-cache.json's sha1s,
  // which the page and this worker fetch with no-cache, so a hard reload still picks up a new build. ?sw=0 bypasses the cache
  if (event.data && event.data.type === 'claim') event.waitUntil(claimUnlessBypassed(event.source));
});
// clients.claim() takes every uncontrolled page in scope, not only the one that asked: with a ?sw=0 page open it would end
// that page's bypass, so then nothing is claimed and the asking page loads uncached (as a hard reload did before).
// matchAll() returns the whole origin's pages, so only those in this worker's scope count (another stage's ?sw=0 page doesn't)
async function claimUnlessBypassed(source) {
  let pages = [];
  try { pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (e) { pages = []; }
  const scope = self.registration.scope;
  const bypassed = (page) => {
    try { return page.url.startsWith(scope) && new URL(page.url).searchParams.get('sw') === '0'; } catch (e) { return false; }
  };
  if (pages.some(bypassed)) {
    if (source) source.postMessage({ type: 'log', text: 'SW CLAIM skipped: a ?sw=0 page is open in this scope' });
    return;
  }
  await self.clients.claim();
}
// (each loose library fetched twice, about 6.3 MB more on a first visit):
// a tier's own files (tagged "tier" in wasm-cache.json: its shader container below Content/TierPaks, and its loose files, such as
// the desktop tier's libraries and every tier's pipeline list) are not in the start-up prefetch, so the engine's first reads went
// to the network before a whole-file copy existed. When the page picks a tier it names it here ('desktop', 'deferred', or
// 'mobile' for forward), and that tier's start files begin their whole-file loads before the engine reads them; no file of
// another tier loads
const TIERS = ['forward', 'deferred', 'desktop'];
const isTierFile = (url, entry, tier) => !!entry && entry.tier === tier && !isTierContainer(url, entry);
// Only the loose files the engine reads during its start are prefetched: the global shader map, the global shader library and
// the pipeline prewarm list (Lyra's desktop tier: 3 of 14 loose files, 44 of 55 MB). The project's chunk libraries and the
// cook's shader type and asset info files are not read on the way to the first frame; a read of one still loads it whole (fill)
// when it comes. The other 11 files loading alongside the start-up containers made the desktop tier's ready line 0.4 s later
// unshaped; the start files are still prefetched as early as before, since the global library is on the engine's critical path
// (waiting for the start-up containers before loading them put the ready line 1.3 s later at 300 Mbit/s)
const isTierBootFile = (url) => /^(?:GlobalShaderCache-|ShaderArchive-Global-|PipelinePrewarm-)/i.test(url.split('/').pop());
// A tier's start files: its shader container (.ucas, .utoc, .pak: the engine mounts it and opens its libraries on the way to its
// first frame) and its loose start files
// (a late file of the tier loads at this page's ready release, prefetchLate, or after a release at a fallback's re-post or at a pick
// that follows the ready release: prefetchTier)
const tierStartFiles = (map, tier) => [...map.entries()]
  .filter(([url, entry]) => (isTierContainer(url, entry) && entry.tier === tier && !isLate(entry)) || (isTierFile(url, entry, tier) && isTierBootFile(url)));
async function prefetchTier(clientId, posted) {
  if (stoppedPages.has(clientId)) return;   // (stopLoads)
  const tier = posted === 'mobile' ? 'forward' : posted;
  if (!TIERS.includes(tier)) return;
  const map = await manifestFor(clientId);
  if (stoppedPages.has(clientId)) return;   // (a stop while the list was read)
  // a second post is the re-post of a fallback: the tier the RHI runs
  const repost = tierPicked.has(map);
  tierPicked.set(map, tier);
  // a tier known to run that arrives after the late release (it skipped this tier's late files: a warm or 20 s release loads none,
  // and the page's ready release only the tier it knew then): a fallback's re-post, or any post after the page's ready release (the
  // RHI has decided by then). Its late files load now, once, and this message holds the worker until they are stored (the start
  // files below do not wait for them). A first pick after a release before ready is a guess: its tier's late files wait for ready
  let late = [];
  if (released.has(map) && (repost || readyReleased.has(map)) && !lateTiersLoaded(map).has(tier)) {
    lateTiersLoaded(map).add(tier);
    late = [...map.entries()].filter(([url, entry]) => isLate(entry) && entry.tier === tier && cacheable(url, entry));
    if (late.length) post({ type: 'log', text: `SW LATE ${tier} picked after the release: ${late.length} late files of the tier load now` });
  }
  const lateStored = Promise.all(late.map(([url, entry]) => fillFor(clientId, url, entry).then(() => writes.get(url + '?v=' + entry.sha1)).catch(() => {})));
  try {
    await prefetchTierStart(clientId, map, tier);
  } finally {
    await lateStored;
  }
}
async function prefetchTierStart(clientId, map, tier) {
  // a warm visit waits for the pick to release the late containers: only then is it known which tier's start files count. The
  // release's files are held by this message too, after the start files (which never wait for them)
  const warm = await releaseLateIfWarm(clientId, map, tier);
  try {
    await loadTierStart(clientId, map, tier);
  } finally {
    if (warm) await warm.release;
  }
}
async function loadTierStart(clientId, map, tier) {
  // the game's script and wasm loads end first (Chrome failed the wasm read with net::ERR_BLOB_OUT_OF_MEMORY when these files
  // loaded alongside it); the page posts after the wasm compiled, so this only holds a page that posts earlier
  const code = [...map.entries()].filter(([url]) => /\/Binaries\/Wasm\/[^/]+\.(js|wasm)$/.test(url))
    .map(([url, entry]) => pending.get(url + '?v=' + entry.sha1)).filter(Boolean);
  if (code.length) {
    post({ type: 'log', text: `SW TIER ${tier} waits for ${code.length} code loads` });
    await Promise.all(code);
  }
  const files = tierStartFiles(map, tier).filter(([url, entry]) => cacheable(url, entry));
  const later = [...map.entries()].filter(([url, entry]) => entry.tier === tier && !files.some(([u]) => u === url));
  if (!files.length && !later.length) return;
  post({ type: 'log', text: `SW TIER ${tier}: ${files.length} start files (${files.map(([url]) => url.split('/').pop()).join(', ')}); ` +
    `${later.length} more load when read` });
  await Promise.all(files.map(([url, entry]) => fillIfRoom(clientId, url, entry)));
}
// A tier's start file loads when it is stored already or its load is under way or done in this worker (no room needed), or when
// it fits. The room check only asks (fits(..., false)): a prefetch that finds no room skips the file, which then loads when read,
// and never marks the storage low for every later file (an estimate taken while another load writes can be stale). It resolves
// once the file's cache writes are done too, so the message event that waits for it (waitUntil) holds the worker until then
async function fillIfRoom(page, url, entry) {
  const key = url + '?v=' + entry.sha1;
  const loading = () => pending.has(key) || blobs.has(key);   // asked again after each wait: a read may start the load meanwhile
  const cache = loading() ? null : await caches.open(CACHE);
  const lookup = !!cache && !loading() && await mayBeStored(key);
  const stored = lookup && !loading() && !!(await cachedResponse(cache, key));
  if (!loading() && !stored) {
    // a load an earlier visit cut off resumes after the pieces it stored: only the rest needs room
    const kept = lookup && !entry.parts && entry.size ? (await storedPieces(cache, key)).length * CACHE_PART_BYTES : 0;
    if (!loading() && !(await fits(Math.max(0, entry.size - kept), false))) {
      post({ type: 'log', text: `SW TIER ${url.split('/').pop()} not prefetched: no room now (it loads when read)` });
      return;
    }
  }
  await fillFor(page, url, entry);
  const writing = writes.get(key);
  if (writing) await writing;
}

// Each page reads the build it booted with. The page posts the wasm-cache.json it read ('bind'); its requests,
// and those of its Workers (a Worker client is matched to its page by the time it first asks: the most recently bound live
// page), are answered from that list, so a deploy (a new list) or a worker restart never hands a running game the next
// build's files. The bindings are kept in this scope's cache (a restarted worker reads them back), and prune() keeps every
// file a live page's build still names
const INTERNAL = new URL('__ue/', self.registration.scope).href;   // this worker's own entries in the cache
const bound = new Map();         // window client id -> {map, at}
const workerPage = new Map();    // worker client id -> window client id
let bindingsRead = null;
function readBindings() {
  if (!bindingsRead) {
    bindingsRead = (async () => {
      try {
        const cache = await caches.open(CACHE);
        for (const request of await cache.keys()) {
          if (!request.url.startsWith(INTERNAL + 'bind/')) continue;
          const id = decodeURIComponent(request.url.slice((INTERNAL + 'bind/').length));
          const saved = await (await cache.match(request)).json().catch(() => null);
          if (saved && Array.isArray(saved.files) && !bound.has(id)) bound.set(id, { map: indexManifest(saved.files), at: saved.at || 0 });
        }
      } catch (e) { /* no bindings */ }
    })();
  }
  return bindingsRead;
}
async function bind(id, files) {
  if (!Array.isArray(files) || !files.length) return;
  await readBindings();
  const at = Date.now();
  bound.set(id, { map: indexManifest(files), at });
  try { await (await caches.open(CACHE)).put(INTERNAL + 'bind/' + encodeURIComponent(id), new Response(JSON.stringify({ files, at }))); } catch (e) { /* quota */ }
}
async function livePages() {
  try { return new Set((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((c) => c.id).filter(Boolean)); } catch (e) { return new Set(); }
}
// The list for a request from this client (a page or one of its Workers); the newest list when it is not bound
async function manifestFor(clientId) {
  await readBindings();
  if (clientId && bound.has(clientId)) return bound.get(clientId).map;
  if (clientId && workerPage.has(clientId) && bound.has(workerPage.get(clientId))) return bound.get(workerPage.get(clientId)).map;
  if (clientId && bound.size) {
    let client = null;
    try { client = await self.clients.get(clientId); } catch (e) { client = null; }
    if (client && client.type !== 'window') {
      const live = await livePages();
      const newest = [...bound.entries()].filter(([id]) => live.has(id)).sort((a, b) => b[1].at - a[1].at)[0];
      if (newest) { workerPage.set(clientId, newest[0]); return newest[1].map; }
    }
  }
  return manifest();
}
async function prefetchFile(clientId, url) {
  if (stoppedPages.has(clientId)) return;   // (stopLoads)
  const fill = (url, entry) => fillFor(clientId, url, entry);   // (none once this page has stopped)
  const map = await manifestFor(clientId);
  const href = new URL(url, self.registration.scope).href;
  const entry = map.get(href);
  if (!entry) { post({ type: 'log', text: 'SW PRIME not listed: ' + url }); return; }
  post({ type: 'log', text: 'SW PRIME ' + href.split('/').pop() });
  // (a load under way, or one whose download is over and whose writes are not: this page's too, room or not)
  const key = href + '?v=' + entry.sha1;
  if (pending.has(key) || (loads.has(key) && !loadAborted(loads.get(key)))) { await fill(href, entry); return; }
  if (cacheable(href, entry) && await fits(entry.size)) await fill(href, entry);
}
// from: 'page', the game is ready (the page's 'prefetch-late'); 'timer', the worker's own release 20 s after the boot containers;
// 'warm', a warm visit that releases the late containers at once, during the start. posted: the tier the page's ready release
// names ('mobile' for forward, as in 'prefetch-tier')
async function prefetchLate(clientId, from, posted) {
  if (stoppedPages.has(clientId)) return;   // (stopLoads)
  const map = await manifestFor(clientId);
  if (stoppedPages.has(clientId)) return;   // (a stop while the list was read: a shared list is not released for it)
  released.add(map);
  lateReleased = true;
  const started = from !== 'warm';
  // A late file of one tier, tagged "tier" (its cold shader code), loads with a release only at the page's ready release, for the
  // tier known then: the RHI has decided by ready, and a fallback's re-post has replaced the pick. A release before ready (a warm
  // visit's, or the worker's 20 s one) loads only the untagged late files, so a start whose RHI falls back from the pick never loads
  // the pick's cold code; the tier's late files then load at ready, or at a fallback's re-post that comes before it (prefetchTier;
  // a first pick after such a release is a guess and loads none). The tier the message names comes first: this worker may have
  // restarted since the pick (tierPicked is in its memory only); a message with no known tier (an older page) uses the pick or re-post
  const named = posted === 'mobile' ? 'forward' : posted;
  const tier = from !== 'page' ? undefined : TIERS.includes(named) ? named : tierPicked.get(map);
  if (from === 'page') readyReleased.add(map);
  const late = pageLate(map, tier);
  if (tier) lateTiersLoaded(map).add(tier);
  post({ type: 'log', text: `SW LATE released: ${late.length} files (${late.map(([url]) => url.split('/').pop()).join(', ')}), tier ${tier || 'none'}` });
  // The later chunks' containers (the gameplay maps) load first, and the late text pak's chunk (a late .pak: text and fonts a
  // visit rarely reads; 62 MB of Brotli on Lyra) after them: sharing the link with it, a first visit's travel to a map soon after
  // ready waited for that map's container (a read of a container still loading waits until its sequential load reaches the
  // offset): Lyra's front end to L_Expanse at 50 Mbit/s took 5.1 s (desktop) and 3.3 s (mobile) longer
  const chunkOf = (url) => url.split('/').pop().split('-')[0].toLowerCase();
  const textChunks = new Set(late.filter(([url]) => /\.pak$/i.test(url)).map(([url]) => chunkOf(url)));
  const textPak = ([url]) => textChunks.has(chunkOf(url));
  const wanted = late.filter(([url, entry]) => cacheable(url, entry));
  await Promise.all(wanted.filter((file) => !textPak(file)).map(([url, entry]) => fillFor(clientId, url, entry)));
  await Promise.all(wanted.filter(textPak).map(([url, entry]) => fillFor(clientId, url, entry)));
  // the message that released holds the worker until these files are stored too
  await Promise.all(wanted.map(([url, entry]) => writes.get(url + '?v=' + entry.sha1)).filter(Boolean).map((w) => w.catch(() => {})));
  // (this page's own visit: a return visit's, or a module of its list this worker's load read through the HTTP cache)
  const returning = !!storedAtStart.get(clientId);
  if (started && (returning || [...map.entries()].some(([url, entry]) => httpLoaded.has(url + '?v=' + entry.sha1)))) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await fillHttpCache(map, clientId, returning);
  }
}
// The browser keeps the code it compiled for a WebAssembly module beside the HTTP cache entry the module came from, and a
// return visit compiles the HTTP cache's copy of the game's module when there is one (wasm-loader.js). So this worker's own
// whole-file load of the module goes through the HTTP cache (force-cache, viaHttpCache): the one download of the first visit
// leaves the browser its copy too. 5 s after that visit's ready this worker checks whether the browser kept it and records
// the answer, so the next visit compiles the HTTP cache's copy, and a module the browser did not keep is never downloaded
// for it again. (UE-410984: the load used no-store and the copy was made by a second download of the whole module, 5 s after
// the first return visit's ready.) Its URL carries the file's
// sha1, so a cached copy is always current. A module an earlier worker stored without that copy (its load used no-store, or
// the load resumed: a Range answer is not the whole file) is copied as before: one download, on its first return visit, at idle
// The outcome is kept in this scope's cache (HTTP_COPY), so each copy is made once per module and browser profile, not on every
// worker start (UE-410984: the in-memory record of earlier builds was lost with each worker, and every return visit downloaded
// the module again): {held: {sha1: bytes} of modules the HTTP cache kept, refused: {sha1: bytes} of those it did not keep, limit:
// the smallest size a copy's download found it did not keep} (bytes: the response's Content-Length, the size the HTTP cache keeps).
// The copy is checked with only-if-cached at once: Chrome drops an entry over its per-entry limit (an eighth of its cache size,
// which it sizes per machine) without an error. Measured, Chrome 157 on Linux: --disk-cache-size 320 MB kept 40 MB and not 45 MB,
// 200 MB kept 25 MB and not 30 MB, the default kept 100 MB and not 150 MB; the reporter's Chrome 156 kept 30 MB and not 45 MB, so
// Lyra's 44.5 MB module fits on one machine and not on another, and no fixed size can stand for the limit. A refused module is
// not tried again, and no module as large as one a copy's download found refused is copied (its own load through the HTTP
// cache is still checked: that costs no download). The page asks the HTTP cache only for a
// module this record holds (wasm-loader.js earlyResponse: an only-if-cached miss is a red console error in Chrome)
const isWasm = (url) => /\/Binaries\/Wasm\/[^/]+\.wasm$/.test(url);
const storedAtStart = new Map();   // page -> its prefetch found its module in Cache Storage (a return visit)
const httpCopied = new Set();    // url?v=sha1 of modules this worker has dealt with (copied, found, refused), or whose copy is under way
const httpLoaded = new Map();    // url?v=sha1 -> wire bytes of modules whose whole body this worker's own load read through the HTTP cache
// the game's module, whole and unsplit (a file in parts or staged pieces has no single HTTP cache entry to compile from)
const viaHttpCache = (url, entry) => isWasm(url) && !entry.parts && !entry.body;
const HTTP_COPY = INTERNAL + 'http-copy';
async function readHttpCopy() {
  try {
    const stored = await (await openCache()).match(HTTP_COPY);
    const record = stored ? await stored.json() : null;
    const map = (name) => (record && record[name] && typeof record[name] === 'object' ? record[name] : {});
    return { held: map('held'), refused: map('refused'), limit: (record && Number(record.limit)) || 0 };
  } catch (e) { return { held: {}, refused: {}, limit: 0 }; }
}
// (one write at a time in this worker: each merges with what the one before it stored)
let httpCopyWrite = Promise.resolve();
const writeHttpCopy = (record, map) => (httpCopyWrite = httpCopyWrite.then(() => mergeHttpCopy(record, map), () => mergeHttpCopy(record, map)));
async function mergeHttpCopy(record, map) {
  // Pages of two builds can be live in one scope (prune keeps each live page's manifest), so the record is not cut to the
  // caller's list: it is merged with what is stored now (another page's write since this one read it) and keeps the newest
  // 16 modules of each kind, which bounds it across deploys
  const stored = await readHttpCopy();
  const listed = new Set([...map.values()].map((entry) => entry.sha1));
  const merged = (mine, theirs) => {
    const entries = Object.entries(theirs).filter(([sha1]) => !(sha1 in mine)).concat(Object.entries(mine));
    // this list's modules last, so they are the newest and stay
    entries.sort(([a], [b]) => Number(listed.has(a)) - Number(listed.has(b)));
    return Object.fromEntries(entries.slice(-16));
  };
  const saved = { held: merged(record.held, stored.held), refused: merged(record.refused, stored.refused), limit: Math.min(...[record.limit, stored.limit].filter((x) => x > 0), Infinity) };
  if (!Number.isFinite(saved.limit)) saved.limit = 0;
  try { await (await openCache()).put(HTTP_COPY, new Response(JSON.stringify(saved), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* quota */ }
}
const httpHeld = (key) => fetch(key, { cache: 'only-if-cached', mode: 'same-origin' })
  .then((r) => { if (r.body) r.body.cancel().catch(() => {}); return r.ok; }, () => false);
// (returning: the page's prefetch found its module stored, so a module stored without an HTTP cache copy may be copied)
async function fillHttpCache(map, page, returning) {
  let record = null;
  for (const [url, entry] of map.entries()) {
    if (!isWasm(url) || entry.parts) continue;
    const key = url + '?v=' + entry.sha1;
    if (httpCopied.has(key)) continue;
    httpCopied.add(key);
    const name = url.split('/').pop();
    const wire = entry.br || entry.size || 0;
    let done = false;
    try {
      if (!record) record = await readHttpCopy();
      const known = !!record.held[entry.sha1];
      // (a module this worker's load just read through the HTTP cache is asked about even so: the probe costs no download)
      if (!known && !httpLoaded.has(key) && (record.refused[entry.sha1] || (record.limit && wire >= record.limit))) {
        post({ type: 'log', text: `SW HTTP_COPY ${name} skipped: ${record.refused[entry.sha1] || wire} bytes, the HTTP cache did not keep ${record.refused[entry.sha1] || record.limit}` });
        done = true;
        continue;
      }
      // one copy already there (this record, or one an earlier worker made before the record existed): no download. A held
      // copy the browser has since evicted is copied again (the page's one probe of it missed); a later visit this worker
      // serves asks again (not done: only a copy or a refusal is final)
      if (await httpHeld(key)) {
        httpLoaded.delete(key);   // (its load's copy is checked: a later miss is an eviction, copied again on a return visit)
        if (!known) { record.held[entry.sha1] = wire; await writeHttpCopy(record, map); }
        continue;
      }
      if (known) { delete record.held[entry.sha1]; await writeHttpCopy(record, map); }
      // this worker's load read the module's whole body through the HTTP cache and the browser did not keep it (over its
      // per-entry limit): recorded without a second download. Only this module is: a miss here can also be an eviction since the
      // load, and the size limit is kept to spare a copy's download, which a later module's own load does not need
      if (httpLoaded.has(key)) {
        const sent = httpLoaded.get(key) || wire;
        record.refused[entry.sha1] = sent;
        await writeHttpCopy(record, map);
        done = true;
        post({ type: 'log', text: `SW HTTP_COPY ${name}: not kept by the HTTP cache (${sent} bytes, over its per-entry limit); not tried again` });
        continue;
      }
      // a module this worker's load did not read through the HTTP cache is copied only on this page's return visit, and only
      // while the data cache holds it (stored whole or in pieces, as cachedResponse reads it)
      const store = await openCache();
      if (!returning || (!(await store.match(key)) && !(await store.match(key + '&parts')))) continue;
      if (stoppedPages.has(page)) return;   // (stopLoads; a stop during the copy aborts it)
      if (!pageAborts.has(page) && typeof AbortController === 'function') pageAborts.set(page, new AbortController());
      const response = await fetch(key, pageAborts.has(page) ? { cache: 'force-cache', signal: pageAborts.get(page).signal } : { cache: 'force-cache' });
      if (response.ok && response.body) {
        // the HTTP cache keeps what passes. blob() drains the body inside the browser (Chrome hands the network's data pipe to
        // its Blob registry), where a reader loop took every chunk of the module into this worker's JS heap (Lyra: 168 MB of
        // garbage in the page's renderer, 5 s after the first return visit's ready, until the worker's next GC)
        await response.blob();
        // the HTTP cache keeps the body as it came (Brotli where the host sent it): its size is what the limit counts
        const sent = Number(response.headers.get('Content-Length')) || wire;
        const kept = await httpHeld(key);
        if (kept) record.held[entry.sha1] = sent;
        else { record.refused[entry.sha1] = sent; record.limit = record.limit ? Math.min(record.limit, sent) : sent; }
        await writeHttpCopy(record, map);
        done = true;
        post({ type: 'log', text: 'SW HTTP_COPY ' + name + (kept ? '' : `: not kept by the HTTP cache (${sent} bytes, over its per-entry limit); not tried again`) });
      } else {
        post({ type: 'log', text: 'SW HTTP_COPY ' + name + ': HTTP ' + response.status });
      }
    } catch (e) {
      post({ type: 'log', text: 'SW HTTP_COPY ' + name + ' failed: ' + e });
    } finally {
      if (!done) httpCopied.delete(key);   // a failed copy is tried again on a later return visit
    }
  }
}
// The bound file lists whose start-up files were all cached at prefetch() while an untagged late container was not: the untagged late
// containers load at the tier pick when that tier's start files are cached too. Resolves to {release} (the release's promise, for the
// caller's waitUntil) when it released
const warmAtPick = new WeakSet();
async function releaseLateIfWarm(clientId, map, tier) {
  if (!warmAtPick.has(map)) return;
  warmAtPick.delete(map);
  if (released.has(map)) return;
  const store = await caches.open(CACHE);
  const stored = async ([url, entry]) => { const key = url + '?v=' + entry.sha1; return !!(await store.match(key + '&parts')) || !!(await store.match(key)); };
  for (const file of tierStartFiles(map, tier)) {
    if (!(await stored(file))) {
      post({ type: 'log', text: `SW LATE waits: the ${tier} tier's ${file[0].split('/').pop()} is not cached` });
      return;
    }
  }
  // (only the untagged late files count: a warm release loads no tier's late file, and another tier's cold code, never loaded on
  // this device, would make every settled visit release during its start)
  let lateMissing = false;
  for (const file of pageLate(map, undefined)) if (!(await stored(file))) { lateMissing = true; break; }
  if (!lateMissing || released.has(map)) return;
  post({ type: 'log', text: `SW LATE at once (every boot file is cached, the ${tier} tier's too; a late one is not)` });
  return { release: prefetchLate(clientId, 'warm').catch(() => {}) };
}
async function prefetch(clientId) {
  if (stoppedPages.has(clientId)) return;   // (stopLoads)
  const map = await manifestFor(clientId);
  const rank = (url) => url.endsWith('.wasm') ? 0 : url.endsWith('.js') ? 1 : url.endsWith('.pak') ? 2 : url.endsWith('.utoc') ? 3 : url.includes('/global.') ? 4 : 5;
  const wanted = [...map.entries()]
    .filter(([url, entry]) => /\/Binaries\/Wasm\/[^/]+\.(js|wasm)$/.test(url) || /\/Content\/Paks\//.test(url) || (WAVES && entry.wave !== undefined))
    .sort((a, b) => rank(a[0]) - rank(b[0]));
  // the game's script and wasm first, alone, so a slow link spends its bandwidth on what the engine needs to start
  // (at 50 Mbit: with every file at once the runtime came up 2.3 s later); the containers follow, and a
  // read the engine makes meanwhile still starts its file's load at once (fill)
  // Only the game's binaries go first; a loose file with a wave (sw.js?waves=1), script or not, waits for its wave
  const isBinary = (url) => /\/Binaries\/Wasm\/[^/]+\.(js|wasm)$/.test(url);
  const code = wanted.filter(([url]) => isBinary(url));
  // (a tier's container, below Content/TierPaks, loads at that tier's pick (prefetchTier) or at the engine's first read of it, never
  // with the start-up data)
  const data = wanted.filter(([url, entry]) => !isBinary(url) && !isLate(entry) && !isTierContainer(url, entry));
  // A visit that finds every boot file cached has no boot download to protect: the late containers load now
  const store = await caches.open(CACHE);
  let storedNow = false;
  for (const [url, entry] of code) if (isWasm(url) && await store.match(url + '?v=' + entry.sha1 + '&parts')) storedNow = true;
  storedAtStart.delete(clientId);
  storedAtStart.set(clientId, storedNow);
  if (storedAtStart.size > 32) storedAtStart.delete(storedAtStart.keys().next().value);   // (the oldest pages': bounded)
  let warm = true;
  for (const [url, entry] of code.concat(data)) {
    const key = url + '?v=' + entry.sha1;
    if (!(await store.match(key + '&parts')) && !(await store.match(key))) { warm = false; break; }
  }
  // A stage with files of one tier (its container, its loose start files, its late cold code) is warm only when the picked tier's
  // start files are cached too: a forward start after deferred visits still downloads the forward container, and the late
  // containers would share the link with it. Which tier's start files count is known at the pick (prefetchTier ->
  // releaseLateIfWarm); a warm release loads only the untagged late files, the tier's at ready
  const tiered = [...map.values()].some((entry) => entry.tier);
  // ... unless the late containers are all cached too (+0.5 s on a settled warm visit otherwise), when they need no fill at all
  let lateMissing = false;
  if (warm && !tiered) {
    for (const [url, entry] of pageLate(map, undefined)) {
      const key = url + '?v=' + entry.sha1;
      if (!(await store.match(key + '&parts')) && !(await store.match(key))) { lateMissing = true; break; }
    }
  }
  // a release started here is held by this message too, after its own loads (which never wait for it)
  let warmRelease = null;
  if (warm && !released.has(map)) {
    if (tiered) {
      warmAtPick.add(map);
      if (tierPicked.has(map)) warmRelease = releaseLateIfWarm(clientId, map, tierPicked.get(map)).then((w) => w && w.release);
    } else if (lateMissing) {
      post({ type: 'log', text: 'SW LATE at once (every boot file is cached, a late one is not)' });
      warmRelease = prefetchLate(clientId, 'warm');
    }
  }
  const heldRelease = warmRelease ? warmRelease.catch(() => {}) : null;
  // (a start-up container's load already under way is this page's too while its code loads: no other page's stop aborts it)
  for (const [url, entry] of data) { const key = url + '?v=' + entry.sha1; if (pending.has(key) && loads.has(key)) interest(key, clientId); }
  await Promise.all(code.filter(([url, entry]) => cacheable(url, entry)).map(([url, entry]) => fillFor(clientId, url, entry)));
  // Ahead of the containers themselves, and only for one not in the cache yet (measured: every repeat visit fetched the
  // tails again, about 0.94 MB, though the whole container was already stored); a container's staged head too
  const cache = await caches.open(CACHE);
  for (const [url, entry] of data) {
    const key = url + '?v=' + entry.sha1;
    // (only for a container this worker loads whole, with a usable layout, and has not loaded or given up on yet: its pieces
    // answer reads only while that load runs)
    if (piecedLayoutProblem(entry) === null && cacheable(url, entry) && !blobs.has(key) && !failed.has(key) && !(await cachedResponse(cache, key))) {
      if (stoppedPages.has(clientId)) return;   // (stopLoads)
      // (the pieces are this page's load until the file's own load starts: a stop aborts them too; none for a load a stop aborted)
      if (loadAborted(interest(key, clientId))) continue;
      for (const which of ['head', 'tail']) if (entry[which]) loadPiece(url, entry, which);
    }
  }
  const fills = data.filter(([url, entry]) => cacheable(url, entry));
  if (WAVES) {
    const waveOf = ([, entry]) => (typeof entry.wave === 'number' ? entry.wave : entry.size <= SMALL_FILE_BYTES ? 0 : 1);
    const waves = [...new Set(fills.map(waveOf))].sort((a, b) => a - b);
    post({ type: 'log', text: 'SW WAVES ' + waves.map((w) => w + ': ' + fills.filter((f) => waveOf(f) === w).length).join(', ') + ' files' });
    // the waves wait for their files' loads only: a container's pieces belong to its load (fill -> fetchPieces), which gives up on a
    // stalled head or tail after PIECE_STALL_MS, so no piece request can hold a wave
    await Promise.all(fills.filter((f) => waveOf(f) === waves[0]).map(([url, entry]) => fillFor(clientId, url, entry)));
    for (const wave of waves.slice(1)) await Promise.all(fills.filter((f) => waveOf(f) === wave).map(([url, entry]) => fillFor(clientId, url, entry)));
  } else {
    await Promise.all(fills.map(([url, entry]) => fillFor(clientId, url, entry)));
  }
  // The page releases the later chunks' containers when the game is ready (wasm-loader.js: 'ue-ready' or the ready line);
  // only if it has not 20 s after the boot containers are in does the worker release the untagged ones itself (a tier's late files
  // wait for the page's ready release, or a re-post, when the tier the RHI runs is known)
  // (after the picked tier's start files too: they are not start-up data above, and the first frame may still need them)
  setTimeout(async () => {
    if (released.has(map) || stoppedPages.has(clientId)) return;
    const tier = tierPicked.get(map);
    const loads = tier ? tierStartFiles(map, tier).map(([url, entry]) => pending.get(url + '?v=' + entry.sha1)).filter(Boolean) : [];
    if (loads.length) await Promise.all(loads.map((load) => load.catch(() => null)));
    if (released.has(map)) return;
    post({ type: 'log', text: 'SW LATE 20 s after the boot containers (the page released nothing)' + (loads.length ? `, after the ${tier} tier's start files` : '') });
    prefetchLate(clientId, 'timer');
  }, 20000);
  await heldRelease;
}

// (the mount's read of the container's end waited 918 ms for the sequential download): a container's last
// MiBs, staged as "<file>.tail" (UAT's -WasmContainerPieces or a stage tool, wasm-cache.json "tail": {url, offset, size, sha1}),
// answer reads there before the whole file is in; so does a container's first MiBs, "<file>.head" ("head", offset 0). A
// container that also has a "body" (the bytes between) is loaded as head, body and tail, the head and tail being the ones
// loaded ahead of it, so no byte crosses the link twice
// Range reads go to the network until their bytes (at 50 Mbit/s on one large game: interactive 53.7 -> 40.6 s)
// arrive in the whole-file load; sw.js?ranges=wait (the page's ?swranges=wait) waits for them instead, as before
const RANGES_TO_NETWORK = new URL(self.location.href).searchParams.get('ranges') !== 'wait';
// sw.js?isolate=1 (the page's <meta name="ue-sw-isolation" content="1">, setting InjectIsolationHeaders): for a
// host that cannot send COOP/COEP (a plain static host, GitHub Pages), the worker adds them to every same-origin response it
// passes on, so the page becomes cross-origin isolated after one reload (wasm threads need SharedArrayBuffer)
const ISOLATE = new URL(self.location.href).searchParams.get('isolate') === '1';
// sw.js?late=early (the page's <meta name="ue-sw-late-fill" content="early">): a late container's first range read before the
// release starts its one whole-file load, at low fetch priority so the start-up downloads keep the link, and later reads take
// what has arrived (else a range from the network, as before). By default those reads are network ranges and the whole file
// loads at the release, so the bytes read early cross the link twice
const EARLY_LATE_FILL = new URL(self.location.href).searchParams.get('late') === 'early';
const lowPriority = new Set();   // url?v=sha1 of the late containers whose load a read started early
// sw.js?waves=1 (the page's <meta name="ue-sw-waves" content="1">): the start-up containers load in waves instead of all at once.
// Wave 0 (with the containers' tails): the small files the engine reads first, the .pak and .utoc indexes and any container of
// SMALL_FILE_BYTES or less (the fetch backend reads a file of two chunks or less whole when it sizes it, so it waits for the whole
// file); then wave 1 and up, the large containers, so the small files no longer share the link with them. A list entry's "wave"
// (a stage tool's own order; a loose file with one joins the prefetch) overrides the size rule. Off by default: all at once
const WAVES = new URL(self.location.href).searchParams.get('waves') === '1';
const SMALL_FILE_BYTES = 2 * 1024 * 1024;
// A staged head or tail is small and asked for first: one still out PIECE_STALL_MS after the rest of its container's load is in has
// stalled, and the load goes on without it (the whole file, or the network range a resumed load asks for anyway)
const PIECE_STALL_MS = 5000;
// Only what isolation needs: the game page's own navigation (the scope's index) and same-origin Worker scripts;
// other pages in scope (a stage at a site's root), cross-origin and CORS responses are passed on as they are
function isGamePage(url) {
  const path = new URL(url).pathname;
  const scope = new URL(self.registration.scope).pathname;
  return path === scope || path === scope + 'index.html';
}
function isolated(response, request) {
  if (!ISOLATE || !response || response.type === 'opaque' || response.type === 'cors' || response.status === 0) return response;
  if (request) {
    const sameOrigin = new URL(request.url).origin === new URL(self.registration.scope).origin;
    const wanted = request.mode === 'navigate' ? isGamePage(request.url) : (request.destination === 'worker' || request.destination === 'sharedworker');
    if (!sameOrigin || !wanted) return response;
  }
  const h = new Headers(response.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
// A piece is keyed by its container's sha1 and its own place and sha1, so a stage that lays the same file out again never
// answers from an earlier layout's piece
const tails = new Map();  // url?v=sha1#head|tail@offset+size:sha1 -> promise of {offset, bytes} (null when the piece is unusable)
// url?v=sha1 -> the end of a container's pieced load: its whole-file fallback starting, or the load done (fetchPieces, fill). It
// ends the waits of reads on the container's head or tail, which then take their bytes from the file's load
const loadEnds = new Map();
function loadEnded(key) {
  if (!loadEnds.has(key)) { let end = null; const promise = new Promise((resolve) => { end = resolve; }); loadEnds.set(key, { promise, end, ended: false }); }
  return loadEnds.get(key);
}
function endLoad(key) { const e = loadEnded(key); e.ended = true; e.end(); }
// The one layout check for a container staged as pieces (wasm-cache.json "head", "body", "tail"), which the prefetch, the read
// path (tailRead) and the pieced load (fetchPieces) all use: a head at offset 0, a body right after it whose listed size (when
// given) fits, a tail that ends where the container ends, and a valid 40-hex sha1 on every piece listed. A container that fails it
// is not pieced at all: its file loads whole and none of its pieces is loaded or answers a read. null when usable, else why not
function piecedLayoutProblem(entry) {
  if (!(entry.head || entry.body || entry.tail) || !(entry.size > 0)) return 'no pieces';
  const hex = (piece) => /^[0-9a-f]{40}$/i.test((piece && piece.sha1) || '');
  const headSize = entry.head ? entry.head.size : 0;
  if (entry.head && ((entry.head.offset || 0) !== 0 || !(headSize > 0) || !hex(entry.head))) return 'the head';
  if (entry.tail && (!(entry.tail.size > 0) || entry.tail.offset + entry.tail.size !== entry.size || entry.tail.offset < headSize || !hex(entry.tail))) return 'the tail';
  if (entry.body) {
    const bodySize = (entry.tail ? entry.tail.offset : entry.size) - headSize;
    if ((entry.body.offset || 0) !== headSize || !(bodySize >= 0) || (typeof entry.body.size === 'number' && entry.body.size !== bodySize) || !hex(entry.body)) return 'the body';
  }
  return null;
}
function loadPiece(url, entry, which) {
  const piece = entry[which];
  const key = `${url}?v=${entry.sha1}#${which}@${piece.offset || 0}+${piece.size ?? ''}:${piece.sha1}`;
  if (!tails.has(key)) {
    const pieceUrl = new URL(piece.url, self.registration.scope).href + '?v=' + piece.sha1;
    tails.set(key, fetch(pieceUrl, signalled(url + '?v=' + entry.sha1, { cache: 'no-store' }))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then(async (buffer) => {
        if (!buffer) return null;
        // only the listed piece answers reads or joins the file: its size and its sha1 (sha1Matches) must match the list
        if ((typeof piece.size === 'number' && buffer.byteLength !== piece.size) || !(await sha1Matches([new Blob([buffer])], piece.sha1))) {
          post({ type: 'log', text: `SW PIECE ${which} of ${url.split('/').pop()} does not match the list: not used` });
          return null;
        }
        return { offset: piece.offset || 0, bytes: new Uint8Array(buffer) };
      })
      .catch(() => null));
  }
  return tails.get(key);
}
async function tailRead(entry, range, url) {
  if (!(entry.head || entry.tail) || piecedLayoutProblem(entry) !== null) return null;   // only a usable layout's pieces answer reads
  const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
  if (!match) return null;
  const first = Number(match[1]);
  const last = match[2] === '' ? entry.size - 1 : Math.min(Number(match[2]), entry.size - 1);
  if (first > last) return null;
  const which = entry.tail && first >= entry.tail.offset ? 'tail' : entry.head && last < entry.head.size ? 'head' : null;
  if (!which) return null;
  // the read waits for the piece only while the file's load runs and has not ended (fallen back to the whole file, or done)
  const key = url + '?v=' + entry.sha1;
  const job = pending.get(key);
  if (!job) return null;
  const ends = loadEnded(key);
  // (the wait also ends with the file's own load, whichever way it ends)
  const tail = ends.ended ? null : await Promise.race([loadPiece(url, entry, which), ends.promise.then(() => null), job.then(() => null, () => null)]);
  if (!tail || tail.offset > first || tail.offset + tail.bytes.byteLength < last + 1) return null;
  const bytes = tail.bytes.slice(first - tail.offset, last + 1 - tail.offset);
  post({ type: 'log', text: `SW ${which.toUpperCase()} ${url.split('/').pop()} ${first}-${last}` });
  return new Response(bytes, { status: 206, headers: headers(typeOf(url), {
    'Content-Range': `bytes ${first}-${last}/${entry.size}`, 'Content-Length': String(last - first + 1) }) });
}
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of OLD_CACHES) await caches.delete(name);
  indexStore();
  await self.clients.claim();
})()));

function indexManifest(entries) {
  const map = new Map();
  for (const e of entries) { if (e.url && e.sha1) map.set(new URL(e.url, self.registration.scope).href, e); }
  return map;
}

// A list that cannot be fetched (offline, a host error) falls back to the last good one kept in the cache, so
// reads still come from Cache Storage, and the next fetch waits MANIFEST_RETRY_MS (no request storm)
const MANIFEST_RETRY_MS = 10000;
function manifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(new URL('wasm-cache.json', self.registration.scope), { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((list) => (Array.isArray(list) ? keepList(list) : killSwitch(list))).then(indexManifest).then((map) => { prune(map); return map; })
      .catch(async (e) => {
        setTimeout(() => { manifestPromise = null; }, MANIFEST_RETRY_MS);
        let list = [];
        try { const last = await (await caches.open(CACHE)).match(INTERNAL + 'list'); list = last ? await last.json() : []; } catch (x) { list = []; }
        post({ type: 'log', text: 'SW LIST_FAILED ' + e + (list.length ? ': using the last good list (' + list.length + ' files)' : ': no list kept') });
        return indexManifest(Array.isArray(list) ? list : []);
      });
  }
  return manifestPromise;
}
async function keepList(list) {
  try { await (await caches.open(CACHE)).put(INTERNAL + 'list', new Response(JSON.stringify(list))); } catch (e) { /* quota */ }
  return list;
}

async function killSwitch(list) {
  if (list && list.sw === 'off' && !killed) {
    killed = true;
    post({ type: 'log', text: 'SW OFF: the host turned the data cache off (wasm-cache.json {"sw":"off"})' });
    post({ type: 'sw-off' });
    cacheHandle = null;
    await caches.delete(CACHE);
    await self.registration.unregister();
  }
  return [];
}

// does a file of this size fit what the origin may still store? (no estimate: assume it does)
// EngineTest (a 1.82 GB .ucas): a fill holds the whole file in the worker's memory and stores it piece by piece; Chrome's
// Cache.put failed ("Unexpected internal error") and every read of the file failed after it. A file over MAX_CACHED_FILE_BYTES,
// and every file not yet cached once a store failed for lack of room, is read from the network as ranges (never stored);
// each case is logged once
const MAX_CACHED_FILE_BYTES = 1024 * 1024 * 1024;
let storeBroken = false;
let notReadableFailures = 0;   // one transient NotReadableError does not mark the store broken
const uncachedLogged = new Set();
function cacheable(url, entry) {
  const why = entry.size > MAX_CACHED_FILE_BYTES ? 'over ' + (MAX_CACHED_FILE_BYTES >> 20) + ' MiB'
    : storeBroken ? 'a store failed for lack of room' : null;
  if (!why) return true;
  if (!uncachedLogged.has(url)) {
    uncachedLogged.add(url);
    post({ type: 'log', text: `SW UNCACHED ${url.split('/').pop()} ${entry.size}: ${why}; read from the network` });
  }
  return false;
}
// mark: false asks only (a prefetch's own decision): no room then does not mark the storage low for every later file
async function fits(bytes, mark = true) {
  if (storageLow) return false;
  try {
    const { quota, usage } = await self.navigator.storage.estimate();
    if (quota && usage !== undefined && usage + bytes > quota * 0.95) {
      if (!mark) return false;
      storageLow = true;
      post({ type: 'log', text: `SW STORAGE_LOW usage ${usage} + ${bytes} of quota ${quota}: reading from the network` });
      post({ type: 'storage-low', usage, quota, bytes });
      return false;
    }
  } catch (e) { /* no estimate in this browser */ }
  return true;
}

// a new deploy's list drops every cached file it no longer names (a removed file, an older version), so an update
// leaves no stale data in Cache Storage
// The files a live page's build still names are kept too (a tab on build N keeps build N's files after the
// deploy of N+1); a closed page's binding goes with the prune
async function prune(map) {
  if (!map || !map.size) return;
  await readBindings();
  const live = await livePages();
  const cache = await caches.open(CACHE);
  const maps = [map];
  for (const [id, b] of [...bound.entries()]) {
    if (live.has(id)) { maps.push(b.map); continue; }
    bound.delete(id);
    try { await cache.delete(INTERNAL + 'bind/' + encodeURIComponent(id)); } catch (e) { /* gone */ }
  }
  const keep = new Set();
  for (const m of maps) for (const e of m.values()) keep.add(new URL(e.url, self.registration.scope).href + '?v=' + e.sha1);
  for (const request of await cache.keys()) {
    if (request.url.startsWith(INTERNAL)) continue;
    const key = baseKey(request.url);
    if (!keep.has(key)) { await cache.delete(request); blobs.delete(key); }
  }
}

// A file is stored as authoritative (its index entry) only when its bytes hash to the list's sha1; a stale CDN
// body or a padded one is not stored, and what happens to it is the mismatch rule's (isCode, above: a code file is fetched once
// more and not run while it differs; a data file is read from the network with a warning). Files over 1 GiB are never hashed
// The stored file's SHA-1, one stored piece (CACHE_PART_BYTES, a disk-backed Blob) at a time: reading the whole file into one
// ArrayBuffer for crypto.subtle.digest (which copies its input again) held two more copies of each file in this worker while
// the download's own chunks were still alive (Lyra's 258 MB wasm and 192 MB pakchunk0). With memoryFile's release(), Lyra
// Development cold visits (4 each, mobile tier): renderer Pss at READY 2541 -> 2065 MiB, peak 2541 -> 2342, READY unchanged.
// WebCrypto has no incremental digest, so this is SHA-1 in JS (about 200 MB/s)
async function sha1Matches(pieces, sha1) {
  const hex = await sha1Of(pieces, sha1);
  return hex === null || hex === sha1.toLowerCase();
}
// the pieces' SHA-1 as hex, or null when the list gives no valid sha1 (nothing to check)
async function sha1Of(pieces, sha1) {
  if (!sha1 || !/^[0-9a-f]{40}$/i.test(sha1)) return null;
  const h = new Sha1();
  for (const piece of pieces) {
    const bytes = new Uint8Array(await piece.arrayBuffer());
    for (let at = 0; at < bytes.byteLength; at += 1 << 20) {   // about 5 ms each, so the engine's reads are not held up
      h.update(bytes.subarray(at, Math.min(bytes.byteLength, at + (1 << 20))));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return h.hex();
}
class Sha1 {
  constructor() {
    this.h = new Int32Array([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]);
    this.w = new Int32Array(80);
    this.tail = new Uint8Array(64);
    this.tailBytes = 0;
    this.bytes = 0;
  }
  block(v, at) {
    const w = this.w, h = this.h;
    for (let i = 0, j = at; i < 16; i++, j += 4) w[i] = (v[j] << 24) | (v[j + 1] << 16) | (v[j + 2] << 8) | v[j + 3];
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], t = 0, i = 0;
    for (; i < 20; i++) { t = (((a << 5) | (a >>> 27)) + ((b & c) | (~b & d)) + 0x5A827999 + e + w[i]) | 0; e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
    for (; i < 40; i++) { t = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + 0x6ED9EBA1 + e + w[i]) | 0; e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
    for (; i < 60; i++) { t = (((a << 5) | (a >>> 27)) + ((b & c) | (b & d) | (c & d)) + 0x8F1BBCDC + e + w[i]) | 0; e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
    for (; i < 80; i++) { t = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + 0xCA62C1D6 + e + w[i]) | 0; e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
  }
  update(data) {
    this.bytes += data.byteLength;
    let at = 0;
    if (this.tailBytes) {
      const take = Math.min(64 - this.tailBytes, data.byteLength);
      this.tail.set(data.subarray(0, take), this.tailBytes);
      this.tailBytes += take;
      at = take;
      if (this.tailBytes < 64) return;
      this.block(this.tail, 0);
      this.tailBytes = 0;
    }
    for (; at + 64 <= data.byteLength; at += 64) this.block(data, at);
    this.tail.set(data.subarray(at), 0);
    this.tailBytes = data.byteLength - at;
  }
  hex() {
    const bits = this.bytes * 8;
    const pad = new Uint8Array(((this.tailBytes + 8) >> 6) * 64 + 64 - this.tailBytes);
    pad[0] = 0x80;
    const v = new DataView(pad.buffer);
    v.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    v.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    return [...this.h].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

// a file over a host's per-file limit (Cloudflare Pages: 25 MiB) is listed with its parts (by the stage tool);
// fetch them in order as one body. Such a file needs this worker: without it (?sw=0) the fetch backend asks for the whole URL
// (load: the whole-file load these fetches are for, whose stop aborts them; null for a code check outside a load, uncachedCode)
async function fetchWhole(key, entry, url, load = loads.get(key)) {
  const stoppable = (init) => (load && load.abort ? { ...init, signal: load.abort.signal } : init);
  if (!entry.parts && entry.body) return fetchPieces(key, entry, url);
  // (the game's module through the HTTP cache, so the browser keeps its copy from this one download: viaHttpCache)
  const mode = viaHttpCache(url, entry) ? 'force-cache' : 'no-store';
  if (!entry.parts) return fetch(key, stoppable(lowPriority.has(key) ? { cache: mode, priority: 'low' } : { cache: mode }));
  const scope = self.registration.scope;
  const bodies = [];
  for (const part of entry.parts) {
    const response = await fetch(new URL(part.url, scope).href + '?v=' + part.sha1, stoppable({ cache: 'no-store' }));
    if (!response.ok) return response;
    bodies.push(response.body);
  }
  const stream = new ReadableStream({
    async pull(controller) {
      while (bodies.length) {
        const reader = bodies[0].getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        bodies.shift();
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}


// A container staged as pieces (wasm-cache.json "head", "body", "tail") is its head, body and tail in a row; the head and tail
// are the ones the prefetch loaded ahead of the data. Like them, the body answers no read until its size and sha1 match the list:
// its chunks are kept as they arrive and hashed as they arrive (Sha1; no copy into one buffer, as a start-up container can
// be hundreds of MB on a phone), and handed on after the head only once the whole body checks out. The load's response is
// returned at once and its stream waits for the pieces, so a read of a range not yet in goes to the network meanwhile (as for
// any byte not yet in). One rule for failures: the first piece failure ends every wait on the other pieces (the head, tail and
// body requests run side by side and none is waited for once one has failed; the body request is stopped) and loads the whole
// file instead, from its first byte (the stage keeps it); it also ends the waits of reads on a head or tail (loadEnded), which
// then take their bytes from that whole-file load. A failure is: a layout that does not add up, a head or tail that is not
// usable, a body request that fails or has no body, a body stream that breaks after its headers, a size or sha1 that differs
async function fetchPieces(key, entry, url) {
  const init = signalled(key, lowPriority.has(key) ? { cache: 'no-store', priority: 'low' } : { cache: 'no-store' });
  const headSize = entry.head ? entry.head.size : 0;
  const bodySize = (entry.tail ? entry.tail.offset : entry.size) - headSize;
  const whole = (why) => {
    endLoad(key);   // reads waiting on a head or tail take the whole file's bytes from here on
    post({ type: 'log', text: `SW PIECES ${url.split('/').pop()}: a piece failed (${why}), loading the whole file` });
    return fetch(key, init);
  };
  const layout = piecedLayoutProblem(entry);   // the same check as the prefetch's and the read path's
  if (layout !== null) return whole(`the list's layout: ${layout}`);
  const bodyUrl = new URL(entry.body.url, self.registration.scope).href + '?v=' + entry.body.sha1;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  // (a stop aborts the body too, also one that came before this request)
  if (abort && init.signal) { if (init.signal.aborted) abort.abort(); else init.signal.addEventListener('abort', () => abort.abort(), { once: true }); }
  const body = fetch(bodyUrl, abort ? { ...init, signal: abort.signal } : init).catch(() => null);
  let reader = null;        // the body's stream
  let wholeReader = null;   // the whole file's stream, once a piece failure has fallen back to it
  let cancelled = false;
  const dropBody = () => {   // the body is not needed: stop its request, or its stream once the response is in
    if (abort) abort.abort();
    if (reader) reader.cancel().catch(() => {});
    body.then((r) => { if (r && r.body && !r.body.locked) r.body.cancel().catch(() => {}); });
  };
  // The first failure (any piece) settles `failed`, which every wait below races
  let failure = null;
  let settle = null;
  const failed = new Promise((resolve) => { settle = resolve; });
  const fail = (why) => { if (!failure) { failure = why; settle(); } };
  const usable = (which, piece) => !!piece && (which === 'head' ? piece.bytes.byteLength === headSize : piece.offset + piece.bytes.byteLength === entry.size);
  const pieces = Promise.all(['head', 'tail'].map((which) => (entry[which]
    ? loadPiece(url, entry, which).then((piece) => { if (!usable(which, piece)) fail('the ' + which); return piece; })
    : null)));
  // The body, read and hashed from the start, side by side with the head and tail
  const chunks = [];
  const bodyRead = (async () => {
    const response = await body;
    if (failure) return;
    if (!response || !response.ok) { fail(response ? 'body HTTP ' + response.status : 'body request'); return; }
    if (!response.body) { fail('the body response has no body'); return; }
    reader = response.body.getReader();
    const listed = entry.body.sha1.toLowerCase();   // a valid sha1 (the layout check above)
    const hash = listed ? new Sha1() : null;
    let got = 0;
    let reported = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (failure) return;
        if (done) break;
        if (got + value.byteLength > bodySize) { fail(`the body is longer than the list's ${bodySize} bytes`); return; }
        chunks.push(value);
        if (hash) hash.update(value);
        got += value.byteLength;
        if (got - reported >= (1 << 20)) { reported = got; report(url, headSize + got, false); }   // the page's progress bar
      }
      if (got !== bodySize) fail(`the body has ${got} bytes, the list says ${bodySize}`);
      else if (hash && hash.hex() !== listed) fail('the body does not match its sha1');
    } catch (e) {
      fail(`the body broke off after ${got} bytes: ${e}`);
    }
  })();
  // The head, the body's chunks once they check out, then the tail; nothing is handed on before the check
  const checked = async (controller) => {
    // once the body is in, a head or tail still out gets PIECE_STALL_MS more; then it counts as failed and the file loads whole
    bodyRead.then(() => {
      if (failure) return;
      const timer = setTimeout(() => fail('a piece did not arrive in time'), PIECE_STALL_MS);
      pieces.then(() => clearTimeout(timer));
      failed.then(() => clearTimeout(timer));
    });
    const both = await Promise.race([Promise.all([pieces, bodyRead]), failed.then(() => null)]);
    if (cancelled) return;
    if (!failure && both) {
      const [head, tail] = both[0];
      if (head) controller.enqueue(head.bytes.slice());
      for (const chunk of chunks) controller.enqueue(chunk);
      chunks.length = 0;
      if (tail) controller.enqueue(tail.bytes.slice());
      controller.close();
      endLoad(key);
      return;
    }
    chunks.length = 0;
    dropBody();
    const fallback = await whole(failure).catch(() => null);
    if (!fallback || !fallback.ok || !fallback.body) {
      const error = new Error(`${failure}; the whole file failed too (${fallback ? 'HTTP ' + fallback.status : 'no response'})`);
      error.http = !!fallback;   // the host answered (an HTTP error): no network break, so no retry on the next page load
      controller.error(error);
      return;
    }
    wholeReader = fallback.body.getReader();
  };
  return new Response(new ReadableStream({
    async pull(controller) {
      if (!wholeReader) {
        await checked(controller);
        if (!wholeReader) return;
      }
      const { done, value } = await wholeReader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      cancelled = true;
      fail('the load was cancelled');
      if (wholeReader) return wholeReader.cancel(reason);
      dropBody();
      return undefined;
    },
  }), { status: 200 });
}

function headers(type, extra) {
  const h = new Headers(extra || {});
  h.set('Content-Type', type || 'application/octet-stream');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (ISOLATE) h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Accept-Ranges', 'bytes');
  h.set('X-UE-Cache', '1');  // served by sw.js (diagnostics)
  return h;
}

function typeOf(url) {
  if (url.endsWith('.wasm')) return 'application/wasm';
  if (url.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

// Progress and diagnostics to the page (index.html's loading bar; its console shows SW lines)
function post(message) {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) client.postMessage(message);
  });
}
function report(url, loaded, cached) { post({ type: 'progress', url, loaded, cached }); }
// A file whose whole-file load failed is read from the network for the rest of this worker's life (no retry loop)
const failed = new Set();
// ... except a load the network broke (the host or the connection went away: fetch rejected, or the body stopped with a read
// error), which the next page load tries again once (retryBroken). UE-411927: a reload in the same session still found the
// .wasm failed in this worker, so the page's early compile read it whole from the network while the prefetch's fill loaded it
// again (two whole .br GETs within 2 ms). Now the reload's reads join that one fill
const broken = new Set();
function retryBroken() {
  if (!broken.size) return;
  post({ type: 'log', text: `SW RETRY ${broken.size} load(s) the network broke: ${[...broken].map((key) => key.split('?')[0].split('/').pop()).join(', ')}` });
  for (const key of broken) failed.delete(key);
  broken.clear();
}
function problem(key, text, network = false, file = null) {
  failed.add(key);
  if (network) broken.add(key);
  else broken.delete(key);   // (the latest failure decides: one that is not the network's is not tried again)
  errors.push(key + ': ' + text);
  post({ type: 'log', text: 'SW ERROR ' + key + ': ' + text });
  // (file: kept for the log line's caller; a page is told by its reads' answers, fileAnswered, not by a fill's failure: a fill
  // whose staged part failed, or one the read's network fallback then serves whole, is no missing file of the page)
}
// A listed file the host does not have (HTTP 4xx or 5xx) or has cut short (fewer bytes than the list says): the page's stop card
// names it (wasm-play.js 'file-problem'), whatever the engine fails with later (UE-411936: a missing .ucas ended as "The game
// ended with code 1.", a missing global shader file as "native code called abort()"). Once per file and reading client (a
// page's engine reads from its own Workers): a page that loads after the report (a reload: the file is failed, so its reads go
// to the network) gets it from its own reads' answers (fileAnswered). path: the file's URL below this worker's scope, as the
// stage holds it
const fileProblems = new Set();   // page|url?v=sha1|status|got posted, and url?v=sha1|status|got logged
// clients: the ids whose reads got the answer (a page, or one of its engine's Workers): only their pages are told (another tab,
// of this build or another, is not stopped by this page's file). The promise is the delivery's: the read's event holds it
function fileProblem(url, { status = 0, expected = 0, got = -1, sha1 = '' } = {}, clients = []) {
  const scope = self.registration.scope;
  const report = { type: 'file-problem', url, path: url.startsWith(scope) ? url.slice(scope.length) : url, status, expected, got };
  const what = [url + '?v=' + sha1, status, got].join('|');
  const bytes = `${got >= 0 ? got : '?'} of ${expected} bytes`;
  if (!fileProblems.has(what)) post({ type: 'log', text: `SW FILE_PROBLEM ${report.path}: ` + (status === 416 ? 'HTTP 416, ' + bytes : status >= 400 ? 'HTTP ' + status : bytes) });
  fileProblems.add(what);
  // each reader's page: a page itself, or the page an engine Worker is matched to (manifestFor matches it to the newest live
  // page); a reader whose page is unknown is told itself (a Worker's message reaches no page, and no other tab is told)
  return Promise.all(clients.filter(Boolean).map(async (id) => {
    if (!bound.has(id) && !workerPage.has(id)) await manifestFor(id).catch(() => null);
    const page = bound.has(id) ? id : workerPage.get(id) || id;
    if (fileProblems.has(page + '|' + what)) return;
    fileProblems.add(page + '|' + what);
    const client = await self.clients.get(page).catch(() => null);
    if (client) client.postMessage(report);
  }));
}
// A listed file's answer from the network: an error status (a 416: rangeRefused) or a whole or ranged answer whose length is
// not the list's size is reported (fileProblem); an encoded body's length says nothing about its size
function fileAnswered(url, entry, response, client, range) {
  if (!response || !entry) return null;
  if (response.status === 416) return rangeRefused(url, entry, response, client, range);
  if (response.status >= 400) return fileProblem(url, { status: response.status, expected: entry.size || 0, sha1: entry.sha1 }, [client]);
  // (from this worker, or encoded; and a file the list gives no size cannot be short)
  if (!entry.size || response.headers.get('X-UE-Cache') || response.headers.get('Content-Encoding')) return null;
  const total = response.status === 206 ? /\/(\d+)$/.exec(response.headers.get('Content-Range') || '') : null;
  const length = response.status === 200 ? Number(response.headers.get('Content-Length') || NaN) : NaN;
  const got = total ? Number(total[1]) : length;
  return Number.isFinite(got) && got < entry.size ? fileProblem(url, { status: response.status, expected: entry.size, got, sha1: entry.sha1 }, [client]) : null;
}

// A 416 for a listed file's read (range: the read's Range header). A range that starts inside the list's size is one the host's
// copy is too short for: the file is cut short, reported as a short file (got: the size its Content-Range: bytes */<size> gives,
// else unknown). One that starts at or past the list's size is this page's own read past the file's end: a console line, no
// report (the worker's own 416 too, slice). The worker's own answers and encoded ones say nothing about the host's file
function rangeRefused(url, entry, response, client, range) {
  if (response.headers.get('Content-Encoding')) return null;
  const start = /^bytes=(\d+)-/.exec(range || '');
  if (start && Number(start[1]) < entry.size) {
    if (response.headers.get('X-UE-Cache')) return null;
    const total = /^bytes \*\/(\d+)$/.exec((response.headers.get('Content-Range') || '').trim());
    return fileProblem(url, { status: 416, expected: entry.size, got: total ? Number(total[1]) : -1, sha1: entry.sha1 }, [client]);
  }
  const scope = self.registration.scope;
  post({ type: 'log', text: `SW RANGE_PAST_END ${url.startsWith(scope) ? url.slice(scope.length) : url} ${range || '(no range)'}: HTTP 416, the list says ${entry.size} bytes (not reported)` });
  return null;
}
// A body that differs from wasm-cache.json (UE-411539: the page booted on it with READY and only a worker line showed it).
// The game's code (its script and module, isCode) is hashed as it arrives, so the outcome is known with its last byte; a body
// that differs (size or sha1) is fetched once more with cache: 'reload' (a stale HTTP cache or CDN edge copy), and one that
// still differs is never handed to a page: the module's read errors at its end (no WebAssembly.Module from those bytes), every
// later read of the file is refused (HTTP 502, refuse) and every page is told ('mismatch'), which stops with its error card. A
// data file that differs is read from the network as before (nothing is stored) and every page is told once, which warns the
// player and keeps loading. Not a security boundary (whoever controls the host controls the list too); the sha1 is over the
// decoded body, as UAT hashes the staged file, so a host's Content-Encoding (Brotli) is no mismatch
const isCode = (url) => /\/Binaries\/Wasm\/[^/]+\.(?:js|wasm)$/.test(url);
const mismatches = new Map();   // mismatchKey -> its 'mismatch' message {type, kind: 'code'|'data', url, size, sha1, got: {size, sha1}}
// one record per listed size: two lists can name the same url and sha1 with different sizes, and each page counts only its own
const mismatchKey = (key, size) => key + '#' + (size || 0);
const told = new Set();         // '<window client id> <key>': each page is told of each mismatch once
function mismatch(key, kind, url, entry, got) {
  const mkey = mismatchKey(key, entry.size);
  if (mismatches.has(mkey)) return;
  mismatches.set(mkey, { type: 'mismatch', kind, url, size: entry.size, sha1: entry.sha1, got });
  errors.push(key + ': ' + kind + ' mismatch, ' + got.size + ' bytes sha1 ' + got.sha1);
  tellMismatch(mkey);
}
function tellMismatch(key) {
  const message = mismatches.get(key);
  if (!message) return;
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      const id = (client.id || '') + ' ' + key;
      if (told.has(id)) continue;
      told.add(id);
      client.postMessage(message);
    }
  }).catch(() => {});
}
// the answer to every read of a code file that still differed after its second fetch: the page names the file from the header
function refuse(key, entry) {
  const mkey = mismatchKey(key, entry && entry.size);
  tellMismatch(mkey);
  const m = mismatches.get(mkey);
  return new Response('This file differs from wasm-cache.json: ' + JSON.stringify(m), { status: 502, statusText: 'Differs from wasm-cache.json',
    headers: headers('text/plain', { 'X-UE-Mismatch': JSON.stringify(m) }) });
}
const codeMismatch = (key, entry) => {
  const m = mismatches.get(mismatchKey(key, entry && entry.size));
  return !!m && m.kind === 'code' && (!entry || !entry.size || !m.size || m.size === entry.size);
};
const differs = (got, entry) => (!!entry.size && got.size !== entry.size) || got.sha1 !== String(entry.sha1).toLowerCase();
// The SHA-1 of a download's chunks as they arrive (progress.parts), HASH_SLICE_BYTES per task: hashed inside the read loop, Lyra's
// 117 MB module held up this worker's other answers (the game script's came 0.7 s later, the module's own transfer took 0.5 s
// instead of 0.3 s on a local host). null when the download fails
const HASH_SLICE_BYTES = 2 * 1024 * 1024;
async function hashAlong(progress, hasher) {
  let next = 0;
  let slice = 0;
  for (;;) {
    while (next >= progress.parts.length && !progress.done) await new Promise((wake) => progress.wake.push(wake));
    if (progress.failed) return null;
    if (next >= progress.parts.length) return hasher.hex();
    const part = progress.parts[next++];
    hasher.update(part);
    slice += part.byteLength;
    if (slice >= HASH_SLICE_BYTES) { slice = 0; await new Promise((resolve) => setTimeout(resolve, 0)); }
  }
}
// A whole body of a file, hashed as it arrives: {parts, got: {size, sha1}}, got null when the fetch failed (logged)
// (hashOwner: the whole-file load whose own second fetch of its code body this call is, set by refetchCode just before it calls;
// a stop of that load aborts the fetch, which then gives no verdict. Any other call, a check outside a load (uncachedCode)
// included, is no load's and is never aborted)
let hashOwner = null;
const refetchOwners = new WeakMap();   // the first body's {size, sha1} -> the load it came from (fill)
async function fetchHashed(key, url, entry, cacheMode) {
  const name = url.split('/').pop();
  const which = cacheMode === 'reload' ? 'the second fetch' : 'the fetch';
  const tag = cacheMode === 'reload' ? 'SW MISMATCH' : 'SW UNCACHED_CODE';
  const parts = [];
  let got = null;
  // (the second fetch of a load's own code body: that load's stop aborts it, and that gives no verdict. A check outside a load
  // (uncachedCode) is no load's and is never aborted, so a read always gets its verdict)
  const load = hashOwner;
  hashOwner = null;   // (read at once: only the call refetchCode makes right after setting it gets it)
  try {
    const response = entry.parts ? await fetchWhole(key, entry, url, load)
      : await fetch(key, load && load.abort ? { cache: cacheMode, signal: load.abort.signal } : { cache: cacheMode });
    if (response.ok && response.body) {
      const hasher = new Sha1();
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        hasher.update(value);
        size += value.byteLength;
      }
      got = { size, sha1: hasher.hex() };
    } else {
      post({ type: 'log', text: `${tag} ${name}: ${which} answered HTTP ${response.status}` });
    }
  } catch (e) {
    post({ type: 'log', text: `${tag} ${name}: ${which} failed: ${e}` });
  }
  return { parts, got, aborted: !got && loadAborted(load) };
}
// The second fetch of a code file that differed: its bytes answer this worker's reads when they match (held in memory; stored on
// a later visit's load), else the file is refused from now on
async function refetchCode(key, url, entry, first) {
  const name = url.split('/').pop();
  post({ type: 'log', text: `SW MISMATCH ${name}: ${first.size} bytes sha1 ${first.sha1}, the list says ${entry.size} bytes sha1 ${entry.sha1}; fetching it again (cache: reload)` });
  hashOwner = refetchOwners.get(first) || null;
  const { parts, got, aborted } = await fetchHashed(key, url, entry, 'reload');
  if (got && !differs(got, entry)) {
    post({ type: 'log', text: `SW REFETCHED ${name}: the second fetch matches the list (read from memory on this visit, stored on a later one)` });
    blobs.set(key, memoryFile(parts, got.size, null));
    report(url, got.size, false);
    return new Response(null);
  }
  parts.length = 0;
  if (aborted) {   // a stop cut the second fetch off (stopLoads): no verdict, a later load fetches the file again
    post({ type: 'log', text: `SW STOPPED ${name}: its second fetch was aborted, no verdict` });
    return null;
  }
  failed.delete(key);
  const shown = got || first;
  post({ type: 'log', text: `SW MISMATCH_CODE ${url}: ${shown.size} bytes sha1 ${shown.sha1}, the list says ${entry.size} bytes sha1 ${entry.sha1}; not run (its reads are refused)` });
  mismatch(key, 'code', url, entry, shown);
  return null;
}

// A code file this worker can't store (no room, a store that failed, over MAX_CACHED_FILE_BYTES) loads once into memory, hashed,
// so no read is answered before its verdict: a match answers this visit's reads from memory (blobs), a mismatch goes the way
// of a stored file's (refetchCode). false for a data file, one with no sha1 listed or over the limit: read from the network
const uncachedLoads = new Map();
function uncachedCode(key, url, entry) {
  if (!isCode(url) || !/^[0-9a-f]{40}$/i.test(entry.sha1 || '') || entry.size > MAX_CACHED_FILE_BYTES) return Promise.resolve(false);
  if (blobs.has(key)) return Promise.resolve(true);
  if (!uncachedLoads.has(key)) {
    uncachedLoads.set(key, (async () => {
      const first = await fetchHashed(key, url, entry, 'default');
      if (first.got && !differs(first.got, entry)) {
        blobs.set(key, memoryFile(first.parts, first.got.size, null));
        report(url, first.got.size, false);
        return true;
      }
      if (!first.got) return false;   // the download failed: no verdict, the read goes to the network as before
      await refetchCode(key, url, entry, first.got);
      return blobs.has(key);
    })().finally(() => uncachedLoads.delete(key)));
  }
  return uncachedLoads.get(key);
}

// a cached file is stored as pieces <key>&part=<i> and an index <key>&parts ({parts, size}); an entry stored whole by
// an older worker (<key>) is still read
// Resumable fills: pieces are exactly CACHE_PART_BYTES (the last one shorter), so a fill cut off by the end of
// a visit resumes at its first missing piece with a ranged GET
const CACHE_PART_BYTES = 8 * 1024 * 1024;
const baseKey = (url) => url.replace(/&(?:parts|part=\d+|bytes=\d+-\d+|skipped|brotli)$/, '');
// The whole pieces 0..n-1 of a file that a previous visit stored before it ended (no index), in order
async function storedPieces(cache, key) {
  const pieces = [];
  for (;;) {
    const piece = await cache.match(key + '&part=' + pieces.length);
    if (!piece) return pieces;
    const blob = await piece.blob();
    if (blob.size !== CACHE_PART_BYTES) return pieces;
    pieces.push(blob);
  }
}
async function cachedResponse(cache, key) {
  const whole = await cache.match(key);
  if (whole) return whole;
  const index = await cache.match(key + '&parts');
  if (!index) return null;
  try {
    const { parts, size } = await index.json();
    const pieces = [];
    for (let i = 0; i < parts; i++) {
      const piece = await cache.match(key + '&part=' + i);
      if (!piece) return null;
      pieces.push(await piece.blob());   // disk-backed: no copy into memory
    }
    const blob = new Blob(pieces);
    return size && blob.size !== size ? null : new Response(blob);
  } catch (e) {
    return null;
  }
}
// (a "/<Project>//Content/Paks/..." URL showed next to the normal one) a listed file always goes to the network by its
// collapsed URL (the fetch backend asks for <dir>//<name>), so a host and the browser cache see one URL per file, and by its
// versioned one (<url>?v=<sha1>, the cache key its whole-file load asks for): a read that falls back to the network never asks
// for the bare URL, which a newer deployment may answer with its own bytes
const toNetwork = (url, range) => fetch(url, range ? { headers: { Range: range } } : {});

// (a warm boot still read pakchunk1's mount ranges from the network) a range read of a file that is not in
// the cache yet is stored as <key>&bytes=a-b, and a later range inside a stored one is answered from it
const storedRanges = new Map();   // key -> promise of [[a, b], ...]
function rangesOf(cache, key) {
  if (!storedRanges.has(key)) {
    storedRanges.set(key, indexStore().then((index) => (index ? index.ranges.get(key) || index.ranges.set(key, []).get(key)
      : cache.keys().then((requests) => requests.map((r) => /&bytes=(\d+)-(\d+)$/.exec(r.url))
        .filter((m) => m && baseKey(m.input) === key).map((m) => [Number(m[1]), Number(m[2])])))).catch(() => []));
  }
  return storedRanges.get(key);
}
// Measured: Cache Storage runs one cache's operations in order, so a match() or keys() issued while a
// cold visit's fills store their pieces (about 80 puts of 8 MiB) waits for every put queued ahead of it: the engine's first
// pak mount (pakchunk2's 2 KB .pak and its late .ucas) waited 3.5 s for pakchunk0's writes, all of it inside
// engine_preinit. What the cache holds is read once, with one keys() before this worker queues a write; the read path asks
// Cache Storage only for a file this index says is stored, and answers the rest from the worker's own state (a fill in
// flight, its Blob) or the network
let storeIndex = null;
function indexStore() {
  if (!storeIndex) {
    storeIndex = caches.open(CACHE).then((cache) => cache.keys()).then((requests) => {
      const stored = new Set();    // keys with a whole entry or a piece index (&parts)
      const pieces = new Set();    // keys with at least one stored piece (a fill an earlier visit cut off)
      const ranges = new Map();    // key -> [[a, b], ...] of stored late-chunk ranges
      for (const request of requests) {
        if (request.url.startsWith(INTERNAL)) continue;
        const key = baseKey(request.url);
        const bytes = /&bytes=(\d+)-(\d+)$/.exec(request.url);
        if (bytes) (ranges.get(key) || ranges.set(key, []).get(key)).push([Number(bytes[1]), Number(bytes[2])]);
        else if (/&part=\d+$/.test(request.url)) pieces.add(key);
        else if (!/&(?:skipped|brotli)$/.test(request.url)) stored.add(key);   // (a resume decision's marks are no stored file)
      }
      return { stored, pieces, ranges };
    }).catch(() => null);   // no index: every read asks Cache Storage, as before
  }
  return storeIndex;
}
// false only when the index says Cache Storage has nothing of this file
async function mayBeStored(key) {
  const index = await indexStore();
  return !index || index.stored.has(key) || index.pieces.has(key);
}
function indexStored(key, stored) {
  indexStore().then((index) => {
    if (!index) return;
    if (stored) { index.stored.add(key); return; }
    index.stored.delete(key);
    index.pieces.delete(key);
    index.ranges.delete(key);
    storedRanges.delete(key);
  }).catch(() => {});
}
// At most PUTS_IN_FLIGHT piece writes wait in Cache Storage at once (the others wait here; their bytes are in memory either
// way), so a read that does ask Cache Storage queues behind two pieces, not behind every piece of a cold visit. A piece's
// Blob is made only when its write starts (makeBody): Chrome keeps at most about 500 MiB of Blobs in memory and pages the
// rest to disk only as fast as it can write; Blobs made faster than that come out broken (measured on a page making
// 8 MiB Blobs at 1.3 GB/s: every one past 496 MiB unreadable; at 170 MB/s none), and a cold visit on a fast link made them
// at about 1 GB/s: NotReadableError (CACHE_PUT_FAILED, READ_FAILED) and "Unexpected internal error" (STORE_BROKEN)
const PUTS_IN_FLIGHT = 2;
let putsRunning = 0;
const putsWaiting = [];
// Work for when no write is running or waiting: reads move to a stored file's disk-backed Blob only then, since reading it
// competes with the writes still going on (the engine's 39 reads of the global shader archive during
// engine_preinit took 0.6 s longer from the stored copy while pakchunk0's 266 MB were being written)
const whenIdle = [];
function afterWrites(work) {
  if (!putsRunning && !putsWaiting.length) work();
  else whenIdle.push(work);
}
// (load: the whole-file load the write belongs to: once a stop has aborted it, its writes still waiting are not made)
function queuedPut(cache, key, makeBody, load = null) {
  return new Promise((resolve, reject) => {
    const run = () => {
      ++putsRunning;
      Promise.resolve().then(() => {
        if (loadAborted(load)) throw new Error('stopped: not stored (stopLoads)');
        return cache.put(key, new Response(makeBody()));
      }).then(resolve, reject).finally(() => {
        --putsRunning;
        if (putsWaiting.length) putsWaiting.shift()();
        else if (!putsRunning) for (const work of whenIdle.splice(0)) work();
      });
    };
    if (putsRunning < PUTS_IN_FLIGHT) run();
    else putsWaiting.push(run);
  });
}
// (store: whether the answer may be stored, asked once it is in: not for a read of a page that has stopped)
async function rangeNetwork(cache, key, url, range, entry, store = () => true) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
  if (!match || !entry.size) return toNetwork(key, range);
  const first = Number(match[1]);
  const last = match[2] === '' ? entry.size - 1 : Math.min(Number(match[2]), entry.size - 1);
  const held = (await rangesOf(cache, key)).find(([a, z]) => a <= first && last <= z);
  if (held) {
    const stored = await cache.match(key + '&bytes=' + held[0] + '-' + held[1]);
    if (stored) {
      const blob = await stored.blob();
      post({ type: 'log', text: 'SW RANGE_CACHED ' + url.split('/').pop() + ' ' + range });
      return new Response(blob.slice(first - held[0], last + 1 - held[0]), { status: 206, headers: headers(typeOf(url), {
        'Content-Range': 'bytes ' + first + '-' + last + '/' + entry.size, 'Content-Length': String(last - first + 1) }) });
    }
  }
  const response = await toNetwork(key, range);
  const got = response.status === 206 ? /^bytes (\d+)-(\d+)\//.exec(response.headers.get('Content-Range') || '') : null;
  if (got && isLate(entry) && store()) {   // only the late containers: a boot file is stored whole by its fill
    const a = Number(got[1]);
    const z = Number(got[2]);
    response.clone().blob()
      .then((body) => { if (!store()) throw new Error('stopped: not stored (stopLoads)'); return cache.put(key + '&bytes=' + a + '-' + z, new Response(body)); })
      .then(async () => { if (!store()) { await cache.delete(key + '&bytes=' + a + '-' + z); throw new Error('stopped: not stored (stopLoads)'); } })
      .then(() => rangesOf(cache, key)).then((list) => list.push([a, z])).catch(() => {});
  }
  return response;
}
const deleting = new Map();   // url?v=sha1 -> its deletion under way (a load's settled waits for it)
function deleteCached(cache, key) {
  indexStored(key, false);
  const done = Promise.resolve(deleting.get(key)).catch(() => {}).then(async () => {
    for (const request of await cache.keys()) { if (baseKey(request.url) === key) await cache.delete(request); }
  });
  const tracked = done.catch(() => {}).then(() => { if (deleting.get(key) === tracked) deleting.delete(key); });
  deleting.set(key, tracked);
  return done;
}

// A downloaded file whose Cache Storage copy is not complete yet: reads are answered from the fetched chunks themselves, so
// the worker holds no second copy of the file as a Blob (see queuedPut)
function memoryFile(parts, size, module) {
  const each = (first, last, use) => {
    let offset = 0;
    for (const part of parts) {
      const end = offset + part.byteLength;
      if (end > first && offset <= last) use(part.subarray(Math.max(0, first - offset), Math.min(part.byteLength, last + 1 - offset)));
      if (end > last) break;
      offset = end;
    }
  };
  // release(): the file is stored and reads have moved to its disk-backed Blob, so the download's buffers are detached at once
  // instead of when this worker's GC gets to them (Lyra cold visits: the 258 MB wasm's and 192 MB pakchunk0's chunks were
  // still alive at READY in some visits and not in others). Nothing handed out shares them: copy() copies, and stream()
  // hands out a copy of one piece per pull; a whole-file stream still open when the file is released detaches them at its end.
  // The game's module (module: its moduleReads state) is the exception: its one whole read, the page's compile, gets the chunks
  // themselves (moduleStream), and they are detached only once every page that read them says its module is compiled
  // ('module-compiled')
  let streams = 0;
  let released = false;
  const drop = () => {
    if (module && module.open) return;   // a module stream still hands out these chunks: dropped at its end
    const buffers = [...new Set(parts.map((part) => part.buffer))];
    parts.length = 0;
    if (module && moduleHeld(module)) { module.detach.push(...buffers); return; }   // a page may still read them
    for (const buffer of buffers) {
      try { buffer.transfer(0); } catch (e) { /* no ArrayBuffer.prototype.transfer: left to the GC */ }
    }
  };
  if (module) module.drop = () => { if (released && !streams) drop(); };
  return {
    memory: true,
    size,
    copy(first, last) {
      const out = new Uint8Array(last - first + 1);
      let at = 0;
      each(first, last, (piece) => { out.set(piece, at); at += piece.byteLength; });
      return out;
    },
    stream(client) {
      const pieces = [];
      each(0, size - 1, (piece) => pieces.push(piece));
      if (module) return moduleStream(module, { parts: pieces, done: true, wake: [] }, client);
      let next = 0;
      let open = true;
      ++streams;
      const end = () => { if (open) { open = false; if (--streams === 0 && released) drop(); } };
      return new ReadableStream({
        pull(controller) {
          if (next < pieces.length) controller.enqueue(pieces[next++].slice());
          if (next >= pieces.length) { controller.close(); end(); }
        },
        cancel() { end(); },
      });
    },
    release() {
      released = true;
      if (!streams) drop();
    },
  };
}

// The game's module: the page compiles it from one whole-file read (wasm-loader.js compileStreaming), and nothing reads it
// again once it is compiled (the pthread Workers get the compiled module by postMessage). Its download is kept as one copy only,
// and for as short as the page and the cache writes need it (measured, Lyra's 168 MB module on a cold visit):
// - a read while it downloads is answered as the bytes arrive (the compile overlaps the download; it waited for the whole
//   file), and every read gets the downloaded chunks themselves instead of a copy of each (moduleStream);
// - a download that breaks or ends short after such a read was answered errors that read (no truncated module), and the file is
//   marked failed before the read wakes, so the page's fallback (wasm-loader.js: it loads the module again and compiles it from
//   bytes) and every other read of it go to the network whole, as a failed fill's did. The read is not continued from the
//   network by range: the fill's download is the sha1-qualified URL's, a range of the plain URL can come from a newer build
//   (spliced onto this build's first bytes at the same length), and a host may apply the range to an encoded (Brotli)
//   representation, so its 206 would start at the wrong decoded byte. A broken download recovered so in Chrome: READY 8.7-8.8 s vs 8.4 s healthy;
// - the chunks are detached once every page whose read was given them posts 'module-compiled' (its WebAssembly.Module exists,
//   so V8/JSC hold their own copy), or 15 s after that page's read ended if no such message comes;
// - once every cache piece is stored (its cache.put succeeded, so its Blob was readable), reads of the module move to those
//   Blobs and the download is released (fill: moduleEarly), instead of after the pieces' sha1 check and every other file's
//   writes. A piece write that fails never releases it: the download stays the read fallback. Lyra, cold, a cloud host: the worker
//   held the module's 160 MiB from its download (1 s) to 5.1 s, now to 2.3 s; at the compile + 0.5 s the worker's
//   buffers were 327 -> 164 MiB and the renderer's Pss 852 -> 707 MiB
// url?v=sha1 (as the fills: two builds' modules are two states) -> {key, url, size, open, readers, detach, pieces, settled,
// drop, early} of the module downloading now, or held in memory, or read by a page that has not said it compiled
const moduleReads = new Map();
// A read of the module: {client, held, done}. held: it ended with the whole module, so its page may still hold the chunks it was
// given; done: its page said it compiled (or 15 s went by), or the read was cancelled
const moduleHeld = (module) => module.readers.some((reader) => reader.held && !reader.done);
function moduleStream(module, progress, client) {
  let next = 0;
  let sent = 0;        // bytes this read was given
  let open = true;     // false once the read ended or the page cancelled it: a pull still waiting then hands out nothing
  const reader = { client: client || '', held: false, done: false };
  module.readers.push(reader);
  if (!moduleReads.has(module.key)) moduleReads.set(module.key, module);   // a held download read again after its state went
  ++module.open;
  const end = (closed) => {
    if (!open) return;
    open = false;
    --module.open;
    // the reader may still hold the last chunks it was given; a page that never says it compiled (an older page, a failed
    // compile) has them detached 15 s on, long after the browser has passed them on
    if (closed && !reader.done) { reader.held = true; setTimeout(() => readerDone(module, reader), 15000); } else reader.done = true;
    if (module.drop) module.drop();
    // the early switch to the stored pieces' Blobs waited for this read (moduleEarly); once the fill's writes are over too,
    // nothing is left to switch and the pieces' Blobs are let go (moduleSettle left them for this)
    if (module.early) module.early();
    if (module.settled && !module.open) { module.pieces = null; module.early = null; }
    moduleRetire(module);
  };
  return new ReadableStream({
    async pull(controller) {
      while (open && next >= progress.parts.length && !progress.done) await new Promise((f) => progress.wake.push(f));
      if (!open) return;   // cancelled while it waited: nothing is enqueued for a page that no longer reads
      // every chunk in so far at once, instead of one per pull (about 64 KB each, 2,600 for Lyra's module)
      if (next < progress.parts.length) {
        while (next < progress.parts.length) { const part = progress.parts[next++]; sent += part.byteLength; controller.enqueue(part); }
        return;
      }
      // the bytes differ from the list (fill hashed them as they came, progress.differs): the read errors, so the compile makes no
      // module of them; the page's load of it again waits for the second fetch (refetchCode)
      if (progress.verdict) await progress.verdict;
      if (!open) return;
      if (progress.differs) {
        post({ type: 'log', text: `SW MODULE_REFUSED ${module.url.split('/').pop()}: its bytes differ from wasm-cache.json; the read errors (no module from them)` });
        controller.error(new Error('the module differs from wasm-cache.json'));
      } else if (progress.failed || (module.size && sent !== module.size)) {
        // the download broke or ended short: the read errors rather than hand the compile a truncated module; the file is failed
        // already, so the page's next load of the module goes to the network whole (see moduleReads)
        post({ type: 'log', text: `SW MODULE_FAILED ${module.url.split('/').pop()}: its download stopped at ${sent} of ${module.size} bytes${progress.failed ? ' (it failed)' : ''}; the read errors and the page loads it again` });
        controller.error(new Error(`the module read got ${sent} of ${module.size} bytes`));
      } else controller.close();
      end(true);
    },
    cancel() { end(false); },
  });
}
// The page's 'module-compiled': the module's chunks that page's reads were given are no longer read. Only its own reads are
// done (another page may still compile from the same chunks); the page read its own build's module, so any build's state with
// this URL is looked at, and only reads by this page count
function moduleCompiled(url, client) {
  if (!client) return;
  for (const module of [...moduleReads.values()]) {
    if (module.url !== url) continue;
    for (const reader of module.readers.slice()) if (reader.client === client) readerDone(module, reader);
  }
}
function readerDone(module, reader) {
  if (reader.done) return;
  reader.done = true;
  if (!moduleHeld(module)) {
    for (const buffer of module.detach.splice(0)) {
      try { buffer.transfer(0); } catch (e) { /* left to the GC */ }
    }
  }
  if (module.drop) module.drop();
  moduleRetire(module);
}
// The fill's writes are over (or it failed): no early switch is left to make, so the pieces' Blobs are let go. After writes
// that succeeded (stored: the pieces and the index are in, the sha1 matched), a read still open keeps them: the switch waited for
// it (moduleEarly), and its end makes it then, so the downloaded chunks go as soon as no read needs them instead of at the later
// switch to the stored copy's disk-backed Blob (moduleStream: end). After a failure they go at once: the stored pieces are
// deleted, and a Blob of a deleted entry can be unreadable
function moduleSettle(module, stored = false) {
  module.settled = true;
  if (!stored || !module.open) {
    module.pieces = null;
    module.early = null;
  }
  moduleRetire(module);
}
// The module's state goes once nothing can use it: its writes are over, and no read of it is open or waits for its page
function moduleRetire(module) {
  module.readers = module.readers.filter((reader) => !reader.done);
  if (!module.settled || module.open || module.readers.length) return;
  if (moduleReads.get(module.key) === module) moduleReads.delete(module.key);
}

// A load an earlier visit cut off resumes with a Range request from resumeAt. When the container has a usable staged tail that
// this worker holds (loaded ahead, or arriving within PIECE_STALL_MS), the request stops before the tail and the tail's bytes
// follow it, so the tail does not cross the link twice; else the range runs to the end of the file, as before
const resumeSkipped = new Set();   // the files whose kept pieces one load passed over for the whole .br (see fill)
const sentBrotli = new Map();   // key -> whether the host sent that file's whole load with Brotli (see fill; <key>&brotli: it did)
async function resumeFetch(url, entry, resumeAt) {
  // (by the versioned URL, the one the whole-file load asks for: the rest is asked of the listed build, not of the bare URL)
  const range = (to) => fetch(url + '?v=' + entry.sha1, signalled(url + '?v=' + entry.sha1, { cache: 'no-store', headers: { Range: 'bytes=' + resumeAt + '-' + to } }));
  if (!entry.tail || piecedLayoutProblem(entry) !== null || resumeAt >= entry.tail.offset) return range('');
  const tail = await Promise.race([loadPiece(url, entry, 'tail'), new Promise((resolve) => setTimeout(() => resolve(null), PIECE_STALL_MS))]);
  if (!tail || tail.offset !== entry.tail.offset || tail.offset + tail.bytes.byteLength !== entry.size) return range('');
  const response = await range(String(tail.offset - 1));
  if (response.status !== 206 || !response.body) return response;   // fill() treats anything but a 206 as a failed resume
  const reader = response.body.getReader();
  let tailSent = false;
  return new Response(new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (!done) { controller.enqueue(value); return; }
      if (!tailSent) { tailSent = true; controller.enqueue(tail.bytes.slice()); }
      controller.close();
    },
    cancel(reason) { return reader.cancel(reason); },
  }), { status: 206, headers: response.headers });
}

// Fetch the whole file once into the cache; resolves to the cached Response (or null on failure)
// (page: the window client id the load is for, '' or none when unknown; a stopped page's call starts no load, stopLoads)
function fill(url, entry, page) {
  const key = url + '?v=' + entry.sha1;
  const running = pending.get(key);
  if (running && !loadAborted(running.load)) { interest(key, page); return running; }
  // (a load a stop aborted is not joined: a page that did not stop loads the file again once that load, its writes and its
  // deletions are over)
  const prior = loads.get(key);
  // (an aborted one, or one whose download is over and whose writes are not, with no copy in memory to answer from)
  const settling = !!(prior && prior.settled && !prior.done) && (loadAborted(prior) || (!running && !blobs.has(key)));
  if (settling) return stoppedPages.has(page) ? Promise.resolve(null) : prior.settled.then(() => fill(url, entry, page));
  if (running) return stoppedPages.has(page) ? Promise.resolve(null) : running.then(() => fill(url, entry, page), () => fill(url, entry, page));
  // (a 6.2 MB .ucas body crossed the wire twice): a file whose load has ended is in memory before
  // its Cache Storage write lands; a read that passed the handler's in-memory check while the load ran, and calls fill() after
  // it ended, found no pending load and no stored copy and loaded the whole file again. The ended load's copy answers it
  const loaded = blobs.get(key);
  if (loaded && !(loaded.unstored && !stoppedPages.has(page))) {
    if (loads.has(key)) interest(key, page);   // (a load still writing the file is this page's too: no other page's stop aborts it)
    return Promise.resolve(loaded.memory ? new Response(null) : new Response(loaded, { headers: headers(typeOf(url), { 'Content-Length': String(loaded.size) }) }));
  }
  if (page && stoppedPages.has(page)) return Promise.resolve(null);   // (stopLoads)
  const load = interest(key, page);
  const stopped = () => loadAborted(load);
  let started = null;
  starting.set(key, new Promise((resolve) => { started = resolve; }));
  const job = (async () => {
    const cache = await caches.open(CACHE);
    const lookup = await mayBeStored(key);
    const hit = lookup ? await cachedResponse(cache, key) : null;
    if (hit) {
      report(url, entry.size, true);
      // keep the stored copy's (disk-backed) Blob, so the engine's first read of the file does not
      // look its pieces up again (pakchunk0's 27 matches) during engine_preinit; the prefetch of a warm visit makes it here
      if (!blobs.has(key)) {
        try { const disk = await hit.blob(); if (!blobs.has(key)) blobs.set(key, disk); return new Response(disk); } catch (e) { return null; }
      }
      return new Response(blobs.get(key));
    }
    // the pieces an earlier visit stored are kept, and only the rest is fetched (raw bytes, by range)
    const fetchStarted = performance.now();
    let kept = entry.parts || !entry.size || !lookup ? [] : await storedPieces(cache, key);
    // A resume is a Range request, which serve.py and most hosts answer without Content-Encoding: the rest crosses the link
    // as identity bytes. It goes ahead only when those are fewer than the whole file's Brotli (the list's br); else the .br
    // loads again from byte 0, over the kept pieces (UE-411927: a Lyra-size module resumed at 72 MB took 64.1 MB of identity
    // bytes where its whole .br is 25.6 MB)
    // (once per file: a .br load that is cut off again resumes from its kept pieces, so a link that keeps breaking at the same
    // point still moves the stored prefix forward. Only for a file whose whole load the host is known to send with Brotli (seen
    // in a same-origin answer's Content-Encoding): one sent without it, or whose encoding a cross-origin answer hides, resumes,
    // since its whole file may be identity bytes too. Not for a file staged in pieces (entry.body: its whole load is the staged
    // pieces, not the .br). Both facts are kept beside the pieces (<key>&skipped, <key>&brotli), written before the load goes
    // on, so a worker restart between the visits keeps them)
    const marked = async (mark) => !!(await cache.match(key + mark).catch(() => null));
    const skippedBefore = kept.length > 0 && (resumeSkipped.has(key) || await marked('&skipped'));
    const brotliHost = kept.length > 0 && (sentBrotli.get(key) === true || (sentBrotli.get(key) !== false && await marked('&brotli')));
    let skipping = false;   // this load passes over the kept pieces: recorded (&skipped) once its .br brings its first bytes
    // (not for a container with a staged tail either: a resume stops before its held tail, so the rest is not all identity bytes)
    if (kept.length && entry.br > 0 && !entry.body && !entry.tail && brotliHost && entry.size - kept.length * CACHE_PART_BYTES >= entry.br && !skippedBefore) {
      skipping = true;
      post({ type: 'log', text: `SW RESUME_SKIPPED ${url.split('/').pop()}: the rest after ${kept.length} kept pieces is ` +
        `${entry.size - kept.length * CACHE_PART_BYTES} identity bytes, the whole .br ${entry.br}: loading the .br from 0` });
      kept = [];
    }
    const resumeAt = kept.length * CACHE_PART_BYTES;
    const resuming = resumeAt > 0 && resumeAt < entry.size;
    let response = null;
    try {
      response = resuming ? await resumeFetch(url, entry, resumeAt) : await fetchWhole(key, entry, url);
    } catch (e) {
      if (stopped()) throw e;   // a stop's abort is no failure of the file (the catch below)
      problem(key, `${e} (no response: the host or the connection is gone)`, true);
      return null;
    }
    if (!response.ok || (resuming && response.status !== 206)) {
      problem(key, 'HTTP ' + response.status, false,
        // (a resume starts inside the list's size: its 416 is a host copy cut short there, as rangeRefused has it)
        response.status >= 400 ? { url, status: response.status, expected: entry.size } : null);
      return null;
    }
    // (a successful answer with no body is a failed load too: its reads, the module's streamed one included, go to the network)
    if (!response.body) { problem(key, 'HTTP ' + response.status + ' with no body'); return null; }
    if (resuming) post({ type: 'log', text: 'SW RESUME ' + url.split('/').pop() + ' at ' + resumeAt + ' (' + kept.length + ' pieces kept)' });
    // what the host sends this file's whole load as, when the list gives it a .br size: Brotli or not (a same-origin answer's
    // Content-Encoding; a cross-origin one does not show it, and says nothing)
    else if (entry.br > 0 && !entry.parts && !entry.body) {
      const encoding = response.headers.get('Content-Encoding');
      const brotli = encoding ? /\bbr\b/i.test(encoding) : response.type === 'basic' ? false : null;
      if (brotli !== null) sentBrotli.set(key, brotli);
      if (brotli === true) await cache.put(key + '&brotli', new Response('')).catch(() => {});
      else if (brotli === false) await cache.delete(key + '&brotli').catch(() => {});
    }
    // the body is read once, in pieces (the page's progress bar), into chunks that answer reads as soon as the download
    // ends (memoryFile); the cache write takes its pieces from the same chunks alongside (queuedPut).
    // (Measured: reads answered only after the cache write put the runtime 0.34 s and pakchunk0's mount 0.53 s later.) When
    // the writes are done, reads move to the stored file's disk-backed Blob and the chunks can be collected
    // (a warm visit downloaded 209.6 MB again: one cache.put of a large container had failed) the body is stored in CACHE_PART_BYTES pieces as
    // it arrives (one cache.put of a large container failed with NetworkError), plus a small index entry; a visit finds
    // the file only once every piece and the index are in (cachedResponse)
    const puts = load.puts = [];   // (its piece writes: the load settles after them)
    let pieceIndex = resuming ? kept.length : 0;
    let partChunks = [];
    let partBytes = 0;
    // the game's module (moduleReads): its pieces' Blobs (pieces), to read it from once every one is stored (moduleEarly). A
    // fill that resumes from pieces an earlier visit stored makes no early switch (pieces null): those pieces are only checked
    // with the rest (the SHA-1 and the index), and a failure deletes them, so reads stay on the download until the stored copy
    // is complete
    const module = isWasm(url) && !entry.parts ? { key, url, size: entry.size, open: 0, readers: [], detach: [], pieces: resuming ? null : kept.slice(),
      settled: false, drop: null, early: null } : null;
    let piecesStored = pieceIndex;
    let pieceCount = -1;   // known once the download has ended
    let held = null;       // what blobs holds for this file now (the download, the pieces' Blob, the stored copy)
    if (module) moduleReads.set(key, module);
    const moduleEarly = () => {
      if (!module || !module.pieces || pieceCount < 0 || piecesStored < pieceCount || module.open || !held || !held.memory || blobs.get(key) !== held) return;
      const pieces = new Blob(module.pieces);
      if (pieces.size !== held.size) return;
      module.pieces = null;
      const download = held;
      blobs.set(key, pieces);
      held = pieces;
      download.release();
      post({ type: 'log', text: `SW MODULE_RELEASED ${url.split('/').pop()}: reads from its ${pieceCount} stored pieces' Blobs until the stored copy is checked` });
    };
    if (module) module.early = moduleEarly;
    const flushPart = () => {
      if (!partBytes) return;
      const chunks = partChunks;
      const index = pieceIndex;
      // a module piece counts once its write has succeeded: that write read its Blob whole (a Blob made too fast can come out
      // unreadable, see queuedPut), and a failed one leaves the download as the read fallback
      puts.push(queuedPut(cache, key + '&part=' + index, () => {
        const body = new Blob(chunks);
        chunks.length = 0;
        if (module && module.pieces) module.pieces[index] = body;
        return body;
      }, load).then(() => {
        // the store index this worker read at its start learns the piece, so a load this worker starts again after a cut
        // sees the pieces it kept (resume or not: see above), as a new worker would
        indexStore().then((stored) => { if (stored) stored.pieces.add(key); }).catch(() => {});
        if (module) { ++piecesStored; moduleEarly(); }
      }));
      ++pieceIndex;
      partChunks = [];
      partBytes = 0;
    };
    const parts = [];
    let loaded = 0;
    for (const piece of resuming ? kept : []) {   // the kept pieces first: reads and the Blob see the file from byte 0
      parts.push(new Uint8Array(await piece.arrayBuffer()));
      loaded += piece.size;
    }
    let reported = 0;
    const progress = { parts, loaded, done: false, failed: false, wake: [], started: performance.now(), netBytes: 0 };
    // the page's whole read of the module while it downloads (the fetch handler)
    if (module) progress.stream = (client) => moduleStream(module, progress, client);
    // the game's code is hashed beside its download (isCode, hashAlong): its outcome (progress.got, progress.differs) is known soon
    // after its last byte, before the module's read ends; the file answers no read before it (blobs waits for it below)
    const hasher = isCode(url) && /^[0-9a-f]{40}$/i.test(entry.sha1 || '') ? new Sha1() : null;
    if (hasher) {
      progress.verdict = hashAlong(progress, hasher).then((sha1) => {
        if (sha1 === null) return;
        progress.got = { size: progress.loaded, sha1 };
        progress.differs = differs(progress.got, entry);
      });
    }
    const notify = () => { const wake = progress.wake; progress.wake = []; for (const f of wake) f(); };
    arriving.set(key, progress);
    started(progress);
    const reader = response.body.getReader();
    // a read that waited RANGE_WAIT_STALL_MS on this load with no byte arriving ends it: the load then fails as one that broke off
    // (its file and every later read go to the network), with no second copy of its bytes in flight
    progress.stop = () => { progress.stalled = true; reader.cancel().catch(() => {}); };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (progress.stalled) throw new TypeError(`stalled: no byte for ${RANGE_WAIT_STALL_MS} ms`);
        if (done) break;
        if (skipping && value.byteLength) {
          skipping = false;
          resumeSkipped.add(key);
          await cache.put(key + '&skipped', new Response('')).catch(() => {});
        }
        parts.push(value);
        for (let at = 0; at < value.byteLength;) {   // exact piece boundaries
          const take = Math.min(value.byteLength - at, CACHE_PART_BYTES - partBytes);
          partChunks.push(value.subarray(at, at + take));
          partBytes += take;
          at += take;
          if (partBytes === CACHE_PART_BYTES) flushPart();
        }
        loaded += value.byteLength;
        progress.loaded = loaded;
        progress.lastByteAt = performance.now();
        notify();
        if (loaded - reported >= (1 << 20)) { reported = loaded; report(url, loaded, false); }
      }
    } catch (e) {
      progress.failed = true;
      Promise.all(puts).catch(() => {});   // (the piece writes this load queued end on their own; a stop drops those still waiting)
      // say where a whole-file load broke (one cold load in 16 on the live host, not reproduced with net logs). The counts
      // are decoded bytes (what the reader got, kept pieces included); the wire size is the response's own as the list
      // states it: the whole .br, or the identity bytes a resume asked for (UE-411927: "112386350 of 25622250" mixed them)
      const encoding = response.headers.get('Content-Encoding') || 'identity';
      const wire = encoding === 'br' && entry.br ? `the whole .br, ${entry.br} bytes` : `${entry.size - resumeAt} identity bytes${resuming ? ' from ' + resumeAt : ''}`;
      const error = new Error(`${e} after ${loaded} of ${entry.size} decoded bytes (on the wire: ${encoding}, ${wire}; ` +
        `${Math.round(performance.now() - fetchStarted)} ms in, ${pending.size} loads in flight)`);
      error.network = !(e && e.http);   // (a staged file's fallback that the host refused is no network break)
      throw error;
    } finally {
      // a broken or short download is failed before its readers wake (the module's read then errors, moduleStream), so the
      // page's next load of it, and any read that comes after, goes to the network. A whole code body that differs from the
      // list (size or sha1) is not failed: its readers' reads error (moduleStream) or wait, and it is fetched once more below
      if (!stopped() && (progress.failed || (!hasher && entry.size && loaded !== entry.size))) failed.add(key);
      progress.done = true;
      arriving.delete(key);
      notify();
    }
    report(url, loaded, false);
    flushPart();
    const count = pieceIndex;
    // no whole-file Blob of the download (it doubled the Blob bytes, and the 41 MB global shader
    // archive's came back unreadable on cold desktop visits: CACHE_PUT_FAILED, then READ_FAILED on the engine's first read);
    // reads use the chunks until the stored copy's disk-backed Blob replaces them
    if (progress.verdict) await progress.verdict;   // the code's hash (its download's chunks stay whole until then)
    const blob = memoryFile(parts, loaded, module);
    pieceCount = pieceIndex;
    const writing = Promise.all(puts).then(async () => {
      // checked on the stored pieces (disk-backed Blobs, read asynchronously), not on a copy of the download made on this
      // worker's thread, which held up the engine's reads (about 0.6 GB copied during engine_preinit)
      const stored = [];
      let storedSha1 = null;   // a data file's body, for a mismatch message (sha1 or size)
      for (let i = 0; i < count; i++) {
        const piece = await cache.match(key + '&part=' + i);
        if (!piece) throw new Error('piece ' + i + ' of ' + count + ' is not stored');
        stored.push(await piece.blob());
      }
      // a code file was hashed as it arrived: its stored pieces are only read back (a piece that came out unreadable fails here)
      if (hasher) {
        if (progress.differs) throw new Error('sha1 differs from the list (' + entry.sha1 + ')');
        for (const piece of stored) await piece.arrayBuffer();
      } else {
        const got = storedSha1 = await sha1Of(stored, entry.sha1);
        if (got !== null && got !== entry.sha1.toLowerCase()) throw Object.assign(new Error('sha1 differs from the list (' + entry.sha1 + ')'), { got });
      }
      if (stopped()) throw new Error('stopped: not stored (stopLoads)');
      await cache.put(key + '&parts', new Response(JSON.stringify({ parts: count, size: loaded })));
      if (stopped()) { await cache.delete(key + '&parts'); throw new Error('stopped: not stored (stopLoads)'); }   // (a stop during it)
      return storedSha1;
    });
    // a read's fetch event holds these writes too (holdFor in the fetch handler)
    const settled = writing.catch(() => {}).finally(() => { if (writes.get(key) === settled) writes.delete(key); });
    writes.set(key, settled);
    // a code body that differs is never read from (its pieces are deleted once written) and is fetched once more
    if (progress.differs) {
      writing.catch(() => {}).finally(() => deleteCached(cache, key)).catch(() => {});
      if (module) moduleSettle(module);
      blob.release();
      refetchOwners.set(progress.got, load);   // (its second fetch is this load's: fetchHashed)
      return refetchCode(key, url, entry, progress.got);
    }
    if (entry.size && blob.size !== entry.size) {
      // a data file: its reads go to the network (problem), and every page is told once, with the body's sha1 once its stored
      // pieces are hashed
      writing.then((sha1) => sha1 || null, (e) => (e && e.got) || null).then((sha1) => mismatch(key, 'data', url, entry, { size: blob.size, sha1 }));
      writing.catch(() => {}).finally(() => deleteCached(cache, key)).catch(() => {});
      problem(key, `size ${blob.size}, the list says ${entry.size} (Content-Encoding ${response.headers.get('Content-Encoding')})`, false,
        blob.size < entry.size ? { url, status: response.status, expected: entry.size, got: blob.size } : null);
      // the module's whole body (not of staged pieces or parts) shorter than the list: the host's file is cut short, and the page's
      // read of it was this load's stream (moduleStream), which saw no other answer, so the pages are told here. Another file's
      // short fill is told by its reads, which go to the network (fileAnswered)
      // (no page is told from the fill: the page's retry of the module reads it from the network, whose answer is the report,
      // fileAnswered, so a fill cut short that the retry then gets whole names nothing)
      return null;
    }
    blobs.set(key, blob);
    held = blob;
    // the module's whole body, its sha1 checked, came through the HTTP cache (fetchWhole): fillHttpCache asks whether it was kept
    if (!resuming && viaHttpCache(url, entry)) httpLoaded.set(key, Number(response.headers.get('Content-Length')) || entry.br || entry.size || 0);
    moduleEarly();
    const stored = new Response(null);   // reads take the file from blobs
    writing.then(async () => {
      if (module) moduleSettle(module, true);
      indexStored(key, true);
      post({ type: 'log', text: `SW STORED ${url} ${blob.size}` });
      // Reads move to the stored file's disk-backed Blob only once it is there whole; any trouble keeps the in-memory one
      try {
        const disk = await cachedResponse(cache, key);
        const diskBlob = disk ? await disk.blob() : null;
        if (diskBlob && diskBlob.size === blob.size) afterWrites(() => { if (blobs.get(key) === held) { blobs.set(key, diskBlob); held = diskBlob; blob.release(); } });
      } catch (e) { post({ type: 'log', text: 'SW STORED_UNREADABLE ' + key + ': ' + e + ' (reads stay on the downloaded copy)' }); }
      // older versions go through prune(), which keeps what the current list and every live page's build name
      // (a fill of an older build finishing after a newer one no longer deletes the newer file)
      prune(await manifest()).catch(() => {});
    // a piece that could not be stored (quota, NotReadableError) leaves no index entry, so the next visit downloads the file
    // again. (3 of 20 runs: an IoStore read error right after CACHE_PUT_FAILED): reads had moved to the stored
    // copy's Blob, whose pieces this catch then deleted. Now reads stay on (or go back to) the downloaded copy, and a read that
    // cannot be served from it goes to the network (slice)
    }).catch((e) => {
      // a stop during the writes is no failure: the download is let go (only stopped pages wanted it) and the pieces stored stay
      // for a later visit to resume (no index entry, so none is read)
      if (stopped()) {
        if (module) moduleSettle(module);
        if (blobs.get(key) === held) blobs.delete(key);
        blob.release();
        post({ type: 'log', text: `SW STOPPED ${url.split('/').pop()}: its cache writes were cut off` });
        return;
      }
      errors.push(key + ': cache.put ' + e);
      post({ type: 'log', text: 'SW CACHE_PUT_FAILED ' + key + ' ' + blob.size + ': ' + e });
      if (module) moduleSettle(module);
      // later reads go to the network; the rejected download is let go, and every page is told once (a data file: a code file
      // that differs never gets here)
      if (/sha1 differs/.test(String(e))) {
        failed.add(key); blobs.delete(key); blob.release();
        if (e.got) mismatch(key, 'data', url, entry, { size: blob.size, sha1: e.got });
      }
      else blobs.set(key, held || blob);   // the downloaded copy, or the module's stored pieces' Blobs (moduleEarly)
      // no room (quota, or Chrome's "Unexpected internal error" on a large store): files not cached yet go to the network
      const notReadable = /NotReadable/i.test(String(e)) && ++notReadableFailures >= 2;
      if ((/quota|QuotaExceeded|internal error/i.test(String(e)) || notReadable) && !storeBroken) {
        storeBroken = true;
        post({ type: 'log', text: 'SW STORE_BROKEN after ' + String(e).slice(0, 120) + ': files not cached yet are read from the network' });
      }
      deleteCached(cache, key).catch(() => {});
    });
    return stored;
  })().catch((e) => {
    // a load a stop aborted is not failed: a page that did not stop loads the file again (stopLoads)
    if (stopped()) { post({ type: 'log', text: `SW STOPPED ${url.split('/').pop()}: its load was aborted` }); return null; }
    problem(key, String(e), !!(e && e.network));
    return null;
  }).finally(() => {
    if (loadEnds.has(key)) { endLoad(key); loadEnds.delete(key); }   // no read waits on a piece of a load that has ended
    // the container's staged pieces served this load only: their buffers go with it (reads now take the loaded or stored file)
    for (const piece of [...tails.keys()]) if (piece.startsWith(key + '#')) tails.delete(piece);
    if (pending.get(key) === job) { pending.delete(key); starting.delete(key); }
    started(null);
    // the module's state lives while its download is held or read (moduleCompiled may still come); a failed load keeps it
    // only for its reads (this build's: another build's state is its own)
    const module = moduleReads.get(key);
    if (module && !blobs.has(key)) moduleSettle(module);
  });
  job.load = load;
  // the load has settled once its job, its cache writes and the deletions they start are over (one turn after the writes: a failed
  // write's deletion starts just after it), and it leaves the registry then
  load.settled = job.catch(() => null).then(() => Promise.all((load.puts || []).map((put) => put.catch(() => {}))))
    .then(() => writes.get(key)).then(() => new Promise((turn) => setTimeout(turn, 0)))
    .then(() => deleting.get(key)).catch(() => {}).then(() => { load.done = true; if (loads.get(key) === load) loads.delete(key); });
  pending.set(key, job);
  return job;
}

// a range read of a file still arriving, answered once its last byte is in; null when the download ends first (the read
// then takes the whole file's Blob)
// a range goes to the network only while the whole-file load is more than RANGE_NET_MIN_S from
// done at its current rate, and only up to RANGE_NET_MAX_BYTES of raw bytes per file (each such byte is fetched twice)
const RANGE_NET_MIN_S = 0.5;
const RANGE_NET_MAX_BYTES = Infinity;   // a 32 MiB cap cost 9.2 s at 50 Mbit (reads waited for the fill again)
// ...and never for a file of RANGE_WAIT_BYTES or less: the fetch backend's first read of a file is its first two 1 MiB chunks
// (WasmIoWorker.cpp FirstFetch, Range: bytes=0-2097151), which for such a file is half of it or more, raw, while its whole-file
// load (Brotli) brings those bytes in fewer bytes on the wire. In a load's first 0.2 s its rate is not known, so the time rule
// above sent every such read to the network: each project shader archive of a deferred cold load came twice (UE-411929).
// Only a file loaded as one stream from byte 0: a container staged in pieces (head, body, tail) keeps the rules above
const RANGE_WAIT_BYTES = 4 * 1024 * 1024;
// a read waiting on a load that has brought no byte for RANGE_WAIT_STALL_MS (since its last byte, or its start: a stalled
// connection) goes to the network, and so does every later read of it while it stays quiet; a load that breaks off (a cut-off
// connection) wakes its reads at once, which then read the file from the network
const RANGE_WAIT_STALL_MS = 1000;
function worthNetwork(progress, entry, range) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
  if (!match || !entry.size || (entry.size <= RANGE_WAIT_BYTES && !entry.head && !entry.body && !entry.tail)) return false;
  const last = match[2] === '' ? entry.size - 1 : Math.min(Number(match[2]), entry.size - 1);
  const bytes = last - Number(match[1]) + 1;
  if (progress.netBytes + bytes > RANGE_NET_MAX_BYTES) return false;
  const seconds = (performance.now() - progress.started) / 1000;
  const rate = seconds > 0.2 ? progress.loaded / seconds : 0;   // bytes per second of the fill (decoded)
  if (rate > 0 && (last + 1 - progress.loaded) / rate < RANGE_NET_MIN_S) return false;
  progress.netBytes += bytes;
  return true;
}

// true when the bytes of this range are already in (no wait)
function arrivedBy(progress, entry, range) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
  if (!match || !entry.size) return false;
  const last = match[2] === '' ? entry.size - 1 : Math.min(Number(match[2]), entry.size - 1);
  return progress.loaded > last;
}

// stallMs: 'stalled' once the load has brought no byte for that long (0: wait for as long as the load runs)
async function partial(progress, entry, range, url, stallMs = 0) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
  if (!match || !entry.size) return null;
  const first = Number(match[1]);
  const last = match[2] === '' ? entry.size - 1 : Math.min(Number(match[2]), entry.size - 1);
  if (first > last) return null;
  while (progress.loaded <= last && !progress.done) {
    const quiet = stallMs - (performance.now() - (progress.lastByteAt || progress.started));   // (a monotonic clock: a wall-clock change moves no stall)
    if (stallMs && quiet <= 0) return 'stalled';
    await new Promise((f) => {
      // a wait that times out takes its wake callback back out of the load's list (a stalled load keeps no callback per read)
      const wake = () => { clearTimeout(timer); f(); };
      const timer = stallMs ? setTimeout(() => { const i = progress.wake.indexOf(wake); if (i >= 0) progress.wake.splice(i, 1); f(); }, quiet) : 0;
      progress.wake.push(wake);
    });
  }
  if (progress.done) return null;
  // Only the pieces the range covers (a Blob of everything arrived would copy up to the whole file per read)
  const pieces = [];
  let offset = 0;
  for (const part of progress.parts) {
    const end = offset + part.byteLength;
    if (end > first && offset <= last) pieces.push(part.subarray(Math.max(0, first - offset), Math.min(part.byteLength, last + 1 - offset)));
    if (end > last) break;
    offset = end;
  }
  const bytes = new Blob(pieces);
  return new Response(bytes, { status: 206, headers: headers(typeOf(url), {
    'Content-Range': `bytes ${first}-${last}/${entry.size}`, 'Content-Length': String(last - first + 1) }) });
}

// A read is copied out of its Blob before it is answered (up to READ_CHECK_BYTES; the engine reads ranges of a few MiB), so a
// Blob that can no longer be read (a stored copy whose pieces went away, a NotReadableError) is caught here: the file is
// dropped from the cache and this read, and every later one, goes to the network instead of failing the engine's IoStore read
const READ_CHECK_BYTES = 64 * 1024 * 1024;
async function readable(key, blob, url, range) {
  if (blob.size > READ_CHECK_BYTES) return blob;
  try {
    return await blob.arrayBuffer();
  } catch (e) {
    blobs.delete(key);
    failed.add(key);
    errors.push(key + ': read ' + e);
    post({ type: 'log', text: 'SW READ_FAILED ' + key + ' ' + (range || 'whole') + ': ' + e + ' (from the network from now on)' });
    caches.open(CACHE).then((c) => deleteCached(c, key)).catch(() => {});
    return null;
  }
}
async function slice(key, response, range, url, client) {
  let blob = blobs.get(key);
  if (!blob) {
    try { blob = response.body ? await response.blob() : null; } catch (e) { blob = null; }
    if (!blob) { failed.add(key); return toNetwork(key, range); }
    blobs.set(key, blob);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (blob.memory) {
    if (!match) return new Response(blob.stream(client), { status: 200, headers: headers(typeOf(url), { 'Content-Length': String(blob.size) }) });
    const first = match[1] === '' ? Math.max(0, blob.size - Number(match[2])) : Number(match[1]);
    const last = match[1] === '' || match[2] === '' ? blob.size - 1 : Math.min(Number(match[2]), blob.size - 1);
    if (first > last || first >= blob.size) {
      return new Response(null, { status: 416, headers: headers(typeOf(url), { 'Content-Range': `bytes */${blob.size}` }) });
    }
    return new Response(blob.copy(first, last), { status: 206, headers: headers(typeOf(url), {
      'Content-Range': `bytes ${first}-${last}/${blob.size}`, 'Content-Length': String(last - first + 1) }) });
  }
  if (!match) {
    const whole = await readable(key, blob, url, range);
    if (!whole) return toNetwork(key, range);
    return new Response(whole, { status: 200, headers: headers(typeOf(url), { 'Content-Length': String(blob.size) }) });
  }
  let first = match[1] === '' ? Math.max(0, blob.size - Number(match[2])) : Number(match[1]);
  let last = match[1] === '' || match[2] === '' ? blob.size - 1 : Math.min(Number(match[2]), blob.size - 1);
  if (first > last || first >= blob.size) {
    return new Response(null, { status: 416, headers: headers(typeOf(url), { 'Content-Range': `bytes */${blob.size}` }) });
  }
  // a read was copied out of the stored Blob on this worker's thread before it was
  // answered (readable), and every engine read waited for that copy (warm Lyra: 251 reads in engine_preinit, median 8.5 ms,
  // the worker's thread 0.56 s busy). The Blob slice is the answer now, so the browser hands the bytes to the reader without
  // this thread; the check that a stored copy is still readable is made once per CACHE_PART_BYTES piece instead (a 1-byte read)
  if (!(await piecesReadable(key, blob, first, last, url, range))) return toNetwork(key, range);
  return new Response(blob.slice(first, last + 1), { status: 206, headers: headers(typeOf(url), {
    'Content-Range': `bytes ${first}-${last}/${blob.size}`, 'Content-Length': String(last - first + 1) }) });
}
// key -> the pieces of its stored copy one read has already come from (a piece that went away fails its first read)
const piecesRead = new Map();
async function piecesReadable(key, blob, first, last, url, range) {
  let seen = piecesRead.get(key);
  if (!seen || seen.blob !== blob) piecesRead.set(key, seen = { blob, pieces: new Set() });
  for (let piece = Math.floor(first / CACHE_PART_BYTES); piece <= Math.floor(last / CACHE_PART_BYTES); piece++) {
    if (seen.pieces.has(piece)) continue;
    const at = piece * CACHE_PART_BYTES;
    if (!(await readable(key, blob.slice(at, Math.min(at + 1, blob.size)), url, range))) return false;
    seen.pieces.add(piece);
  }
  return true;
}

// A whole-file load a read starts outlives that read's answer (a range from the arrived bytes or the network), so the read's
// event holds the worker until the load is in: a browser stops a worker no event holds, which breaks the load in flight, and
// the next worker loads the file again
const holdFor = (event, job) => { try { event.waitUntil(job); } catch (e) { /* the event has ended: nothing to hold */ } return job; };
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  // the page asks the HTTP cache itself (only-if-cached: its copy of the game's module, for the browser's compiled-code cache).
  // Told apart without reading request.cache: only-if-cached needs mode 'same-origin', and that probe is the page's only
  // fetch() in that mode (a Worker's script loads in it too, with destination 'worker'). Reading request.cache of that
  // request crashed Chrome's renderer (exit code 133) when the page's cache was disabled through CDP
  // (Network.setCacheDisabled: Playwright, HAR recording) (UE-410982)
  if (request.mode === 'same-origin' && request.destination === '') return;
  // the page's session stream (serve.py --exit-after-session) goes straight to the network: it never ends, so it must not be
  // read or wrapped here
  if (request.url.split('?')[0].endsWith('/__ue/session')) return;
  if (request.url.endsWith('/__sw')) {
    event.respondWith(manifest().then(async (m) => {
      let storage = null;
      try { storage = await self.navigator.storage.estimate(); } catch (e) { storage = null; }
      return new Response(JSON.stringify({ version: SW_VERSION, cache: CACHE, killed, storageLow, lateReleased, storage, errors,
        failed: [...failed], mismatches: [...mismatches.values()], pieces: tails.size, files: m.size, keys: [...m.keys()].slice(0, 30) }), { headers: { 'Content-Type': 'application/json' } });
    }));
    return;
  }
  if (request.mode === 'navigate') {   // a new page load reads the current file list
    manifestPromise = null;
    // ... and loads again what the network broke for an earlier page (before any of its reads comes in)
    retryBroken();
    // the new list now, and with it a prune of what no open page's build names any more
    const listing = manifest().catch(() => {});
    if (event.waitUntil) event.waitUntil(listing);
    if (ISOLATE && isGamePage(request.url)) event.respondWith(fetch(request).then((r) => isolated(r, request)));
    return;
  }
  // The fetch backend asks for <directory>//<name>: collapse repeated slashes in the path before the lookup
  const url = request.url.split('?')[0].split('#')[0].replace(/([^:\/])\/{2,}/g, '$1/');
  let listed = null;
  event.respondWith((async () => {
    const map = await manifestFor(event.clientId);
    const entry = listed = map.get(url);
    if (!entry) return fetch(request).then((r) => isolated(r, request));
    // The fetch backend's size probe (HEAD, Range: bytes=0-) is answered from the list, so a host's precompressed
    // .br can never report a compressed length
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: headers(typeOf(url), { 'Content-Length': String(entry.size) }) });
    }
    const range = request.headers.get('Range');
    const cache = await openCache();
    const key = url + '?v=' + entry.sha1;
    // a read of a page that stopped starts no load and stores nothing (stopLoads): it joins a load under way, else it is read as
    // a file this worker does not store
    const page = pageOf(event.clientId);
    const stopped = () => stoppedPages.has(page);   // (asked at each step: the page may stop while its read waits)
    const storing = () => !stopped();
    const live = () => pending.has(key) && !loadAborted(pending.get(key).load);   // a load under way that no stop aborted
    // a code file that still differed from the list after its second fetch is refused; a data file that differed is read from
    // the network as before, and a page that has not heard of it yet is told (a reload in this worker's life)
    if (codeMismatch(key, entry)) return refuse(key, entry);
    if (mismatches.has(mismatchKey(key, entry.size))) tellMismatch(mismatchKey(key, entry.size));
    if (failed.has(key)) return toNetwork(key, range);
    // (not the copy of a load a stop aborted: the read waits for a fresh load, or is read as a file this worker does not store; nor,
    // for a page that has not stopped, a stopped page's unstored copy: fill starts the load that stores it)
    if (blobs.has(key) && !loadAborted(loads.get(key)) && !(blobs.get(key).unstored && !stopped())) {
      if (loads.has(key)) interest(key, page);   // (a load still writing the file is this page's too: no other page's stop aborts it)
      return slice(key, null, range, url, event.clientId);
    }
    // a file this worker is loading, or one Cache Storage has nothing of, is not looked up there (see indexStore)
    const hit = !pending.has(key) && await mayBeStored(key) ? await cachedResponse(cache, key) : null;
    if (hit) { report(url, entry.size, true); return slice(key, hit, range, url); }
    // a late chunk's range read before the level goes to the network. a whole read does not:
    // WasmFS's fetch backend reads a small file whole at its mount, and that plain GET went out on every load while this worker
    // loaded the same bytes again after the level; a whole read joins the file's one load. A late file is never split into parts
    // (PageContract.md; check_stage.py refuses it, the page stops on one), so its own URL serves the range
    if (isLate(entry) && !releasedPage(map) && !pending.has(key) && range) {
      if (!EARLY_LATE_FILL || !cacheable(url, entry) || stopped()) return rangeNetwork(cache, key, url, range, entry, storing);
      // (sw.js?late=early) this read starts the file's one load below, at low priority, and is answered as any read of a file
      // still arriving
      if (!lowPriority.has(key)) {
        lowPriority.add(key);
        post({ type: 'log', text: `SW LATE early fill ${url.split('/').pop()} (first read ${range})` });
      }
    }
    // Not cached yet: wait for the whole file. The game reads nearly all of each container before the level is ready
    // (58.7 of 60.6 MB of the main .ucas), so one Brotli load of the whole file is about a third of the bytes of
    // the reads
    // (a file whose load is under way, a tier prefetch's for one, joins that load: its bytes are being stored already and never
    // count against the room again)
    // a code file this worker can't store is still checked before any read gets its bytes (uncachedCode)
    const unstored = async () => {
      const prior = loads.get(key);
      if (loadAborted(prior) && prior.settled) await prior.settled;   // (so the code check's fetches are not the aborted load's)
      if (await uncachedCode(key, url, entry)) {
        const held = blobs.get(key);
        const answer = await slice(key, null, range, url, event.clientId);
        // (a page that stopped leaves a copy in memory that is no stored file: a later page's load stores it, fill)
        if (stopped() && cacheable(url, entry) && held && blobs.get(key) === held) held.unstored = true;
        return answer;
      }
      if (codeMismatch(key, entry)) return refuse(key, entry);
      return toNetwork(key, range);
    };
    if (!cacheable(url, entry) || (stopped() && !live()) || (!pending.has(key) && !(await fits(entry.size)))) return unstored();
    // The event holds the worker until the whole-file load and its cache writes (pieces, sha1 check, index) are done
    const filling = fill(url, entry, page);
    holdFor(event, filling.then(() => writes.get(key)).catch(() => {}));
    // (an aborted load's pieces and stream answer no read: the read waits for its fill's answer)
    const fromTail = live() ? await tailRead(entry, range, url) : null;
    if (fromTail) return fromTail;
    const progress = live() ? arriving.get(key) || await starting.get(key) : null;
    // the module's whole read joins its download (moduleStream): the page compiles as the bytes arrive
    if (progress && !range && progress.stream && !progress.done) {
      return new Response(progress.stream(event.clientId), { status: 200, headers: headers(typeOf(url), { 'Content-Length': String(entry.size) }) });
    }
    if (progress && range && !entry.parts) {
      // a range not yet arrived goes to the network at once instead of waiting
      // for the whole-file load to reach it (engine_preinit waited 42 s at 50 Mbit); the whole file still fills behind it
      if (RANGES_TO_NETWORK && !arrivedBy(progress, entry, range) && worthNetwork(progress, entry, range)) {
        post({ type: 'log', text: 'SW RANGE_NET ' + url.split('/').pop() + ' ' + range });
        return rangeNetwork(cache, key, url, range, entry, storing);
      }
      const answer = await partial(progress, entry, range, url, RANGES_TO_NETWORK ? RANGE_WAIT_STALL_MS : 0);
      if (answer === 'stalled') {
        post({ type: 'log', text: `SW RANGE_STALL ${url.split('/').pop()} ${range}: its load brought no byte for ${RANGE_WAIT_STALL_MS} ms, ended; from the network` });
        if (progress.stop) progress.stop();
        return rangeNetwork(cache, key, url, range, entry, storing);
      }
      if (answer) return answer;
    }
    const filled = await filling;
    if (filled) return slice(key, filled, range, url, event.clientId);
    // (a stopped page's read whose load a stop aborted is read as a file this worker does not store)
    return codeMismatch(key, entry) ? refuse(key, entry) : stopped() ? unstored() : toNetwork(key, range);
  })().then((response) => {
    const told = fileAnswered(url, listed, response, event.clientId, request.headers.get('Range'));
    if (told) holdFor(event, told);   // the pages are told before the worker may stop
    return response;
  }));
});
