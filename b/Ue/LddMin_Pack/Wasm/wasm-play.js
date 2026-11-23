// The cover: progress, the start-up steps, errors, the log download. A classic script: its top-level names are shared with the
// page's other scripts, which index.html loads in order (wasm-harness, wasm-compat, wasm-play, wasm-loader).
// The game starts by itself and the cover lifts when the engine says the game is ready. The loader reports each step (ueSteps),
// the bar never moves back, and the last step (the engine loading the startup level) eases towards the end until the ready
// signal. Sound waits for the first click or key; the key hint (ue-hint) stays at the top left while playing.
//
// The ready signal: the engine's page bridge (WasmPage module) dispatches 'ue-ready' and prints
// 'UE_RUN READY'. Older names count too, for one release: the events 'ue-site-ready' and 'ue-interactive', and the log lines
// 'LOADING_READY' (wasm-loader.js print). A build whose log reaches the page lifts the cover on the line
// (an event sent from the game thread can run ahead of the frame that shows the level); one that prints nothing lifts it on the
// event.

const harness = query.get('harness') === '1';
const cover = $('cover');
const hint = $('hint');
const startOnClick = pageMeta('ue-start', 'auto') === 'click' && !harness;
if (harness) cover.hidden = true;
let failed = false;
// The game's Workers: every Worker made from here on (the engine's pthreads and I/O worker, which the browser main thread
// makes, and the page's prewarm workers) and those not yet terminated, so a fatal stop can end them (stopGame). The memory
// recorder (wasm-memory.js) reads the counts
const ueWorkers = (() => {
  const live = new Set();
  const workers = { made: 0, live, stopped: false, get alive() { return live.size; } };
  const Native = window.Worker;
  if (!Native) return workers;
  window.Worker = function (url, options) {
    const worker = new Native(url, options);
    workers.made++;
    live.add(worker);
    const terminate = worker.terminate ? worker.terminate.bind(worker) : null;
    worker.terminate = () => { live.delete(worker); if (terminate) terminate(); };
    if (workers.stopped) worker.terminate();   // a thread the engine asked for before the stop
    return worker;
  };
  window.Worker.prototype = Native.prototype;
  return workers;
})();
window.ueWorkers = ueWorkers;
// The cover's state, forward only, on every load path (cached, uncached, reload, hard reload):
//   loading (page, browser check, download) -> engine (script and runtime) -> level (the startup level, warm-up)
//   -> ready (the engine's ready signal) -> [click (ue-start=click)] -> lifted;   failed and ended (the end card) from any state.
// Each change is a 'PAGE COVER <state> <ms>' line and body[data-cover], so harnesses and tests read one sequence
const coverStates = ['loading', 'engine', 'level', 'ready', 'click', 'lifted'];
let coverState = 'loading';
let engineRan = false;   // the cover got past 'loading' (failed aside): the engine started, so it wrote a log, in OPFS or in memory
function coverTo(state) {
  if (coverState === 'failed' || coverState === 'ended') return;
  const terminal = state === 'failed' || state === 'ended';
  if (!terminal && coverStates.indexOf(state) <= coverStates.indexOf(coverState)) return;   // never back
  coverState = state;
  if (state !== 'loading' && state !== 'failed') engineRan = true;
  document.body.dataset.cover = state;
  console.log('PAGE COVER ' + state + ' ' + Math.round(performance.now()));
}
let shown = 0;
let lifted = false;
let ready = false;
// The start-up download (wasm-loader.js: stage 'download' for each byte count from the data cache, 'downloaded' for the last)
// runs while the engine script loads and the engine module compiles. Until the engine is up (siteStarted) or the bytes are in,
// the bar and the line follow the download, and a later stage's report waits: its line shows then, its value is dropped (the
// level eases on from where the download left the bar; kept when no count came at all). After that a count moves the bar only. The engine's first report
// (0.76) came 2 s into a cold load, the bar kept that maximum for the whole download, and the line switched between the byte
// count and the level's seconds (UE-410987)
let download = 'none';   // 'active' while the counts hold the line, then 'over'
let counted = false;
let waiting = null;
function progress(text, fraction, stage) {
  if (lifted || ready) return;   // the game is ready; later reports (a late file) leave the cover's last line alone
  if (stage === 'download' || stage === 'downloaded') {
    if (download === 'over') { progressBar(fraction); return; }
    download = 'active';
    counted = counted || stage === 'downloaded' || fraction > 0.05;
    progressShow(text, fraction);
    if (stage === 'downloaded') downloadOver();
    return;
  }
  if (download === 'active') { waiting = { text, fraction }; return; }
  progressShow(text, fraction);
}
function progressShow(text, fraction) {
  $('progress-text').textContent = T(text);
  progressBar(fraction);
}
function progressBar(fraction) {
  if (fraction === undefined) return;
  shown = Math.max(shown, Math.min(1, fraction));
  $('bar').style.width = (shown * 100).toFixed(1) + '%';
  const pb = $('progressbar'); if (pb && pb.setAttribute) pb.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
}
function downloadOver() {
  if (download === 'active' && waiting) progressShow(waiting.text, counted ? undefined : waiting.fraction);
  download = 'over';
  waiting = null;
}
// A stop that is this browser, GPU, device or site rather than a fault of the game (stop: 'browser', 'gpu', 'device', 'site' or 'file'; the compat
// check's stops pass one): the card takes the cover's middle under a plain headline with the reason in large type, so a player
// does not read it as the game breaking. No cross-origin isolation is the site's stop (the host's setup, in any browser and on
// any device: UE-411132); a page opened from disk (file://) is the 'file' stop, whose fix is to serve it (UE-411308). A browser
// the advice line would send to Chrome (not on iOS, where every browser is WebKit, and not when the project turned the advice
// off) also gets a button that copies the page's link and a link to Chrome
const unsupportedTitles = {
  browser: "%s can't run in this browser",
  gpu: "%s can't run on this GPU",
  device: "%s can't run on this device",
  site: "%s can't run on this site",
  file: "%s can't run from a file on disk",
};
// A GPU stop with no adapter (UE-411854): the headline names the browser's hardware acceleration rather than the GPU, by what
// the compat check's WebGL probe saw (software rendering: off; no WebGL or a hidden renderer: maybe off). A WebGL that names a
// GPU, and every other GPU stop (no BC textures, low limits), keep the GPU headline
const accelerationTitles = {
  software: "%s needs the browser's hardware acceleration",
  none: "%s can't use the GPU in this browser",
  unknown: "%s can't use the GPU in this browser",
};
function showUnsupported(stop) {
  cover.classList.add('unsupported');
  const title = $('cover-title');
  const error = $('error');
  if (title && error && typeof title.after === 'function') title.after(error);
  const who = window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser() : { name: '', os: '' };
  const game = document.title && !document.title.includes('%') ? document.title : 'The game';
  // (on iOS the fix is the device or its system, never another browser)
  const kind = stop === 'browser' && who.os === 'iOS' ? 'device' : stop;
  const seen = kind === 'gpu' && window.ueCompat && window.ueCompat.noAdapter ? window.ueCompat.noAdapter() : null;
  $('error-title').textContent = T((seen && accelerationTitles[seen.rendering]) || unsupportedTitles[kind]).replace('%s', game);
  console.log('PAGE UNSUPPORTED ' + kind + ' ' + (who.name || '?') + ' ' + (who.version || '') + ' ' + (who.os || ''));
  const policy = (window.ueCompat && window.ueCompat.policy) || {};
  if (who.name === 'Chrome' || who.os === 'iOS' || policy.browserAdvice || stop === 'site' || stop === 'file') return;
  const copy = $('error-copy');
  copy.addEventListener('click', async () => {
    const link = location.href;
    try { await navigator.clipboard.writeText(link); copy.textContent = T('Copied: paste it into Chrome'); } catch (e) { copy.textContent = link; }
  });
  $('error-fix').hidden = false;
}
function fail(message, stop) {
  if (failed || recovering) return;
  // a page opened from disk is a setup stop whatever its text holds (a project named OOM puts "OOM" in the launcher name); a
  // stop the page names (this browser, GPU, device or site) keeps its card whatever the browser's text in it says (a refused
  // WebGPU adapter's "out of memory" is the GPU's, not the game's memory)
  const kind = stop === 'file' ? null : classifyLine(String(message)) || (stop ? null : abortKind(String(message)));
  if (kind) { failKind(kind, String(message)); return; }
  // (a stop's own card wins: a page opened from disk fails its fetches too)
  if (!stop && networkLost(String(message))) {
    // (the page's error event too, as for every page failure below)
    window.dispatchEvent(new CustomEvent('ue-error', { detail: { kind: 'network', message: String(message) } }));
    failKind('network', String(message));
    return;
  }
  // no cross-origin isolation (the compat check's test) is the site's to fix, on every browser and device
  if (stop === 'browser' && window.ueCompat && window.ueCompat.failed && window.ueCompat.failed() === 'cross_origin_isolated') stop = 'site';
  // on iOS the fix is the device or its system, never another browser: a browser stop there is a device stop in the
  // UE_RUN ERROR line and the report as well as on the card
  if (stop === 'browser' && window.ueCompat && window.ueCompat.browser && window.ueCompat.browser().os === 'iOS') stop = 'device';
  // a stop of the game itself (not this browser, GPU, device or site) leads with a missing or cut-short file, or the engine's
  // fatal error line for an abort (stopLead)
  const lead = unsupportedTitles[stop] ? null : stopLead('page', String(message));
  const detail = { kind: 'page', message: String(message), ...(unsupportedTitles[stop] ? { stop } : {}), ...(lead && lead.file ? { file: lead.file } : {}) };
  console.log('UE_RUN ERROR ' + JSON.stringify(detail));
  window.dispatchEvent(new CustomEvent('ue-error', { detail }));
  if (unsupportedTitles[stop]) showUnsupported(stop);
  failQuiet(lead ? lead.text + '\n\n' + message : message);
  cardLead = lead && lead.file ? lead.text : '';
  gameStopped = !unsupportedTitles[stop];
  // a page opened from disk is no crash to report
  if (stop === 'file') return;
  // wasm traps, Emscripten aborts and script errors are the commonest crash: they reach the report too
  crashReport(/\b(Aborted|abort|RuntimeError|unreachable|trap)\b/i.test(String(message)) ? 'abort' : 'page', String(message));
}
function failQuiet(message) {
  if (failed || recovering) return;
  failed = true;
  coverTo('failed');
  cover.hidden = false;
  cover.classList.remove('lifting', 'click');
  hint.hidden = true;
  ueSteps.stop();
  $('error').style.display = 'block';
  $('error-text').textContent = message;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.pointerLockElement) document.exitPointerLock();
  Promise.resolve().then(stopGame);   // after fail() or failKind() has also handed the error report its lines
}
// Nothing of a stopped game runs on behind its card: the wasm runtime aborts only the thread that failed, so the page ends the
// engine's Workers (game, render, task and I/O threads) and closes the game's audio context. The log download and the error
// report read OPFS and the page's own data, not the Workers. A stop before the start (this browser, GPU or site) finds none
function stopGame() {
  if (ueWorkers.stopped) return;
  ueWorkers.stopped = true;
  const workers = ueWorkers.alive;
  for (const worker of [...ueWorkers.live]) { try { worker.terminate(); } catch (e) { /* already gone */ } }
  const context = audioContext();
  const audio = context ? context.state : 'none';
  if (context && context.state !== 'closed') context.close().catch(() => {});
  if (workers || context) console.log('PAGE STOP workers=' + workers + ' audio=' + audio);
}
// What a player reads when the game stops, by kind. The engine raises 'ue-error' {kind, message}; the loader also
// recognises the engine's own lines (wasm-loader.js print/printErr) and Emscripten's abort text
const errorCards = {
  'device-lost': 'The graphics device stopped (the GPU driver reset or the browser took the GPU back). Reload the page to play on.',
  'out-of-memory': 'The game ran out of memory in this tab. Close other tabs or programs and reload; a computer with more memory helps.',
  'abort': 'The game stopped with an error.',
  // UE-411928: the download's connection went away (the card said only "The game could not start: TypeError: Failed to fetch").
  // The data cache keeps what arrived and loads the rest on the next load (sw.js retryBroken, RESUME)
  'network': 'The connection to the game server was lost while the game was downloading. Reload to continue the download.',
  // a game code file that differs from wasm-cache.json (wasm-loader.js onMismatch); the detail names the file and both sha1s
  'mismatch': 'The game files on this site do not match their list, so the game was not started. Reload the page; if this repeats, the site has an incomplete or mixed upload.',
};
const errorTitles = {
  'network': 'The connection was lost.',
};
// A load the network broke (the host or the connection went away), as a page's fetch reports it in Chrome, Firefox and Safari:
// the request failed, or its body stopped with a read error. Only the page's own messages (fail) are matched, not engine lines
function networkLost(message) {
  return /\bTypeError: (?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed|network error|Error in input stream)/i.test(message);
}
function failKind(kind, detail) {
  if (failed || recovering) return;
  const text = T(errorCards[kind] || errorCards.abort);
  if (errorTitles[kind]) $('error-title').textContent = T(errorTitles[kind]);
  const lead = stopLead(kind, String(detail || ''));
  console.log('UE_RUN ERROR ' + JSON.stringify({ kind, message: String(detail || ''), ...(lead && lead.file ? { file: lead.file } : {}) }));
  const body = text + (detail ? '\n\n' + detail : '');
  // a missing file comes first; the engine's fatal error line goes under the card's headline, above the engine's exit
  failQuiet(!lead ? body : lead.file ? lead.text + '\n\n' + body : text + '\n\n' + lead.text + (detail ? '\n\n' + detail : ''));
  cardLead = lead && lead.file ? lead.text : '';
  // (a GPU, memory or connection stop has its own cause: a file report that comes later does not lead its card)
  gameStopped = kind !== 'device-lost' && kind !== 'out-of-memory' && kind !== 'network';
  crashReport(kind, String(detail || ''));
}

// What the stop card leads with (UE-411936: a missing file stopped the game as "The game ended with code 1." or "native code
// called abort()", and a `debug crash` lost its "Fatal error:" line):
// - a file of the game the host is missing (HTTP 4xx or 5xx) or has cut short, which the data cache reports for any listed file
//   (sw.js fileProblem, message 'file-problem'), or the loader finds for the game's module; whatever the engine fails with
//   later, the file is the cause: the card names it and asks for it to be uploaded again;
// - else, for an abort, the engine's last "Fatal error:" line (redacted as the report's lines are);
// - else, for a compile error of a module cut short, that the game's module is incomplete on this site.
// The worker's report is listened for from this script on, before the loader binds the worker, so none is lost
const fileProblems = [];
let lastFatal = '';
let gameStopped = false;   // the card is a stop of the game (not of this browser, GPU, device or site)
let cardLead = '';   // the file line the card leads with now (a later report replaces it)
function noteFileProblem(d) {
  if (!d || typeof d.path !== 'string' || !d.path) return;
  // a page scope can hold two games: another game's file is not this load's
  const project = pageMeta('ue-project');
  // (the engine's shared files, below Engine/, are this load's too)
  if (project && !project.startsWith('%') && /^[^/]+\//.test(d.path) && !d.path.startsWith(project + '/') && !d.path.startsWith('Engine/')) return;
  if (fileProblems.some((f) => f.path === d.path)) return;
  const got = Number(d.got);
  const file = { path: d.path, status: Number(d.status) || 0, expected: Number(d.expected) || 0, got: Number.isFinite(got) ? got : -1 };
  console.log('PAGE FILE_PROBLEM ' + JSON.stringify(file));
  fileProblems.push(file);
  // the card is up already (the engine stopped before the report came): it leads with the files now, after each later report too
  if (failed && gameStopped) {
    const text = $('error-text').textContent;
    const body = cardLead && text.startsWith(cardLead + '\n\n') ? text.slice(cardLead.length + 2) : text;
    cardLead = fileProblemText();
    $('error-text').textContent = cardLead + '\n\n' + body;
  }
}
window.ueFileProblem = noteFileProblem;   // the loader's own finding (wasm-loader.js: a module read short)
if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data && event.data.type === 'file-problem') noteFileProblem(event.data); });
}
function fileProblemText() {
  const files = fileProblems;
  const f = files[0];
  // (a 416 for a range inside the list's size is a file cut short: its card reads as a short file's). The values go in through
  // functions, so a $ in a path is not read as a replacement pattern
  const why = f.status >= 400 && f.status !== 416 ? 'HTTP ' + f.status : f.got >= 0 && f.expected ? T('%s of %s bytes').replace('%s', () => f.got).replace('%s', () => f.expected) : T('incomplete');
  const more = files.slice(1, 4).map((g) => g.path);
  return T('A file of the game is missing (or incomplete) on this site: %s. Upload it again.').replace('%s', () => f.path + ' (' + why + ')')
    + (more.length ? '\n' + T('Also missing or incomplete: %s').replace('%s', () => more.join(', ') + (files.length > 4 ? ', ...' : '')) : '');
}
// a module cut short fails its compile with a section that "extends past end of the module" or a read that "fell off end"
// (V8), "unexpected end" (V8, JavaScriptCore) or "end of stream"/"not enough data" (SpiderMonkey)
const truncatedModule = (t) => /CompileError/.test(t) && /past end|fell off end|unexpected end|end of (?:the )?(?:module|stream|file)|not enough data|truncated/i.test(t);
function stopLead(kind, message) {
  // (a stop with its own cause, the GPU, memory or the connection, keeps its card: a file problem leads an engine exit or abort)
  if (fileProblems.length && kind !== 'device-lost' && kind !== 'out-of-memory' && kind !== 'network') return { text: fileProblemText(), file: fileProblems[0] };
  if (truncatedModule(message)) {
    const module = window.ueModuleFile || '';
    return { text: T("The game's module is incomplete on this site: %s. Upload it again.").replace('%s', module || T('its .wasm file')) };
  }
  const abort = kind === 'abort' || /\b(Aborted|abort|RuntimeError|unreachable|trap)\b/i.test(message);
  if (abort && lastFatal) return { text: lastFatal };
  return null;
}

// Error reports to the project's endpoint (<meta name="ue-crash-url">, setting CrashReportUrl), off by default
// (Docs/CrashReporting.md). https only (http on localhost or 127.0.0.1, a secure context, for a local receiver).
// ue-crash-consent: "ask" (the default: the error card offers "Send a report"; nothing leaves before the click) or "always".
// ue-crash-format: "json" (the default: one JSON POST of WasmCrashInfo.json's fields and the crash context) or "crc"
// (CrashReportClient's Data Router upload, a zlib-compressed CR1 container of CrashContext.runtime-xml and WasmCrashInfo.json,
// which the engine's crash pipeline accepts). One crash report per page load. ue-crash-ensures "1" (bCrashReportEnsures, with
// consent "always" only): each of the engine's first four distinct ensures is a non-fatal report too. ue-crash-log is not read:
// a report never carries the game's log, the engine lines or the context's game data.
// The crash context: the engine writes it before it aborts (a check() or fatal error, an out-of-memory; on any thread) into a
// block of its memory the page reads after the module stopped (Module.ueCrash, WasmPlatformCrashContext.cpp). A crash that never
// reaches C++ (a wasm trap, an Emscripten abort, a script error) gets the engine's session template (the same XML with the
// message and the call stack left open) filled from the JavaScript stack, or a minimal context when the engine never ran.
// What leaves is rebuilt from a list of fields (reportContext, crashJson): the report's ids and type, the build, the error's
// location, the call stacks, the memory figures, the web graphics tier and the browser's name; every other field of the
// context (the ids the engine keeps for this browser and the account, the user name, the command line, folders, the activity
// hint, engine and game data, the CPU and the GPU's name) and every free text (an error's message, a script's text) is left out
const engineLines = [];
// The engine lines (for wasm-debug.js) and the page's lines in the log download: the command line, queries, key=value secrets
// and long token-like runs masked (a CrashGUID, which names a report on the receiving side, is kept)
function redactLine(t) {
  const s = String(t);
  if (/Command ?Line\s*:|UE_RUN CONFIG|staged_cmdline/i.test(s)) return '[command line removed]';
  return s
    // a query (a '?' run with an '=' in it): each '?' run is read once, so a long run without '=' takes linear time
    .replace(/\?[^\s"'<>]*/g, (m) => (m.indexOf('=') > 0 ? '?[query removed]' : m))
    .replace(/(-?\b(?:auth\w*|token|password|passwd|secret|key|code|ticket|session\w*|epicapp\w*|exchangecode)\s*[=:]\s*)("[^"]*"|\S+)/gi, '$1[removed]')
    .replace(/[A-Za-z0-9+/_\-]{32,}={0,2}/g, (r) => (/^UECC-\w+-[0-9A-F]{32}_\d+$/.test(r) ? r : '[token removed]'));
}
function rememberLine(t) {
  const line = redactLine(t);
  engineLines.push(line.slice(0, 300));
  if (engineLines.length > 60) engineLines.shift();
  // the engine's fatal error, for the stop card (stopLead): "Fatal error: [File:...] [Line: n]" and its message, on that line or
  // the next one of the same print, without the call stack that can follow ("at ..." lines) or a repeated "Fatal error:". Only
  // where the engine prints it: at the start of the print or after a log line's prefix ("[time][frame]LogX: "), so a line that
  // quotes "Fatal error:" (a browser's or a script's text) is not taken. The engine's one-line harness marker after it
  // (WasmPlatformOutputDevices.cpp: "HARNESS ABORT <message>", the stack joined in) is not taken. The prefix is matched before
  // the redaction (which would mask a long category name as a token), the rest is redacted as the report's lines are
  const raw = String(t);
  const at = /^HARNESS /.test(raw) ? null : /^(?:\[[^\]\n]*\])*(?:Log\w+: )?(?=Fatal error:)/.exec(raw);
  const rest = at ? redactLine(raw.slice(at[0].length)) : '';
  if (rest.startsWith('Fatal error:')) {
    lastFatal = rest.replace(/^(?:Fatal error:\s*)+/, 'Fatal error: ').split('\n').map((l) => l.trim())
      .filter((l) => l && !/^at\s/.test(l)).slice(0, 2).join(' ').slice(0, 400);
  }
}
function crashUrl() {
  const url = pageMeta('ue-crash-url');
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(url) ? url : '';
}
// What the page saw of a crash before it assembles the report (wasm-loader.js crashNote calls): the JavaScript stacks of traps
// and aborts (a pthread's comes as printErr 'UE_CRASH_STACK <json>' from Build/Link/wasm_crash.js, or as Emscripten's own stack
// line with ASSERTIONS), the abort's text, and when the first sign came
const crashSeen = { stacks: [], abort: '', first: 0, thread: '' };
// Whether a pthread's 'UE_CRASH_STACK <json>' line (Build/Link/wasm_crash.js) is a wasm trap or an abort (a
// WebAssembly.RuntimeError, which Emscripten's abort throws too), which leave the module's state undefined, rather than a
// JavaScript exception in a callback; a glue without the trap field: by its message
function crashStackFatal(line) {
  let d = null;
  try { d = JSON.parse(String(line).slice(15)); } catch (e) { return false; }
  return d && typeof d.trap === 'boolean' ? d.trap : /^(?:Uncaught )?RuntimeError\b|Aborted\(/.test(String((d && d.message) || ''));
}
function crashNote(source, text) {
  const t = String(text || '');
  // (a pthread's JavaScript exception that is no trap or abort is not a crash: its stack would stand for a later one's)
  if (t.startsWith('UE_CRASH_STACK ') && !crashStackFatal(t)) return;
  if (!crashSeen.first && (source !== 'err' || /UE_CRASH_|RuntimeError|Aborted\(|sent an error!|uncaught exception/.test(t))) crashSeen.first = performance.now();
  if (source === 'abort') { crashSeen.abort = crashSeen.abort || t; return; }
  let stack = '';
  if (t.startsWith('UE_CRASH_STACK ')) { try { const d = JSON.parse(t.slice(15)); stack = String(d.stack || d.message || ''); } catch (e) { stack = ''; } }
  else if (source === 'start' && /\n\s*at |@/.test(t)) stack = t;   // a start-up error (wasm-loader.js), wasm frames or not
  else if ((source === 'error' || (source === 'err' && /RuntimeError|Aborted\(|uncaught|sent an error!/i.test(t))) && /\n\s*at |@/.test(t) && /wasm-function\[|\.wasm/.test(t)) stack = t;
  if (stack && crashSeen.stacks.length < 8 && !crashSeen.stacks.includes(stack)) crashSeen.stacks.push(stack.slice(0, 32768));
  // where the first stack came from: a pthread Worker (its UE_CRASH_STACK line, or Emscripten's printErr of it) or this thread
  if (stack && !crashSeen.thread) crashSeen.thread = source === 'error' || source === 'start' ? 'main' : 'pthread';
}
// The engine's crash block (WasmPlatformCrashContext.cpp): { state, context, session } as text, or null when the engine never
// registered it (it stopped before PlatformPreInit, or a page script stopped the start)
function readCrashBlock() {
  const block = window.Module && Module.ueCrash;
  if (!block || typeof block.words !== 'function') return null;
  try {
    const w = block.words();
    if (w[0] !== 0x43574555) return null;
    const text = (offset, length) => new TextDecoder().decode(block.bytes(offset, Math.min(length, 1 << 20)));
    const load = (i) => (typeof SharedArrayBuffer !== 'undefined' && w.buffer instanceof SharedArrayBuffer ? Atomics.load(w, i) : w[i]);
    const state = load(2), seq = load(4);
    const session = seq > 0 && seq % 2 === 0 ? text(block.session, w[5]) : '';
    return { state, flags: w[7], context: state === 2 ? text(block.context, w[3]) : '', session: load(4) === seq ? session : '' };
  } catch (e) { console.log('PAGE CRASH_REPORT crash block unreadable: ' + e); return null; }
}
// Waits for what the report needs: the engine's context (its fatal path writes it before the abort that ends the module) or, for
// a crash that never reaches C++, a JavaScript stack; at most 2 s after the first sign of the crash
async function crashSettle() {
  const start = crashSeen.first || performance.now();
  for (;;) {
    const block = readCrashBlock();
    const now = performance.now();
    if (block && block.state === 2) return block;
    if (now - start > 2000 || (!block && now - start > 300) || (crashSeen.stacks.length && (!block || block.state === 0) && now - start > 300)) return block;
    await new Promise((r) => setTimeout(r, 50));
  }
}
// (the characters XML 1.0 does not allow, such as a control character in a script error's message, are dropped)
const xmlEscape = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const xmlUnescape = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tagRe = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const xmlField = (xml, tag) => { const m = new RegExp('<' + tagRe(tag) + '>([^]*?)</' + tagRe(tag) + '>').exec(xml); return m ? xmlUnescape(m[1]) : ''; };
const xmlSet = (xml, tag, escaped) => xml.replace(new RegExp('<' + tagRe(tag) + '>[^]*?</' + tagRe(tag) + '>'), () => '<' + tag + '>' + escaped + '</' + tag + '>');
// The game's module file, as the stage lists it (window.ueStageFiles); its symbol map is <game script>.symbols
function crashBinaries() {
  const all = window.ueStageFiles || [];
  const files = all.slice(0, 20);
  const wasm = all.find((f) => /\.wasm$/.test(f.url));
  const game = pageMeta('ue-game') || pageMeta('ue-project');
  const base = (f) => f.url.split('/').pop();
  const script = all.find((f) => game && (base(f) === game + '.js' || (base(f).startsWith(game + '-Wasm-') && base(f).endsWith('.js')))) || all.find((f) => /\.js$/.test(f.url) && !/worklet|worker/i.test(base(f)));
  return { files, module: wasm ? wasm.url.split('/').pop() : '', symbols: script ? script.url.split('/').pop() + '.symbols' : '' };
}
// A JavaScript stack's wasm frames as the engine's portable call stack (module, base 0, the byte offset in the module) and their
// hash (FGenericCrashContext::AddPortableCallStackHash: SHA-1 over each offset as a little-endian uint64, upper-case hex)
async function portableStack(stack, module) {
  const offsets = [...String(stack).matchAll(/wasm-function\[\d+\]:0x([0-9a-f]+)/gi)].map((m) => BigInt('0x' + m[1]));
  const name = xmlEscape(module || 'game.wasm');
  const lines = offsets.map((o) => (name + ' ').padEnd(name.length + 1) + ' 0x0000000000000000 + ' + o.toString(16).padEnd(16));
  let hash = '';
  if (offsets.length && window.crypto && crypto.subtle) {
    const bytes = new Uint8Array(offsets.length * 8);
    const view = new DataView(bytes.buffer);
    offsets.forEach((o, i) => view.setBigUint64(i * 8, o, true));
    try { hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase(); } catch (e) { hash = ''; }
  }
  return { section: offsets.length ? '<PCallStack>\n' + lines.join('\n') + '\n</PCallStack>' : '<PCallStack></PCallStack>', hash };
}
// The JavaScript stack as <CallStack> lines: the frames, without the page's query strings (all of a query, up to the frame's
// :line:column or :wasm-function[N] or its end)
// (every frame is kept, repeated ones too: a recursion's depth is part of the stack; a query ends at the frame's line and
// column, or at the frame's end, so a ")" inside it does not end it; JavaScriptCore's unnamed function, "<?>", is no query)
const stackLines = (stack) => String(stack).split('\n').map((l) => l.trim()).filter((l) => l && l !== 'Error')
  .map((l) => l.replace(/\?(?!>)[^\s]*?(?=(?::\d+){1,2}\)?(?:\s|$)|:wasm-function\[|\)?(?:\s|$))/g, '')).join('\n');
// A URL's file name (no folders, query or fragment): a stack frame's and a staged file's, as a report names them
const urlFile = (u) => String(u).replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
// A call stack as a report sends it: only its frames, each as "at <function> (<file>:<location>)" (V8) or
// "<function>@<file>:<location>" (SpiderMonkey, JavaScriptCore), the URL reduced to its file name; a function name is kept only
// when it is an identifier path (Module._main, $func12, Object.<anonymous>, Foo::Bar), else it reads <function>. Every other
// line (an exception's message, a script's text) is left out. The engine's PCallStack, not this, is what the crash pipeline
// symbolicates
const frameName = (n) => (n && /^(?:async |new )?[\w$.<>[\]:~-]{1,200}$/.test(n) ? n : '');
const frameLocation = '(\\S+?)(:\\d+(?::\\d+)?|:wasm-function\\[\\d+\\]:0x[0-9a-f]+)';
const v8Frame = new RegExp('^at (?:(.+?) \\()?(?:' + frameLocation + '|(<anonymous>|native))(\\)?)$', 'i');
const otherFrame = new RegExp('^(.*?)@(?:' + frameLocation + '|(\\[(?:wasm|native) code\\]))$', 'i');
function reportStack(stack) {
  const out = [];
  for (const l of stackLines(stack).split('\n')) {
    let m = v8Frame.exec(l);
    // (a named frame closes its parenthesis, an unnamed one has none)
    if (m && (m[1] === undefined) === (m[5] === '')) {
      const at = m[4] || urlFile(m[2]) + m[3];
      out.push(m[1] === undefined ? 'at ' + at : 'at ' + (frameName(m[1]) || '<function>') + ' (' + at + ')');
    } else if ((m = otherFrame.exec(l))) {
      out.push(frameName(m[1]) + '@' + (m[4] || urlFile(m[2]) + m[3]));
    }
  }
  return out.slice(0, 200).join('\n');
}
// The engine's error message, reduced to where it happened: "Fatal error: [File:...] [Line: n]", "Assertion failed: [File:...]
// [Line: n]" or "Ensure condition failed: [File:...] [Line: n]" (the engine's own line, FDebug, without the checked expression:
// the file and line name it in the build's source), or a WebAssembly trap's kind, one of the browser engines' own trap texts
// (trapKinds: "RuntimeError: memory access out of bounds"). Everything else (the expression, the message a fatal log line or a
// checkf formats, which can hold anything the game printed, a script's own RuntimeError text, the browser's other text) is
// left out
const trapKinds = new Set(['unreachable', 'unreachable executed', 'unreachable code should not be executed', 'memory access out of bounds',
  'out of bounds memory access', 'index out of bounds', 'divide by zero', 'integer divide by zero', 'division by zero', 'remainder by zero',
  'integer overflow', 'invalid conversion to integer', 'float unrepresentable in integer range', 'out of bounds trunc operation',
  'null function or function signature mismatch', 'indirect call to null', 'indirect call signature mismatch', 'table index is out of bounds',
  'out of bounds call_indirect', 'call_indirect to a null table entry', 'call_indirect to a signature that does not match',
  'operation does not support unaligned accesses', 'data segment out of bounds', 'array element access out of bounds',
  'dereferencing a null pointer', 'illegal cast']);
function reportError(text) {
  const first = String(text).split('\n')[0].trim();
  const m = /^(Fatal error:|Assertion failed:|Ensure condition failed:)(?: .*?)? ?(\[File:[\w .\/\\:+()-]{1,300}\] \[Line: \d+\])(?:\s|$)/.exec(first);
  if (m) return m[1] + ' ' + m[2];
  const trap = /^(?:Uncaught )?RuntimeError: (.{1,80})$/.exec(first);
  return trap && trapKinds.has(trap[1].toLowerCase()) ? first : '';
}
// The crash context's fields a report sends, by section, each with the form its value must have (a RegExp) or the reduction it
// goes through (a function); a field that is not listed, or whose value does not have its form, is left out. MemoryStats.*: every
// memory figure the engine writes (numbers). version: a build label (EngineVersion, BuildVersion, Symbols: the build's branch,
// changelist and SymbolsVersion), one run of printable characters without a space, a quote, "<", ">", "=" or "?"
const num = /^-?\d{1,20}(?:\.\d{1,6})?$/, flag = /^(?:true|false|0|1)$/i, word = /^[\w .+*:()/-]{0,128}$/, version = /^[^\s"'<>=?&]{0,256}$/;
const reportFields = {
  RuntimeProperties: { CrashVersion: num, ExecutionGuid: /^[0-9A-F]{32}$/i, CrashGUID: /^UECC-\w+-[0-9A-F]{32}_\d+$/, IsEnsure: flag, IsStall: flag,
    IsAssert: flag, CrashType: word, ErrorMessage: reportError, CrashReporterMessage: /^(?:Attended|Unattended)?$/, SecondsSinceStart: num,
    IsInternalBuild: flag, IsPerforceBuild: flag, IsWithDebugInfo: flag, IsSourceDistribution: flag, IsUERelease: flag, IsRequestingExit: flag,
    GameName: word, ExecutableName: word, BuildConfiguration: word, PlatformName: word, PlatformFullName: word, PlatformNameIni: word,
    EngineMode: word, EngineModeEx: word, EngineVersion: version, EngineCompatibleVersion: version, BuildVersion: version, Symbols: version,
    CrashDumpMode: num, NumMinidumpFramesToIgnore: num, 'MemoryStats.*': num, CallStack: reportStack,
    PCallStack: (v) => '\n' + v.split('\n').filter((l) => /^\s*[\w.+-]{1,128}\s+0x[0-9a-f]{16} \+ [0-9a-f]{1,16}\s*$/i.test(l)).join('\n') + '\n',
    PCallStackHash: /^(?:[0-9A-F]{40})?$/i },
  PlatformProperties: { 'Wasm.Module': word, 'Wasm.Symbols': word, 'Wasm.ContextSource': word, 'Wasm.PageKind': word, 'Wasm.JsThread': word,
    'Wasm.Browser': word, 'Wasm.Pointer64': num, 'Wasm.IsGameThread': num, 'Wasm.IsOutOfMemory': num, 'Wasm.HeapBytes': num, 'Wasm.HeapMaxBytes': num },
  EngineData: { 'RHI.RHIName': word, 'RHI.FeatureLevel': word },
};
// The crash context as it leaves the page: a new FGenericCrashContext of the listed fields (reportFields), in the engine's order
function reportContext(xml) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<FGenericCrashContext>'];
  for (const [section, fields] of Object.entries(reportFields)) {
    out.push('<' + section + '>');
    const body = (new RegExp('<' + section + '>([^]*?)</' + section + '>').exec(xml) || ['', ''])[1];
    for (const m of body.matchAll(/<([\w.]+)>([^<]*)<\/\1>/g)) {
      const rule = Object.hasOwn(fields, m[1]) ? fields[m[1]] : m[1].startsWith('MemoryStats.') ? fields['MemoryStats.*'] : null;
      const value = xmlUnescape(m[2]);
      const kept = !rule ? null : typeof rule === 'function' ? rule(value) : rule.test(value) ? value : null;
      if (kept !== null) out.push('<' + m[1] + '>' + xmlEscape(kept) + '</' + m[1] + '>');
    }
    out.push('</' + section + '>');
  }
  out.push('<GameData>', '</GameData>', '</FGenericCrashContext>', '');
  return out.join('\n');
}
// A context before it leaves: the frames the engine names by UBT's module name take the staged file's name, then reportContext
function cleanContext(xml) {
  // The engine names a frame without a file name in its URL by the module name UBT would give (Wasm.Module); the staged file
  // the page loaded is the name the .psym has, so those frames take it (a fatal context and an ensure's alike)
  const bin = crashBinaries();
  const named = xmlField(xml, 'Wasm.Module');
  if (bin.module && named && named !== bin.module) {
    xml = xml.replace(/<PCallStack>[^]*?<\/PCallStack>/, (s) => s.split('\n').map((l) => (l.startsWith(named + ' ') ? bin.module + l.slice(named.length) : l)).join('\n'));
    xml = xmlSet(xml, 'Wasm.Module', xmlEscape(bin.module));
  }
  return reportContext(xml);
}
// The crash type of a context the page completes, by the page's kind (the engine's own context has its type: OutOfMemory
// after FPlatformMemory::OnOutOfMemory, GPUCrash after the RHI's lost device, WasmPlatformCrashContext.cpp)
const pageCrashTypes = { 'out-of-memory': 'OutOfMemory', 'device-lost': 'GPUCrash' };
// The crash context to send: the engine's (masked), else its session template or a minimal context completed from what the
// page saw. kind: the page's kind (abort, out-of-memory, device-lost, page)
async function crashContext(block, kind, message) {
  const bin = crashBinaries();
  let xml = block && block.context ? block.context : '';
  const source = xml ? 'engine' : block && block.session ? 'session' : 'page';
  const stack = crashSeen.stacks[0] || '';
  const jsMessage = crashSeen.abort ? 'Aborted(' + crashSeen.abort + ')' : message;
  if (!xml) {
    const guid = 'UECC-Wasm-' + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase() + '_0000';
    xml = block && block.session ? block.session : '<?xml version="1.0" encoding="UTF-8"?>\n<FGenericCrashContext>\n<RuntimeProperties>\n'
      + '<CrashVersion>3</CrashVersion>\n<CrashGUID>' + guid + '</CrashGUID>\n<IsEnsure>false</IsEnsure>\n<IsAssert>false</IsAssert>\n'
      + '<CrashType>' + (pageCrashTypes[kind] || 'Crash') + '</CrashType>\n<ErrorMessage>@@UE_WASM_ERROR_MESSAGE@@</ErrorMessage>\n'
      + '<GameName>UE-' + xmlEscape(pageMeta('ue-project')) + '</GameName>\n<ExecutableName>' + xmlEscape(pageMeta('ue-game') || pageMeta('ue-project')) + '</ExecutableName>\n'
      + '<MemoryStats.bIsOOM>0</MemoryStats.bIsOOM>\n<PlatformName>Wasm</PlatformName>\n<PlatformNameIni>Wasm</PlatformNameIni>\n<CommandLine></CommandLine>\n'
      + '<CallStack>@@UE_WASM_CALLSTACK@@</CallStack>\n<PCallStack></PCallStack>\n<PCallStackHash></PCallStackHash>\n</RuntimeProperties>\n'
      + '<PlatformProperties>\n</PlatformProperties>\n</FGenericCrashContext>\n';
    // (the session template says Crash: a stop the page classified is an out-of-memory or a lost GPU device)
    if (pageCrashTypes[kind]) xml = xmlSet(xmlSet(xml, 'CrashType', pageCrashTypes[kind]), 'IsAssert', 'false');
    if (kind === 'out-of-memory') xml = xmlSet(xml, 'MemoryStats.bIsOOM', '1');
    const portable = await portableStack(stack, bin.module);
    xml = xml.replace('@@UE_WASM_ERROR_MESSAGE@@', () => xmlEscape(jsMessage)).replace('@@UE_WASM_CALLSTACK@@', () => xmlEscape(stack))
      .replace(/<PCallStack>[^]*?<\/PCallStack>/, () => portable.section);
    xml = xmlSet(xml, 'PCallStackHash', portable.hash);
    // the session template was serialized when the engine started; the crash is when the page first saw it (crashSeen.first),
    // not when the report is built
    const started = window.Module && Module.ueCrash && Number(Module.ueCrash.started) || 0;
    xml = xmlSet(xml, 'SecondsSinceStart', String(Math.max(0, Math.round(((crashSeen.first || performance.now()) - started) / 1000))));
  }
  // what the page knows: its kind, the thread of a trap's JavaScript stack
  return cleanContext(pageFields(xml, [['Wasm.ContextSource', source], ['Wasm.PageKind', kind], ...(source === 'engine' ? [] : [['Wasm.JsThread', crashSeen.thread || 'unknown']])]));
}
// The page's own platform fields added to a context (a stop's and an ensure's): the given ones, the browser's name, major version
// and OS (what the upload's own User-Agent header says), the module and its symbol map; each replaces any the context had
// (Wasm.Module stays the engine's too: cleanContext renames it)
function pageFields(xml, fields) {
  const bin = crashBinaries();
  const browser = window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser() : {};
  const all = [...fields, ['Wasm.Browser', [browser.name, browser.version ? String(browser.version).split('.')[0] : '', browser.os].filter(Boolean).join(' ')],
    ['Wasm.Module', bin.module], ['Wasm.Symbols', bin.symbols]];
  for (const [k] of all) if (k !== 'Wasm.Module') xml = xml.replace(new RegExp('<' + tagRe(k) + '>[^<]*</' + tagRe(k) + '>\\n?', 'g'), '');
  const extra = all.map(([k, v]) => '<' + k + '>' + xmlEscape(v) + '</' + k + '>\n').join('');
  return xml.includes('</PlatformProperties>') ? xml.replace('</PlatformProperties>', () => extra + '</PlatformProperties>') : xml;
}
// CrashReportClient's upload (Engine/Source/Runtime/CrashReportCore/Private/CrashUpload.cpp FCrashUploadToDataRouter): the header
// ('CR1', the report folder and <folder>.uecrash as 260-character ANSI arrays, the uncompressed size, the file count), then
// each file (its index, its name as a 260-character array, its bytes as a sized array), all little-endian, the whole
// zlib-compressed (CompressionStream 'deflate' is zlib; without it, stored deflate blocks, still valid zlib)
function crashContainer(folder, files) {
  const ansi = (s, min) => { const b = new Uint8Array(Math.max(s.length, min)); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) < 128 ? s.charCodeAt(i) : 63; return b; };
  const parts = [];
  const int = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); parts.push(b); };
  const arr = (s, min) => { const b = ansi(s, min); int(b.length); parts.push(b); };
  parts.push(new Uint8Array([67, 82, 49]));   // 'CR1'
  arr(folder, 260); arr(folder + '.uecrash', 260);
  const sizeAt = parts.length; int(0); int(files.length);
  files.forEach((f, i) => { int(i); arr(f.name, 260); int(f.data.length); parts.push(f.data); });
  const total = parts.reduce((n, p) => n + p.length, 0);
  new DataView(parts[sizeAt].buffer).setInt32(0, total, true);
  const out = new Uint8Array(total);
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function zlib(bytes) {
  if (typeof CompressionStream === 'function') {
    try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); } catch (e) { /* stored blocks below */ }
  }
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let at = 2, a = 1, b = 0;
  for (let i = 0; i < blocks; i++) {
    const chunk = bytes.subarray(i * 65535, (i + 1) * 65535);
    out[at++] = i === blocks - 1 ? 1 : 0;
    out[at++] = chunk.length & 255; out[at++] = chunk.length >> 8; out[at++] = ~chunk.length & 255; out[at++] = (~chunk.length >> 8) & 255;
    out.set(chunk, at); at += chunk.length;
  }
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  new DataView(out.buffer).setUint32(at, ((b << 16) | a) >>> 0, false);
  return out;
}
// The JSON report (ue-crash-format json, and WasmCrashInfo.json in the container), from the context as it leaves (cleanContext):
// its kind, the context's type, GUID, reduced error message and call stack, and the staged binaries' file names and sha1s (the
// build's public file hashes)
function crashJson(kind, xml) {
  const bin = crashBinaries();
  return { version: 3, project: pageMeta('ue-project'), kind, crash_type: xmlField(xml, 'CrashType'), crash_guid: xmlField(xml, 'CrashGUID'),
    error_message: xmlField(xml, 'ErrorMessage'), callstack: xmlField(xml, 'CallStack'), context_source: xmlField(xml, 'Wasm.ContextSource') || (kind === 'ensure' ? 'engine' : 'page'),
    files: bin.files.map((f) => ({ url: urlFile(f.url), ...(/^[0-9a-f]{1,128}$/i.test(f.sha1 || '') ? { sha1: f.sha1 } : {}) })), symbols: bin.symbols };
}
// What an upload's log line says, so the receiver can find the report: its CrashGUID, the endpoint (origin and path; never
// its query) and the response's own request id. A cross-origin response shows the page a header only when it lists it in
// Access-Control-Expose-Headers (Data Router answers X-Epic-Correlation-ID without exposing it), else "none". Each value as a
// plain token, so no response or context text reaches the log as it is
const logToken = (s) => String(s || '').replace(/[^\w.:\-]/g, '').slice(0, 100) || 'none';
const crashGuid = (xml) => logToken(xmlField(xml, 'CrashGUID'));
const crashEndpoint = (target) => { try { const u = new URL(target); return u.origin + u.pathname; } catch (e) { return 'none'; } };
function crashRequestId(response) {
  const headers = response && response.headers;
  if (!headers || typeof headers.get !== 'function') return 'none';
  for (const name of ['X-Epic-Correlation-ID', 'X-Request-ID']) { const v = headers.get(name); if (v) return logToken(v); }
  return 'none';
}
// One report in the chosen format, ready to upload: { format, kind, guid, target, type, body }; kind 'ensure' is the engine's
// non-fatal report (its own context); xml: the context as it leaves (cleanContext)
async function crashBuild(url, kind, xml) {
  const format = pageMeta('ue-crash-format', 'json') === 'crc' ? 'crc' : 'json';
  const report = crashJson(kind, xml);
  let body, type, target = url;
  if (format === 'json') {
    body = new TextEncoder().encode(JSON.stringify({ ...report, context: xml }));   // bytes: the keepalive limit counts them
    type = 'application/json';
  } else {
    const encode = (s) => new TextEncoder().encode(s);
    const folder = xmlField(xml, 'CrashGUID') || 'UECC-Wasm-unknown_0000';
    const files = [{ name: 'CrashContext.runtime-xml', data: encode(xml) }, { name: 'WasmCrashInfo.json', data: encode(JSON.stringify(report, null, 1)) }];
    body = await zlib(crashContainer(folder, files));
    type = 'application/octet-stream';
    // FCrashUploadToDataRouter's query: AppID, AppVersion (the engine version), AppEnvironment (Dev for an internal build),
    // UploadType, UserID (LoginId|EpicAccountId|OperatingSystemId, each empty: a report carries no id of the player or browser)
    const params = new URLSearchParams({ AppID: 'CrashReporter', AppVersion: xmlField(xml, 'EngineVersion'),
      AppEnvironment: /^(true|1)$/i.test(xmlField(xml, 'IsInternalBuild')) ? 'Dev' : 'Release', UploadType: 'crashreports', UserID: '||' });
    const u = new URL(url);
    u.hash = '';
    params.forEach((v, k) => u.searchParams.set(k, v));
    target = u.toString();
  }
  return { format, kind, guid: crashGuid(xml), target, type, body };
}
// One upload of a built report (crashBuild); a retry sends the same bytes
async function crashPost(r) {
  // keepalive (the upload outlives a reload) only under the browser's 64 KB keepalive limit
  const response = await fetch(r.target, { method: 'POST', mode: 'cors', keepalive: r.kind !== 'ensure' && r.body.length < 60000, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': r.type }, body: r.body });
  console.log('PAGE CRASH_REPORT sent ' + r.format + ' ' + r.kind + ' ' + r.body.length + ' bytes, status ' + (response && response.status)
    + ', CrashGUID ' + r.guid + ', endpoint ' + crashEndpoint(r.target) + ', request id ' + crashRequestId(response));
  // (an endpoint that refuses the report is a failed upload: the button offers it again)
  if (!response || response.status < 200 || response.status >= 300) throw new Error('the endpoint answered HTTP ' + (response && response.status));
}
let crashSent = false;
let crashPending = null;   // the stop's report as it is built: a promise of crashBuild's result, or of null when none is sent
// Out-of-memory stops are reported only when the project asks for them (ue-crash-oom 1, setting bCrashReportOutOfMemory): on
// phones and tablets the browser's memory limit, not a bug, ends most of them
const reportsOutOfMemory = () => pageMeta('ue-crash-oom', '0') === '1';
// The stop's report is settled and built at the stop under either consent, from what the page has then (its crash block, the
// JavaScript stacks), so a later error (a render-fence timeout after a main-thread stop, say) cannot supply its context; under
// consent "ask" the click only uploads it, and nothing leaves before the click
function crashReport(kind, message) {
  const url = crashUrl();
  if (!url || crashPending) return;
  if (kind === 'out-of-memory' && !reportsOutOfMemory()) { console.log('PAGE CRASH_REPORT not sent: out of memory (ue-crash-oom 0)'); return; }
  crashSeen.first = crashSeen.first || performance.now();
  let guid = 'none';   // (for the failure line: none until the context is assembled)
  crashPending = (async () => {
    const block = await crashSettle();
    const args = (window.Module && Array.isArray(Module.arguments) ? Module.arguments : []).map(String);
    if ((block && block.flags & 1) || args.some((a) => /^-nocrashreports$/i.test(a))) { console.log('PAGE CRASH_REPORT not sent: -nocrashreports'); return null; }
    const xml = await crashContext(block, kind, message);
    guid = crashGuid(xml);
    // (the engine's context can say out-of-memory where the page saw only the abort that followed it)
    if (xmlField(xml, 'CrashType') === 'OutOfMemory' && !reportsOutOfMemory()) { console.log('PAGE CRASH_REPORT not sent: out of memory (ue-crash-oom 0)'); return null; }
    console.log('PAGE CRASH_CONTEXT ' + JSON.stringify({ source: xmlField(xml, 'Wasm.ContextSource') === 'engine' ? 'engine' : block && block.session ? 'session' : 'page',
      type: xmlField(xml, 'CrashType'), guid: xmlField(xml, 'CrashGUID'), frames: (xml.match(/^.* 0x0{16} \+ /gm) || []).length }));
    return crashBuild(url, kind, xml);
  })().catch((e) => { console.log('PAGE CRASH_REPORT failed, CrashGUID ' + guid + ': ' + e); return null; });
  const b = $('report');
  // (a report that will not be sent is not offered: the button and its note are withdrawn)
  crashPending.then((r) => {
    if (r) return;
    if (b) b.hidden = true;
    const note = $('report-note');
    if (note) note.hidden = true;
  });
  const send = async () => {
    if (crashSent) return;
    crashSent = true;
    if (b) { b.disabled = true; b.textContent = T('Send a report'); }
    const report = await crashPending;
    if (!report) { if (b) b.textContent = 'Report not sent'; return; }
    try {
      await crashPost(report);
      if (b) b.textContent = 'Report sent';
    } catch (e) {
      console.log('PAGE CRASH_REPORT failed, CrashGUID ' + report.guid + ': ' + e);
      // a failed upload can be sent again from the card (with consent always too)
      crashSent = false;
      if (b) { b.disabled = false; b.hidden = false; b.onclick = send; }
    }
  };
  if (pageMeta('ue-crash-consent', 'ask') === 'always') { send(); return; }
  if (b) { b.hidden = false; b.onclick = send; reportNote(url); }
}
// One line under the error card's buttons (consent "ask" only): what the report holds (reportContext, crashJson) and the
// endpoint's host, so the player sees what the click sends before it
function reportNote(url) {
  const card = $('error');
  if (!card || $('report-note')) return;
  let host = '';
  try { host = new URL(url).host; } catch (e) { return; }
  const note = document.createElement('p');
  note.id = 'report-note';
  Object.assign(note.style, { margin: '8px 0 0', fontSize: '12px', color: 'var(--muted)' });
  // (through the page strings, T, as the card's other texts; {host} is the endpoint's)
  note.textContent = T("Sends this to {host}: where the error happened and its call stack, the game's name and version, your browser's name and version, the web graphics tier, memory figures, the game files' checksums and random IDs for this report.").replace('{host}', () => host);
  card.appendChild(note);
  // (the button's description too, so a screen reader reads it with the button)
  const button = $('report');
  if (button) button.setAttribute('aria-describedby', 'report-note');
}
// The engine's ensures ('ue-ensure' {context}, WasmPlatformCrashContext.cpp): non-fatal reports, only with ue-crash-ensures 1
// and consent always (the game goes on, so nobody is asked); the engine sends its first four distinct ones
window.addEventListener('ue-ensure', (event) => {
  const url = crashUrl();
  const d = event.detail || {};
  if (!url || pageMeta('ue-crash-ensures', '0') !== '1' || pageMeta('ue-crash-consent', 'ask') !== 'always' || typeof d.context !== 'string') return;
  const xml = cleanContext(pageFields(d.context, [['Wasm.ContextSource', 'engine'], ['Wasm.PageKind', 'ensure']]));
  crashBuild(url, 'ensure', xml).then(crashPost)
    .catch((e) => console.log('PAGE CRASH_REPORT ensure failed, CrashGUID ' + crashGuid(xml) + ': ' + e));
});
// The end card. The engine says it is ending ('ue-exit' {code}, WasmPage at engine exit: QuitGame, the console's
// exit, -UERunExitAfterReady); the page shows the card over the last frame: "Play again" reloads, and a project link
// (<meta name="ue-end-link" content="https://..."> with ue-end-link-text) is offered as a plain link the player clicks (a page
// cannot open a tab without a click). Code 0 is a normal end; any other code is an error card. When the engine says why it
// exited ({message}: the message box it exited on, which the browser cannot show; {question}: the box asked something, e.g.
// "load the default map instead?" for a map that is not packaged, and got no answer), the card shows that text instead of
// "The game has ended."
function gameEnded(code, doneLogged, message, question) {
  if (failed || coverState === 'ended') return;
  message = String(message || '').trim().slice(0, 1000);
  if (code) { failKind('abort', 'The game ended with code ' + code + '.' + (message ? '\n\n' + message : '')); return; }
  coverTo('ended');
  if (message) console.log('PAGE END_MESSAGE ' + JSON.stringify({ message, question: !!question }));
  if (!doneLogged) console.log('UE_RUN DONE 0');   // the engine printed it already under -UERunExitAfterReady
  // A project's own template may lack the elements (Build/Wasm/Template): the card then keeps its own text
  const title = $('ended-title'), sub = $('ended-sub'), why = $('ended-why');
  if (message && sub) {
    if (title) title.textContent = T('The game stopped.');
    sub.textContent = message;
    if (question && why) { why.textContent = T('The game asked a question that cannot be answered in the browser, so it ended.'); why.hidden = false; }
  }
  if (harness) return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  hint.hidden = true;
  const card = $('ended');
  const link = pageMeta('ue-end-link');
  const a = $('ended-link');
  if (link && /^https:\/\//.test(link)) { a.href = link; a.textContent = pageMeta('ue-end-link-text') || link; a.hidden = false; }
  card.hidden = false;
  cover.hidden = false;
  cover.classList.remove('lifting', 'click');
  $('art').hidden = true;
  $('steps').hidden = true;
}
window.addEventListener('ue-exit', (event) => {
  const d = event.detail || {};
  gameEnded(Number(d.code) || 0, !!d.done, typeof d.message === 'string' ? d.message : '', !!d.question);
});

// The engine opened a link (FPlatformProcess::LaunchURL) and the browser blocked the new tab: the page offers the
// link for the player to click (a click is a gesture, so that tab opens). Only http(s) links
window.addEventListener('ue-open-url', (event) => {
  const d = event.detail || {};
  const url = String(d.url || '');
  if (!d.blocked || !/^https?:\/\//i.test(url)) return;
  let bar = $('openurl');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'openurl';
    bar.className = 'openurl';
    if (bar.setAttribute) bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  bar.textContent = '';
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = T('Open the link') + ': ' + url;
  a.addEventListener('click', () => { bar.hidden = true; });
  bar.appendChild(a);
  bar.hidden = false;
  console.log('PAGE OPEN_URL offered');
});

// The engine's events ('page' is the page's own, sent by fail())
window.addEventListener('ue-error', (event) => {
  const d = event.detail || {};
  if (d.kind && d.kind !== 'page') failKind(d.kind, d.message);
});
// Lines that name a failure the player should hear about. A printed line opens the device-lost card only when the line is the
// RHI's: "WEBGPU ERROR device lost" or "WebGPU device lost" at the start of a line, after one or two "Fatal error: " or
// "HARNESS ABORT ", after the fatal line's "Fatal error: [File:...] [Line: n]" and its line break, after LogWebGPU's error
// or fatal prefix, or in Emscripten's "Aborted(...)". A printed line opens the out-of-memory card only when it is a stop:
// "Ran out of memory" (the line every out-of-memory stop prints: the platform's sized stop, the RHI's stop after a buffer mapped
// at creation fails, and the graphics device's out-of-memory stop, which comes with the RHI change that calls
// ueOnWebGPUOutOfMemory) or TraceLog's "OOM allocating <n> bytes" at the start of a line, after one or two "Fatal error: " or
// "HARNESS ABORT " (the fatal output device's lines, which the error stream can print twice), after the fatal line's
// "Fatal error: [File:...] [Line: n]" and its line break, or after LogMemory's or LogTrace's fatal prefix; and Emscripten's
// "Cannot enlarge memory" and its "Aborted(OOM)". A line that only carries the text (a WebGPU error the RHI or the bindings
// print with the browser's "Out of memory", "Freeing ... to handle out of memory") opens no card, nor does a line that only
// quotes a lost device. "The start of a line" is the start of the print: text after a line break inside a print is the
// engine's only in the fatal line's shape. An abort's message keeps the whole patterns (fail: abortKind)
function classifyLine(t) {
  if (/(?:^(?:HARNESS ABORT )?(?:Fatal error: ){0,2}|^(?:HARNESS ABORT )?(?:Fatal error: ){1,2}\[File:[^\]\n]*\] \[Line: \d+\]\s+|^(?:\[[^\]\n]*\])*LogWebGPU: (?:Error|Fatal(?: error)?): |^Aborted\()(?:WEBGPU ERROR device lost|WebGPU device lost)/.test(t)) return 'device-lost';
  if (/(?:^(?:HARNESS ABORT )?(?:Fatal error: ){0,2}|^(?:HARNESS ABORT )?(?:Fatal error: ){1,2}\[File:[^\]\n]*\] \[Line: \d+\]\s+|^(?:\[[^\]\n]*\])*Log(?:Memory|Trace): Fatal(?: error)?: )(?:Ran out of memory|OOM allocating \d)|^Cannot enlarge memory|^Aborted\((?:OOM\b|Cannot enlarge memory)/.test(t)) return 'out-of-memory';
  return null;
}
// An abort's message (onAbort, the window's error event, the game module's start failing): any text that names a lost device
// or running out of memory (in capitals: "Out of memory"; OOM only as a whole word, so "room" is not one), and each engine's
// refusal of the game's memory as its whole message, alone or after the loader's "The game could not start: " (or the error
// event's "Uncaught "): WebKit's
// "RangeError: Out of memory", V8's "RangeError: WebAssembly.Memory(): could not allocate memory" and SpiderMonkey's thrown
// string "out of memory". Another text that only contains "out of memory" in lower case (a TypeError's) is not one
const memoryRefusal = /^(?:Uncaught )?(?:The game could not start: )?(?:RangeError: (?:Out of memory|WebAssembly\.Memory\(\): could not allocate memory)|out of memory)$/;
function abortKind(t) {
  if (/WEBGPU ERROR device lost|WebGPU device lost/.test(t)) return 'device-lost';
  return /Ran out of memory|Out of memory|Cannot enlarge memory|\bOOM\b/.test(t) || memoryRefusal.test(t) ? 'out-of-memory' : null;
}
// This page's stops are anchored (PageContract.md, Page hooks): classifyLine and rememberLine take only the engine's own line
// shapes, so a printed line that quotes a browser's text cannot stop the game or lead its card. The WebGPU bindings may then
// print that text as the browser gave it. A project's own wasm-play.js without these anchors leaves it unset
window.ueStopsAnchored = true;

// A line under the bar that stays while loading (browser advice, a compat warning)
function notice(text) {
  const n = $('notice');
  n.textContent = n.hidden ? text : n.textContent + ' ' + text;
  n.hidden = false;
}
// A note for the playing page (a line under the bar is gone once the cover lifts): shown when the cover lifts, under the key hint
// (index.html #corner stacks them, so a sound prompt that shows after it moves it down instead of covering it),
// for 10 s or until its x is clicked; on a harness run (no cover) when the game is ready, so its captures show it. One at a
// time: a later note replaces one not shown yet
let toastText = '';
function toast(text) {
  toastText = String(text || '');
  if (lifted) showToast();
}
function showToast() {
  const box = $('toast');
  if (!toastText || failed || !box) return;
  $('toast-text').textContent = toastText;
  console.log('PAGE TOAST ' + toastText);
  toastText = '';
  box.hidden = false;
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    box.classList.add('leaving');
    setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, 400);
  };
  timer = setTimeout(close, 10000);
  $('toast-close').onclick = close;
}
// GPU failures the page recovers from (Build/Template's part of the web RHI's hooks, WebGPUPipelines.cpp and WebGPUDevice.cpp):
// - a pipeline whose creation failed validation (a GPU short of a limit or a storage format a shader needs), or that the RHI did
//   not create because the shader exceeds the device's workgroup limits: the RHI skips it and calls ueOnWebGPUPipelineFailed
//   (kind, entry, message, fallback, limit): fallback is true on the deferred and desktop renderers, where a compute or
//   frame-critical failure reloads the page once on the forward renderer for this tab's session (sessionStorage: a saved menu
//   choice stands), except a compute failure with limit set (the shader exceeds the device's workgroup limits) on the deferred
//   renderer (tier, the RHI's sixth argument), unless the kernel is frame-critical: deferred runs the mobile renderer's kernels, so
//   forward fails the same way, and it is only logged. On the forward renderer a frame-critical failure
//   stops the game with a message instead of drawing broken frames; any other failure is logged (PAGE PIPELINE_FAILED) and the
//   game goes on. <meta name="ue-pipeline-fallback">: mobile (the default: the reload on the forward renderer; forward is the
//   same) or off (log only). A harness run reloads only with ?pipelinefallback=1
// - a lost device: the RHI calls ueOnWebGPUDeviceLost before its fatal error. <meta name="ue-device-lost">: stop (the default:
//   the error card; after a deferred or desktop start it also keeps this tab on the forward renderer, so the player's reload
//   starts forward) or reload (the page reloads, on the forward renderer after a deferred or desktop start; a
//   second loss within a minute, a loss after two automatic reloads in this tab's session, a harness run, or a page that
//   cannot keep the marker stops on the card)
// - a graphics device out of memory (an uncaptured GPUOutOfMemoryError): the RHI calls ueOnWebGPUOutOfMemory just before its
//   out-of-memory stop, whose card follows; after a deferred or desktop start the hook keeps this tab on the forward renderer,
//   as a lost device's stop does (recordGpuFallback), so the player's reload starts forward
// The next load says what happened in a toast after the cover lifts
const gpuFallbackKey = 'ue.' + (pageMeta('ue-project') || 'game') + '.gpuFallback';
const gpuRestartKey = 'ue.' + (pageMeta('ue-project') || 'game') + '.gpuRestart';
var recovering = false;   // a reload is under way: later errors are this failure's echo, not a new stop (var: fail() reads it)
(() => {
  let restart = null;
  try { restart = sessionStorage.getItem(gpuRestartKey); sessionStorage.removeItem(gpuRestartKey); } catch (e) { restart = null; }
  if (!restart) return;
  console.log('PAGE RESTART ' + restart);
  if (restart === 'pipeline' || restart === 'pipeline-desktop') toast("Switched to the forward renderer: this GPU couldn't run the desktop one.");
  else if (restart === 'pipeline-deferred') toast("Switched to the forward renderer: this GPU couldn't run the deferred one.");
  else if (restart === 'device-lost-mobile' || restart === 'device-lost-forward') toast('The graphics device was lost, so the game restarted on the forward renderer.');
  else if (restart === 'device-lost') toast('The graphics device was lost, so the game restarted.');
  else if (restart === 'gpu-oom-forward') toast('The graphics device ran out of memory, so the game now runs on the forward renderer.');
})();
function restartPage(marker, fallback, line) {
  try {
    if (fallback) sessionStorage.setItem(gpuFallbackKey, JSON.stringify(fallback));
    sessionStorage.setItem(gpuRestartKey, marker);
  } catch (e) { return false; }   // storage off: the next load could not tell (a loop), so no reload
  recovering = true;
  console.log(line);
  if (siteTimer) clearInterval(siteTimer);
  lifted = true;
  cover.hidden = false;
  cover.classList.remove('lifting', 'click');
  hint.hidden = true;
  $('progress-text').textContent = T(fallback ? 'Switching to the forward renderer...' : 'Restarting...');
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => location.reload(), 1500);
  return true;
}
const fellBack = () => { try { return !!sessionStorage.getItem(gpuFallbackKey); } catch (e) { return true; } };
// The renderer this start runs, from its whole command line as the engine reads it (wasm-compat.js runningTier and its one
// reader of the tier switches, tierSwitches: any case, '-' or '/'): desktop, deferred or forward. Every fallback record reads
// it (recordGpuFallback; the failed-pipeline hook when the RHI names no tier). Without wasm-compat.js (which index.html loads
// before this script), the link's or the stage's own tier arguments, in any case with '-' or '/'
const runningTier = () => {
  const a = (window.Module && window.Module.arguments) || [];
  if (window.ueCompat && typeof window.ueCompat.runningTier === 'function') return window.ueCompat.runningTier(a);
  const has = (name) => a.some((x) => String(x).toLowerCase().replace(/^\//, '-') === name);
  return has('-webgpusm5') ? 'desktop' : has('-webgpumobiledeferred') && !has('-webgpunomobiledeferred') ? 'deferred' : 'forward';
};
// The kernels whose loss leaves no usable frame: without instance culling the forward scene is garbled, without it or the light
// grid the deferred or desktop frame is black. A render pipeline loses one material; three, the frame
const frameCritical = [
  { kind: 'compute', entry: /^(InstanceCull|GPUScene)/, what: 'GPU scene culling' },
  { kind: 'compute', entry: /^LightGrid/, what: 'the light grid' },
  { kind: 'render', entry: /^/, count: 3, what: 'the base pass' },
];
const pipelineFailures = { render: 0, compute: 0 };
const appleShaderFixes = 27;   // the Safari and iOS version with the shader validation fixes named below
window.ueOnWebGPUPipelineFailed = (kind, entry, message, fallback, limit, rhiTier) => {
  const test = /TestFailPipeline/.test((window.Module && window.Module.arguments || []).join(' '));   // the RHI's repro switch
  pipelineFailures[kind] = (pipelineFailures[kind] || 0) + 1;
  // fallback: the RHI runs the deferred or the desktop renderer (the switches say which; with neither, the engine started its
  // desktop tier by itself, as a true fourth argument meant before the deferred tier)
  const tier = rhiTier || (fallback ? (runningTier() === 'deferred' ? 'deferred' : 'desktop') : 'forward');
  console.log('PAGE PIPELINE_FAILED ' + kind + ' ' + (entry || '-') + ' ' + tier + (test ? ' (test)' : '') + (limit ? ' (device limit)' : '') + ': ' + String(message || '').slice(0, 300));
  if (pageMeta('ue-pipeline-fallback', 'mobile') === 'off' || failed || recovering) return;
  const critical = frameCritical.find((c) => c.kind === kind && c.entry.test(entry || '') && pipelineFailures[kind] >= (c.count || 1));
  // A device limit on deferred is one forward has too (the same mobile renderer kernels), so only a frame-critical kernel is
  // worth the reload; from desktop the kernel may not exist on forward, so it still reloads
  if (fallback && (critical || (kind === 'compute' && !(limit && tier === 'deferred'))) && !fellBack() && (!harness || query.get('pipelinefallback') === '1')) {
    if (restartPage('pipeline-' + tier, { why: 'pipeline', from: tier, kind, entry: entry || kind, at: Date.now() }, 'PAGE PIPELINE_FALLBACK forward from ' + tier + ' (' + (entry || kind) + ')')) return;
  }
  if (critical && !fallback) {
    const game = document.title && !document.title.includes('%') ? document.title : 'the game';
    // Safari and iOS before 27 reject some valid web shaders (WebKit 176473479 binary arithmetic, 177008615 identifiers,
    // 177012957 short-circuit && and ||, fixed in 27.0), so there the likely cause is the system, not the GPU: the stop names the
    // update (a browser stop, which fail() shows as a device stop on iOS); a Mac can also play now in another browser
    // An iOS browser other than Safari (Chrome's CriOS, ...) names no version (webkit 0): every iOS browser is WebKit, so the
    // system is still the likely cause; the stop names the update for a system older than 27 without guessing this one's version
    const who = window.ueCompat && window.ueCompat.browser ? window.ueCompat.browser() : {};
    // (an iPad in desktop mode whose user agent names a Safari version below 26 is not telling the system's: it runs WebGPU)
    const iosUnknown = who.os === 'iOS' && (!(who.webkit > 0) || (/Macintosh/.test(who.ua || '') && who.webkit < 26));
    if ((who.os === 'iOS' || (who.name === 'Safari' && who.os === 'macOS')) && ((who.webkit > 0 && who.webkit < appleShaderFixes) || iosUnknown)) {
      const ios = who.os === 'iOS';
      const what = ios ? (who.device === 'tablet' ? 'iPadOS' : 'iOS') : 'Safari';
      const where = ios ? 'Settings > General > Software Update' : 'System Settings > General > Software Update';
      const device = who.device === 'tablet' ? 'iPad' : 'iPhone';
      fail(iosUnknown
        ? `This ${device} could not build ${critical.what} (${entry || kind}). ${what} ${appleShaderFixes} fixed shader bugs that can cause this: `
          + `if this ${device} has an older version, update it in ${where}.` + (test ? ' [test]' : '')
        : `${what} ${Math.floor(who.webkit)} could not build ${critical.what} (${entry || kind}). ${what} ${appleShaderFixes} fixed shader bugs that `
          + `can cause this: update it in ${where}` + (ios ? '.' : ', or play it now in Chrome.') + (test ? ' [test]' : ''), 'browser');
      return;
    }
    fail("This GPU can't run " + game + ': it could not build ' + critical.what + ' (' + (entry || kind) + ').' + (test ? ' [test]' : ''), 'gpu');
  }
};
// A GPU stop on the deferred or desktop renderer (a lost device's stop, a graphics device out of memory): this tab's next start
// takes the forward renderer (wasm-compat.js gpuFallback), so the player's reload does not start the failing renderer again,
// and the restart marker makes that start say why in a toast. Only for a start with an explicit upper-tier argument: a start
// without one runs whatever the RHI picks. The tier is read from the switches (runningTier, the page's one reader), not from
// the RHI's 'ue-webgpu-tier' event: that comes only once the RHI has decided its tier, and a loss can come before it. Nothing
// on forward, after this tab's fallback, while the page reloads, after it
// stopped or ended, or on a harness run unless the link asks with ?gpufallback=1. Prints PAGE GPU_FALLBACK when it records
function recordGpuFallback(why, marker, extra) {
  const from = runningTier();
  if (from === 'forward' || fellBack() || recovering || failed || coverState === 'ended') return false;
  if (harness && query.get('gpufallback') !== '1') return false;
  // (the RHI's precedence: -WebGPUSM5 wins over -WebGPUNoSM5, except in a Linux browser, where -WebGPUNoSM5 wins and
  // runningTier() gives the mobile tier; -WebGPUNoMobileDeferred wins over -WebGPUMobileDeferred), read by the same reader as
  // runningTier (UE-414068: any case, '-' or '/')
  const asksUpperTier = window.ueCompat && window.ueCompat.asksUpperTier;   // (a project's own older wasm-compat.js: none)
  if (typeof asksUpperTier !== 'function' || !asksUpperTier((window.Module && window.Module.arguments) || [])) return false;
  try { sessionStorage.setItem(gpuFallbackKey, JSON.stringify({ why, from, at: Date.now(), ...extra })); sessionStorage.setItem(gpuRestartKey, marker); } catch (e) { return false; }   // storage off
  console.log('PAGE GPU_FALLBACK ' + marker + ' (from ' + from + ')');
  return true;
}
window.ueOnWebGPUDeviceLost = (reason, message) => {
  const why = String(reason || 'unknown') + ': ' + String(message || '');
  console.log('PAGE DEVICE_LOST ' + why.slice(0, 300));
  // a lost device on the deferred or desktop renderer: this tab's next start takes the forward renderer, whether the page
  // reloads by itself (ue-device-lost reload) or the player reloads after the stop card (the default), so a reload does not
  // start the failing renderer again. A loss on forward records nothing, as before. The reload path deliberately keeps
  // runningTier(), the highest cooked tier
  const from = runningTier();
  const upper = from !== 'forward' && !fellBack();
  recordGpuFallback('device-lost', 'device-lost-forward');
  if (pageMeta('ue-device-lost', 'stop') !== 'reload' || harness || failed || recovering || coverState === 'ended') return false;
  const lastKey = 'ue.' + (pageMeta('ue-project') || 'game') + '.deviceLostAt';
  const countKey = 'ue.' + (pageMeta('ue-project') || 'game') + '.deviceLostReloads';
  let last = 0, count = 0;
  try {
    last = Number(sessionStorage.getItem(lastKey)) || 0;
    count = Number(sessionStorage.getItem(countKey)) || 0;
    sessionStorage.setItem(lastKey, String(Date.now()));
  } catch (e) { return false; }
  if (Date.now() - last < 60000) return false;   // twice in a minute: the card
  // a loss that comes back on every start, each more than a minute apart: two automatic reloads in this tab, then the card
  if (count >= 2) { console.log('PAGE DEVICE_LOST no reload: ' + count + ' automatic reloads in this tab'); return false; }
  try { sessionStorage.setItem(countKey, String(count + 1)); } catch (e) { return false; }   // counted before the reload is set up
  if (restartPage(upper ? 'device-lost-forward' : 'device-lost', upper ? { why: 'device-lost', from, at: Date.now() } : null,
    'PAGE DEVICE_LOST reload' + (upper ? ' on the forward renderer (from ' + from + ')' : ''))) return true;
  try { sessionStorage.setItem(countKey, String(count)); } catch (e) { /* storage off: no reload either way */ }   // no reload: not counted
  return false;
};
// A graphics device out of memory (an uncaptured GPUOutOfMemoryError): the RHI calls this on the browser main thread just before
// its out-of-memory stop, with device 'page' (the page's device) or 'engine' (a device the engine made). The stop and its card
// follow, so the hook only records (recordGpuFallback); its return value is not read
window.ueOnWebGPUOutOfMemory = (device) => {
  recordGpuFallback('gpu-out-of-memory', 'gpu-oom-forward', { device: device === 'engine' ? 'engine' : 'page' });
};

// The start-up steps, in order; the loader sets each one's state ('active', 'done', 'warn') and a detail line
const ueSteps = (() => {
  const order = [
    ['browser', 'Checking the browser'],
    ['gpu', 'Finding the graphics card'],
    ['settings', 'Picking the settings'],
    ['download', 'Downloading the game'],
    ['engine', 'Starting the engine'],
    ['site', 'Loading the level'],
  ];
  const list = $('steps');
  const rows = new Map();
  const started = new Map();
  for (const [id, label] of order) {
    const li = document.createElement('li');
    li.className = 'pending';
    li.innerHTML = '<span><span class="label"></span> <span class="detail"></span></span>';
    li.querySelector('.label').textContent = T(label);
    list.appendChild(li);
    rows.set(id, li);
  }
  function set(id, state, detail) {
    const li = rows.get(id);
    if (!li || (state === 'active' && failed)) return;   // after a stop no step spins again (a late byte count)
    if (state === 'active' && !started.has(id)) started.set(id, performance.now());
    li.className = state;
    if (detail !== undefined) li.querySelector('.detail').textContent = detail ? '(' + detail + ')' : '';
    if (state !== 'active') console.log('LOADSTEP ' + id + ' ' + state + ' ' + Math.round(performance.now()) + (detail ? ' ' + detail : ''));
  }
  // Seconds since the step went active, for its detail line ("0.3 s")
  const took = (id) => started.has(id) ? ((performance.now() - started.get(id)) / 1000).toFixed(1) + ' s' : '';
  // A step still active when the game is ready (no byte count reached its total) ends as done
  const finish = (id) => { const li = rows.get(id); if (li && li.className === 'active') set(id, 'done'); };
  // A stop (fail()): a step still active stops its spinner under the card and goes back to pending
  const stop = () => { for (const [id, li] of rows) if (li.className === 'active') set(id, 'pending'); };
  return { set, took, finish, stop };
})();

// The last stretch: the engine is up and loads the startup level (pipelines, textures). The page counts what the engine
// reports ('ue-progress' {fraction}, 'ue-warmup' {pso, textures}); without reports the bar eases from where it is towards 99 %
// (time constant tau s) until the ready signal
let siteTimer = null;
let warm = null;
window.addEventListener('ue-warmup', (event) => {
  const d = event.detail || {};
  if (!warm) warm = { most: 0, pso: 0, textures: 0 };
  warm.most = Math.max(warm.most, d.pso || 0);
  warm.pso = d.pso || 0;
  warm.textures = d.textures || 0;
});
let levelFraction = null;
window.addEventListener('ue-progress', (event) => {
  const d = event.detail || {};
  if (typeof d.fraction === 'number') levelFraction = Math.max(levelFraction || 0, Math.min(1, d.fraction));
});
// The level takes the line from the start-up download (progress above) and eases on from where the download left the bar.
// The engine streams the level's files while the download runs on, so on a slow network the level waits for bytes: the easing's
// time constant is a quarter of the download's remaining time at its rate so far, at least tau (Lyra, mobile tier: the engine
// was up at 7 s and ready at 19 s at 50 Mbit with half the start-up bytes in; at 10 Mbit up at 28 s, ready at 89 s, where tau
// alone left the bar at 98 % for the last 45 s). The level's line counts seconds or percent, whichever it started with: an
// engine's first 'ue-progress' (0 %) after seconds had been counted read as a step back
function siteStarted(tau) {
  coverTo('level');
  downloadOver();
  const from = shown, t0 = performance.now();
  const boot = window.ueBootDownload;
  if (boot && boot.at > boot.since && boot.total > boot.bytes) tau = Math.max(tau, (boot.total - boot.bytes) * (boot.at - boot.since) / boot.bytes / 4000);
  let unit = null;
  ueSteps.set('site', 'active');
  siteTimer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const eased = from + (0.99 - from) * (1 - Math.exp(-t / tau));
    if (warm && warm.most > 0 && warm.pso > 0) {
      const compiled = warm.most - warm.pso;
      progress(`Preparing shaders ${compiled} / ${warm.most}`, Math.max(eased * 0.5, from + (0.99 - from) * compiled / warm.most));
      ueSteps.set('site', 'active', `${compiled} / ${warm.most}`);
    } else if (warm && warm.textures > 0) {
      progress(`Loading textures (${warm.textures} left)`, eased);
      ueSteps.set('site', 'active', `${warm.textures} textures left`);
    } else {
      if (!unit) unit = levelFraction ? 'percent' : 'seconds';
      const counted = levelFraction !== null ? from + (0.99 - from) * levelFraction : 0;
      if (unit === 'percent') progress(`Loading the level... ${Math.round(levelFraction * 100)} %`, Math.max(eased * 0.5, counted));
      else progress('Loading the level... ' + t.toFixed(0) + ' s', Math.max(eased, counted));
    }
  }, 250);
  // A build that never sends the ready signal still gets the page back after two minutes
  setTimeout(gameReady, 120000);
}
// The pipeline hold (web.ReadyHoldPipelines, WasmPageBridge.cpp): the engine can keep the cover up after the ready signal while draws
// are still skipped for pipelines that compile (r.WebGPU.AsyncPipelines). It announces the hold with 'UE_RUN HOLD <cap ms>'
// before 'UE_RUN READY' and ends it with 'UE_RUN SETTLED <held ms> <settled|cap>' (main-thread lines, as the ready line; a
// build whose log does not reach the page sends the events 'ue-hold' {capMs} and 'ue-settled' {heldMs, reason}). The page
// only waits when the engine announced a hold, and at most the engine's cap plus 1 s. The engine's game-thread log (the
// 'Wasm pipelines: N draws skipped' reports) does not pass through Module.print, so the page cannot decide this itself.
// The hold pays only when the start-up download is in by ready: at 50 Mbit the boot containers were still
// arriving, the engine's sky light recapture waited on textures over the link, the hold reached its cap every time and the
// front end came 1.6-2.4 s later than with the cover lifted at ready. So the page follows the engine only when every start-up
// byte is in (wasm-loader.js ueBootDownload), or the rest arrives within 0.5 s at the rate measured so far, and otherwise
// lifts at ready; a load without byte counts (no service worker) follows the engine.
// <meta name="ue-pipeline-hold">: engine (follow the engine once the download is in, the default), always (follow the engine
// whatever the download) or off (lift at ready); ?hold= overrides it
const pipelineHold = (() => {
  const mode = String(query.get('hold') ?? pageMeta('ue-pipeline-hold', 'engine')).trim();
  let capMs = null, settled = null, proceed = null, readyAt = 0, timer = 0;
  // Why the start-up download rules the hold out ('' when it does not), and a PAGE HOLD download line
  function downloadPending() {
    const d = window.ueBootDownload;
    if (!d || !d.total) { console.log('PAGE HOLD download: no byte counts'); return ''; }
    const left = Math.max(0, d.total - d.bytes);
    const seconds = (d.at - d.since) / 1000;
    const rate = d.netBytes > 0 && seconds > 0 ? d.netBytes / seconds : 0;
    const eta = left <= 0.001 * d.total ? 0 : rate ? left / rate : Infinity;
    const text = `${megabytes(d.bytes)} of ${megabytes(d.total)} MB in at ready, ${megabytes(d.netBytes)} MB from the network`
      + (rate ? ` at ${(rate * 8 / 1e6).toFixed(0)} Mbit/s` : '') + (eta > 0 ? `, ${eta === Infinity ? 'no rate' : eta.toFixed(1) + ' s'} to go` : '');
    console.log('PAGE HOLD download: ' + text);
    return eta > 0.5 ? text : '';
  }
  function release(why) {
    if (!proceed) return;
    const next = proceed;
    proceed = null;
    clearTimeout(timer);
    console.log(`PAGE HOLD released ${why} ${Math.round(performance.now() - readyAt)} ms after ready`);
    next();
  }
  function announce(ms) {
    if (proceed || readyAt) return;   // announced after ready: too late to hold
    capMs = Math.max(0, Number(ms) || 0);
  }
  function settle(text) {
    settled = text || 'settled';
    release(settled);
  }
  window.addEventListener('ue-hold', (e) => announce(e.detail && e.detail.capMs));
  window.addEventListener('ue-settled', (e) => settle(e.detail && e.detail.reason));
  return {
    // 'UE_RUN HOLD <cap ms>' and 'UE_RUN SETTLED <held ms> <reason>' (wasm-loader.js print)
    line(t) {
      const hold = /UE_RUN HOLD (\d+)/.exec(t);
      if (hold) announce(hold[1]);
      const done = /UE_RUN SETTLED (\d+) (\w+)/.exec(t);
      if (done) settle(done[2]);
    },
    begin(next) {
      readyAt = performance.now();
      if (mode === 'off' || mode === '0' || capMs === null || capMs === 0 || settled) { next(); return; }
      const pending = mode === 'always' ? '' : downloadPending();
      if (pending) { console.log('PAGE HOLD skipped: the download is not in (' + pending + ')'); next(); return; }
      proceed = next;
      console.log(`PAGE HOLD start: the engine holds up to ${capMs} ms`);
      if (!harness) $('progress-text').textContent = T('Ready: preparing shaders...');
      timer = setTimeout(() => release('page cap'), capMs + 1000);
    },
  };
})();
// The game's own ready signal. By default (<meta name="ue-ready" content="engine">) the engine's ready marker lifts the cover. A
// game whose first playable moment comes later (its own loading screen, a streamed level, a menu that builds after the first
// frame) sets "game": the engine's marker then starts a wait of at most ue-ready-wait seconds (default 60) for the game's signal,
// and the cover lifts on the signal, or on the engine's marker when the wait runs out (a PAGE READY fallback line). A game can
// also ask for the wait itself before the engine's marker: window.ue.expectGameReady(), or the log line UE_RUN GAME_READY_EXPECTED.
// The signal: window.ue.gameReady() on the page's main thread (from the engine: MAIN_THREAD_ASYNC_EM_ASM), the event
// 'ue-game-ready', or the log line UE_RUN GAME_READY (wasm-loader.js print). ?ready=engine|game overrides the meta
const readySignal = (() => {
  const mode = String(query.get('ready') ?? pageMeta('ue-ready', 'engine')).trim();
  const waitMs = Math.max(0, Number(pageMeta('ue-ready-wait', '60')) || 60) * 1000;
  let expected = mode === 'game';
  let engineAt = 0, timer = 0, signalled = false;
  return {
    expect() {
      if (expected || ready || engineAt) return;
      expected = true;
      console.log('PAGE READY the game will signal it is ready');
    },
    // the engine's marker: true when the page should go on to the ready state now
    engine() {
      if (!expected || signalled) return true;
      if (!engineAt) {
        engineAt = performance.now();
        console.log(`PAGE READY engine marker: waiting for the game's signal (at most ${waitMs / 1000} s)`);
        timer = setTimeout(() => {
          console.log(`PAGE READY fallback: no game signal ${waitMs / 1000} s after the engine marker`);
          readyNow();
        }, waitMs);
      }
      return false;
    },
    signal() {
      if (signalled || ready || failed) return;
      if (!expected) {
        // ue-ready engine (the default), and no expectGameReady(): the engine's marker alone lifts the cover, as before
        console.log('PAGE READY game signal ignored: the page waits for the engine marker (ue-ready engine)');
        return;
      }
      signalled = true;
      clearTimeout(timer);
      console.log('PAGE READY game signal ' + (engineAt ? Math.round(performance.now() - engineAt) + ' ms after the engine marker' : 'before the engine marker'));
      readyNow();
    },
  };
})();
// The game is ready (the engine's marker; with ue-ready=game, the game's signal): the last line, then the cover lifts (at once, or
// on the player's click with ue-start=click), after the engine's pipeline hold when it announced one
function gameReady() {
  if (ready || failed) return;
  if (!readySignal.engine()) return;
  readyNow();
}
function readyNow() {
  if (ready || failed) return;
  ready = true;
  coverTo('ready');
  if (siteTimer) clearInterval(siteTimer);
  ueSteps.set('site', 'done', ueSteps.took('site'));
  ueSteps.finish('download');
  $('progress-text').textContent = T(startOnClick ? 'Ready: click to play' : 'Ready');
  if (cover.setAttribute) cover.setAttribute('aria-busy', 'false');
  progressBar(1);
  document.body.dataset.ready = '1';
  pipelineHold.begin(readyProceed);
}
function readyProceed() {
  if (failed || coverState === 'ended') return;   // a hold that ends after the game did must not hide the end card
  if (harness) { lifted = true; showToast(); return; }
  $('progress-text').textContent = T(startOnClick ? 'Ready: click to play' : 'Ready');
  if (startOnClick) {
    coverTo('click');
    cover.classList.add('click');
    const start = () => {
      resumeAudio();
      if (window.Module && Module.ueWebPage) Module.ueWebPage.lock();
      liftCover();
    };
    cover.addEventListener('click', start, { once: true });
    // The keyboard starts it too (the cover takes the focus; Enter or Space)
    if (cover.setAttribute) cover.setAttribute('tabindex', '0');
    if (cover.focus) cover.focus();
    cover.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); start(); } });
    return;
  }
  liftCover();
}
// The intro-shell slot. A project script (index.html <meta name="ue-shell" content="shell.js">, staged through the
// project's Build/Wasm/Template) plays something of its own while the engine boots and hands over when the game is ready:
//   ue.shell.register({ show(container) { ... }, handoff() { return a Promise }, hideLoader: true });
// show() gets the cover's #shell element (the default art is hidden); hideLoader hides the steps and the bar; at ready the
// page calls handoff() and lifts the cover when it resolves (at most 3 s later). Arguments for the engine go in
// window.ueExtraArgs before the game starts. The shell's events are PAGE SHELL lines
const ueShell = (() => {
  let shell = null;
  let handedOff = false;
  return {
    register(s) {
      if (shell || lifted || failed || !s) return false;
      shell = s;
      console.log('PAGE SHELL registered ' + Math.round(performance.now()));
      try {
        // only the default art (background, title) goes; #art also holds the bar and the notices, which stay
        // unless the shell asks (hideLoader)
        $('art').classList.add('shell');
        if (s.hideLoader) { $('steps').hidden = true; $('loader').hidden = true; }
        if (s.show) s.show($('shell'));
      } catch (e) { console.log('PAGE SHELL show failed: ' + e); }
      return true;
    },
    get active() { return !!shell; },
    get handedOff() { return handedOff; },
    async handoff() {
      if (!shell || handedOff) return;
      handedOff = true;
      const t0 = performance.now();
      try {
        if (shell.handoff) await Promise.race([Promise.resolve(shell.handoff()), new Promise((r) => setTimeout(r, 3000))]);
      } catch (e) { console.log('PAGE SHELL handoff failed: ' + e); }
      console.log('PAGE SHELL handoff ' + Math.round(performance.now() - t0) + ' ms');
    },
  };
})();
window.ue = window.ue || {};
window.ue.shell = ueShell;
window.ue.gameReady = () => readySignal.signal();
window.ue.expectGameReady = () => readySignal.expect();
window.addEventListener('ue-game-ready', () => readySignal.signal());

// (The cover lifted onto an empty canvas for 0.3-0.7 s; frame 1 presents before anything drew): the
// WebGPU RHI fires ue-first-canvas-frame on the first frame it copies to the canvas, and the cover waits for it, at most 3 s past
// the ready signal, so a build without the event still lifts
let canvasFrame = false, liftWaiting = false;
window.addEventListener('ue-first-canvas-frame', () => {
  canvasFrame = true;
  console.log('LOADTIME first_canvas_frame ' + Math.round(performance.now()));
  if (liftWaiting) liftCover(true);
});
function liftCover(force) {
  if (lifted || failed) return;
  if (!canvasFrame && force !== true) {
    if (!liftWaiting) { liftWaiting = true; setTimeout(() => liftCover(true), 3000); }
    return;
  }
  if (ueShell.active && !ueShell.handedOff) { ueShell.handoff().then(() => liftCover(true)); return; }
  lifted = true;
  coverTo('lifted');
  cover.classList.remove('click');
  cover.classList.add('lifting');
  setTimeout(() => { if (!failed) cover.hidden = true; }, 600);
  if (hintKeys.length) {
    hint.hidden = false;
    hint.classList.add('fresh');   // a few pulses so the player sees the keys
  }
  showToast();
  $('canvas').focus();
}
// Old name of gameReady() (scripts written for the previous page call it)
const coverReady = gameReady;
let logPrinting = false;   // wasm-loader.js sets it at the first printed line
const readyEvent = () => {
  if (!logPrinting) gameReady();
  else setTimeout(gameReady, 65000);   // the ready line should follow; the longest a cover waited for it was 60 s (Firefox)
};
for (const name of ['ue-ready', 'ue-site-ready', 'ue-interactive']) window.addEventListener(name, readyEvent);

// Sound: an AudioContext made before a gesture starts suspended (the autoplay rules). The first click, key or touch anywhere
// resumes it; the hint says so while it waits. A return visit that the browser trusts plays at once
function audioContext() { return window.Module && Module.ueAudioContext; }
let audioHidden = null;     // the context the page suspended while the tab is hidden (below)
let audioResuming = null;   // { context } of the page's latest resume still in flight (the context still reads 'suspended')
function resumeContext(context) {
  const resuming = { context };
  audioResuming = resuming;
  context.resume().catch(() => {}).then(() => { if (audioResuming === resuming) audioResuming = null; });
}
function resumeAudio() {
  const context = audioContext();
  if (context && context.state !== 'running' && document.visibilityState !== 'hidden') resumeContext(context);
}
for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, resumeAudio, { capture: true });
// A hidden tab is silent (WebKit browsers on iOS otherwise play on in the background and show the page as Now Playing): when the
// tab hides or the page goes, the page suspends a running context, one WebKit holds 'interrupted' (it plays again by itself when
// the interruption ends), or one the page's own resume is still starting, and on the way back resumes only the one it suspended.
// A context the game suspended or closed stays as it is; the gesture resume above waits while the tab is hidden
function mediaState(state) {
  try { if (navigator.mediaSession) navigator.mediaSession.playbackState = state; } catch (e) { /* no media session */ }
}
function hideAudio() {
  const context = audioContext();
  if (!context || !(context.state === 'running' || context.state === 'interrupted'
    || (audioResuming && audioResuming.context === context && context.state !== 'closed'))) return;
  audioResuming = null;
  audioHidden = context;
  context.suspend().catch(() => {});
  mediaState('paused');
}
function showAudio() {
  const context = audioHidden;
  if (!context || document.visibilityState === 'hidden') return;
  audioHidden = null;
  mediaState('none');
  // (not only 'suspended': a suspend still in flight reads 'running', and the resume queues behind it)
  if (context === audioContext() && context.state !== 'closed') resumeContext(context);
}
// A context the game makes while the tab is hidden (a tab hidden while the game loads; a return visit the browser trusts plays
// without a gesture) has no hide event of its own: while the tab is hidden the page looks for one once a second (hidden tabs
// run timers about that often anyway) and suspends it as above; a context the game leaves suspended stays as it is
let audioWatch = 0;
function watchHiddenAudio() {
  if (audioWatch || document.visibilityState !== 'hidden') return;
  audioWatch = setInterval(() => {
    if (document.visibilityState !== 'hidden') { unwatchHiddenAudio(); return; }
    // (also the context the page suspended, if the game plays it again while the tab is hidden)
    const context = audioContext();
    if (context && (context.state === 'running' || context.state === 'interrupted')) hideAudio();
  }, 1000);
}
function unwatchHiddenAudio() {
  if (audioWatch) clearInterval(audioWatch);
  audioWatch = 0;
}
function hidePage() { hideAudio(); watchHiddenAudio(); }
function showPage() {
  if (document.visibilityState === 'hidden') watchHiddenAudio();   // (a pageshow in a hidden tab)
  else unwatchHiddenAudio();
  showAudio();
}
document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? hidePage() : showPage()));
window.addEventListener('pagehide', hidePage);
window.addEventListener('pageshow', showPage);
watchHiddenAudio();   // a page that starts in a hidden tab (opened in the background) has no hide event

// The key hint from <meta name="ue-hint" content="Esc=Menu;Tab=Controls"> (none by default). A game that installs
// Module.ueWebPage and sets wanted=false (its menu is open) shows only the first key's entry ("Back to the game" for Esc)
const hintKeys = pageMeta('ue-hint').split(';').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const i = s.indexOf('='); return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : [s, '']; });
(() => {
  const keys = $('hint-keys');
  for (const [key, label] of hintKeys) {
    const span = document.createElement('span');
    span.className = 'key';
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    span.appendChild(kbd);
    span.appendChild(document.createTextNode(label));
    keys.appendChild(span);
  }
})();
setInterval(() => {
  // no key hints (ue-hint empty, the template default): the plate shows only the sound prompt, while the game plays
  const context = audioContext();
  const suspended = !!(context && context.state === 'suspended');
  if (!hintKeys.length) hint.hidden = !(suspended && lifted && !failed && !recovering && coverState !== 'ended');
  if (hint.hidden) return;
  const page = window.Module && Module.ueWebPage;
  const inMenu = !!(page && !page.wanted);
  const spans = $('hint-keys').children;
  for (let i = 0; i < spans.length; i++) {
    spans[i].hidden = inMenu && i > 0;
    if (i === 0 && spans[i].lastChild) spans[i].lastChild.textContent = inMenu ? 'Back to the game' : hintKeys[0][1];
  }
  $('hint-sound').hidden = !suspended;
}, 150);   // 150 ms: at 500 ms the text lagged the game's menu by 0.4-0.9 s

// Tab reaches the game: without a fullscreen keyboard lock the browser's default for Tab moves the focus off the canvas. While
// the game plays, the page cancels that default; the key still reaches the game's listeners. ?tab=browser leaves Tab alone
window.addEventListener('keydown', (event) => {
  if (query.get('tab') === 'browser') return;
  if (lifted && !failed && event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault();
}, { capture: true });

// The gesture a player's first click gives, for scripted checks (Runtime.evaluate with userGesture)
window.uePage = {
  gesture() {
    resumeAudio();
    $('canvas').focus();
    if (window.Module && Module.ueWebPage) Module.ueWebPage.lock();
    return true;
  },
};

$('reload').addEventListener('click', () => location.reload());
$('again').addEventListener('click', () => location.reload());
$('log').addEventListener('click', async () => {
  // UE's log lives in OPFS (Saved/Logs/<Project>.log, lowercased by the icase backend), unless Saved is in memory. A page that stopped before the game ran
  // (an unsupported browser) has none: the file is then the card's message and the page's own log (index.html pageLog), with a
  // line that says so instead of the storage error. The page's address goes without its query (it can carry ?args= and tokens).
  // The engine names its file in globalThis.ueLogFile: <Project>_2.log when another tab of this site holds <Project>.log
  const name = (window.ueLogFile || (pageMeta('ue-project') || 'game') + '.log').toLowerCase();
  let game = '';
  let why = '';
  try {
    const root = await navigator.storage.getDirectory();
    const logs = await (await root.getDirectoryHandle('logs')).getFileHandle(name);
    game = await (await logs.getFile()).text();
  } catch (e) {
    // No OPFS log: the game never started, or it did and keeps Saved in memory (?saved=memory, iOS), out of the page's reach
    why = e && e.name === 'NotFoundError'
      ? (engineRan ? 'The game\'s log is kept in memory in this browser (Saved is in memory: iOS, or ?saved=memory), so the page cannot read it.'
        : 'The game did not start, so it wrote no log of its own.')
      : 'The game\'s log could not be read (' + e + ').';
  }
  const text = [(document.title || name) + ', ' + new Date().toISOString() + ', ' + location.origin + location.pathname, navigator.userAgent, '',
    'The game stopped: ' + $('error-text').textContent, '']
    .concat(game ? ['== The game\'s log', game, ''] : [why, ''])
    // (the page's lines masked: no command line, queries or token-like runs; a CrashGUID is kept)
    .concat(['== The page\'s log (seconds since the page opened)'], typeof pageLog !== 'undefined' ? pageLog.map(redactLine) : []).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  link.download = name;
  link.click();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
});
