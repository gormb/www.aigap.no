// The capability check. A classic script: its top-level names are shared
// with the page's other scripts, which index.html loads in order (wasm-harness, wasm-compat, wasm-play, wasm-loader).
//
// The build is wasm64 with threads and SIMD (WasmToolChain.cs: -m64 -pthread -msimd128, a 1 GB heap growing to 4 GB) and
// draws with WebGPU; textures are cooked to the desktop BC formats only (WasmTargetPlatformControls.h), so an adapter
// without texture-compression-bc cannot show them. check() runs the synchronous tests before the loader fetches anything;
// probe() asks for the GPU adapter and reports its name, features and limits; report() gathers both for the bench and
// ?compat=1 pages. Safari has no Memory64: it runs a build whose Memory64 was lowered at link (staging adds ue-memory64=lowered),
// from Safari and iOS 26 (ue-min-apple-version below). Every iOS browser runs on WebKit, so iOS messages name the device or its
// system, never another browser.

window.ueCompat = (() => {
  // Tiny modules for WebAssembly.validate: shared 64-bit memory (memory flags 0x07: max, shared, i64) and one v128 function
  const memory64Threads = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 7, 1, 1]);
  const memory64 = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]);
  // Shared 32-bit memory (flags 0x03), for a build whose Memory64 was lowered at link (staging adds ue-memory64=lowered)
  const memory32Threads = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1]);
  const simd = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11]);
  const validates = (bytes) => { try { return WebAssembly.validate(bytes); } catch (e) { return false; } };

  // The browser, for messages and the report. Chromium's brands when it has them, else the user agent
  function browser() {
    const ua = navigator.userAgent;
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const brand = (name) => brands.find(b => b.brand === name);
    const match = (re) => { const m = ua.match(re); return m ? m[1] : ''; };
    let name = 'unknown';
    let version = '';
    // Android's browsers by name (the messages and the report): the Chromium-based ones other than Chrome carry Chrome/ too
    if (/Android/.test(ua) && !/Windows/.test(ua)) {
      if (/Firefox\//.test(ua)) { name = 'Firefox'; version = match(/Firefox\/(\d+)/); }
      else if (/SamsungBrowser\//.test(ua) || brand('Samsung Internet')) { name = 'Samsung Internet'; version = match(/SamsungBrowser\/(\d+)/); }
      else if (/EdgA\//.test(ua) || brand('Microsoft Edge')) { name = 'Edge'; version = match(/EdgA\/(\d+)/) || (brand('Microsoft Edge') || {}).version; }
      else if (/OPR\//.test(ua) || brand('Opera')) { name = 'Opera'; version = match(/OPR\/(\d+)/); }
      else if (/; wv\)/.test(ua) || brand('Android WebView')) { name = 'Android WebView'; version = match(/Chrome\/(\d+)/); }
      else if (brand('Google Chrome')) { name = 'Chrome'; version = brand('Google Chrome').version; }
      else if (/Chrome\//.test(ua)) { name = brand('Chromium') ? 'Chromium' : 'Chrome'; version = match(/Chrome\/(\d+)/); }
    }
    else if (brand('Microsoft Edge')) { name = 'Edge'; version = brand('Microsoft Edge').version; }
    else if (brand('Google Chrome')) { name = 'Chrome'; version = brand('Google Chrome').version; }
    else if (/Firefox\//.test(ua)) { name = 'Firefox'; version = match(/Firefox\/(\d+)/); }
    else if (/Edg\//.test(ua)) { name = 'Edge'; version = match(/Edg\/(\d+)/); }
    else if (/Chrome\//.test(ua)) { name = brand('Chromium') ? 'Chromium' : 'Chrome'; version = match(/Chrome\/(\d+)/); }
    else if (/Safari\//.test(ua)) { name = 'Safari'; version = match(/Version\/(\d+)/); }
    // an iPad in desktop mode sends a Mac user agent; its touch points give it away (no Mac has a touch screen)
    const ipadDesktop = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) || ipadDesktop ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown';
    const mobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|Mobile/.test(ua) || ipadDesktop;
    // a phone or a tablet (a tablet's Chrome leaves "Mobile" out of its user agent)
    const device = os === 'Android' ? (/Mobile/.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile) ? 'phone' : 'tablet')
      : os === 'iOS' ? (/iPad/.test(ua) || ipadDesktop ? 'tablet' : 'phone') : mobile ? 'tablet' : '';
    // The system's WebKit version on an Apple device (Safari on a Mac, every iOS browser), as a number (26.1): Safari's
    // Version/NN.N, which matches the system's version from 26 on (the user agent's "OS 18_6" is frozen there); an older system
    // still names its own in the OS string. 0 when unknown (an iOS browser other than Safari on the frozen OS string)
    // webkit is the major version (26); webkitVersion is [major, minor] for the minimum's test (appleAtLeast)
    let webkitVersion = null;
    if (os === 'iOS' || name === 'Safari') {
      const v = ua.match(/Version\/(\d+)(?:\.(\d+))?/);
      const o = ua.match(/OS (\d+)_(\d+)/);
      if (v) webkitVersion = [Number(v[1]), Number(v[2] || 0)];
      else if (o && Number(o[1]) < 18) webkitVersion = [Number(o[1]), Number(o[2])];
    }
    const webkit = webkitVersion ? webkitVersion[0] : 0;
    return { name, version: Number(version) || version, os, mobile, ua, device, webkit, webkitVersion };
  }

  // The GPU's family on a phone or tablet (the report and the messages), from the adapter's vendor and architecture as Chrome
  // names them (Dawn's GPU table), or its description where the browser gives one: adreno, mali, powervr, xclipse or other
  function gpuFamily(info) {
    const vendor = String(info.vendor || '').toLowerCase();
    const text = (String(info.architecture || '') + ' ' + String(info.description || '') + ' ' + String(info.device || '')).toLowerCase();
    if (vendor === 'qualcomm' || /adreno/.test(text)) return 'adreno';
    if (vendor === 'arm' || /\b(mali|immortalis)/.test(text)) return 'mali';
    if (vendor === 'img-tec' || vendor === 'imagination' || /powervr|imagination/.test(text)) return 'powervr';
    if (vendor === 'samsung' || /xclipse/.test(text)) return 'xclipse';
    return 'other';
  }
  // Android without a WebGPU adapter: Chrome turns WebGPU on from version 121 on Android 12 or newer for some GPU families only
  function noAdapterAndroid(b) {
    const what = b.device === 'tablet' ? 'tablet' : 'phone';
    if (!/^(Chrome|Chromium)$/.test(b.name)) return `This browser gives the page no WebGPU on this ${what}. Try it in Chrome.`;
    if (b.version && b.version < 121) return `WebGPU on Android needs Chrome 121 or newer; this is Chrome ${b.version}. Update Chrome.`;
    return `Chrome on this ${what} gives the page no WebGPU. Chrome turns it on from version 121 on Android 12 or newer for `
      + 'Qualcomm Adreno and Arm Mali GPUs and for some others on newer Android versions, and keeps it off for the rest (see chrome://gpu).';
  }

  // Linux and the Steam Deck: a message with the flags that give stock
  // Chrome a WebGPU adapter there, and the native build, which runs on Linux and the Deck through Proton without them. A page
  // that hosts a download names it with <meta name="ue-native-build" content="<url>">
  const nativeBuild = document.querySelector('meta[name=ue-native-build]')?.content || '';
  // The compatibility policy is the project's (index.html <meta>, filled from project settings):
  // ue-min-cpus and ue-min-memory-gb (below them: a warning), ue-texture-formats (WebGPU features the cooked textures need;
  // missing: the game cannot start), ue-mobile (warn | block | allow), ue-browser-advice (the line non-Chrome browsers read;
  // "none" for no line)
  const setting = (name, fallback) => { const v = document.querySelector('meta[name=' + name + ']')?.content; return v === undefined || v === '' ? fallback : v; };
  // The engine's own lowest GPU limits, for every project and tier: the mobile renderer, which every tier falls back to, binds
  // 9 storage buffers in one stage for light grid injection (LightGridInjectionCS; GPU scene culling's gathered variant fits in 8;
  // the RHI's "short of the mobile tier" line, WebGPUDevice.cpp). Below that the RHI skips that pass and the lights go missing, so
  // the page stops with the GPU card instead (UE-411844, UE-411886)
  function engineMinLimits() { return [['maxStorageBuffersPerShaderStage', 9]]; }
  const policy = {
    minCpus: Number(setting('ue-min-cpus', '4')) || 0,
    minMemoryGb: Number(setting('ue-min-memory-gb', '8')) || 0,
    textureFormats: setting('ue-texture-formats', 'texture-compression-bc').split(',').map((s) => s.trim()).filter(Boolean),
    mobile: setting('ue-mobile', 'warn'),
    browserAdvice: setting('ue-browser-advice', ''),
    // the engine's floor (engineMinLimits) and the project's list, the higher value of a limit both name
    minLimits: [...setting('ue-min-gpu-limits', '').split(',').map((s) => s.trim().split('=')).filter((p) => p.length === 2 && /^max[A-Za-z0-9]+$/.test(p[0].trim()) && Number(p[1]) > 0)
      .map(([k, v]) => [k.trim(), Number(v)]).reduce((m, [k, v]) => m.set(k, Math.max(v, m.get(k) || 0)), new Map(engineMinLimits()))],
  };
  // A stage with more than one texture set (UAT -WasmAddTextureSet) names them in order of preference,
  // <meta name="ue-texture-sets" content="bc=texture-compression-bc;astc=texture-compression-astc">: the game plays the first set
  // whose features the adapter has, except on a phone or tablet (the probe's handheld: an Android or iOS user agent, an iPad in
  // desktop mode included), which plays the first set with texture-compression-astc whose features the adapter has, ahead of a
  // BC set listed before it (an iPhone with BC and ASTC: ASTC's 8x8 blocks for color textures take less GPU memory than BC's
  // 4x4), and the listed order where none fits. ?textures=<name> plays that one (where the adapter has its features), on any
  // device. The loader passes the engine and the data cache only the chosen set's files. Without the tag the stage has one set,
  // ue-texture-formats.
  // "@mobile" after a set's features: the set runs the mobile forward renderer only (its cook's loose deferred-tier files, in a
  // build without tier containers, differ from the stage's, which UAT keeps), so startArgs passes it -WebGPUNoMobileDeferred
  // -WebGPUNoSM5 whatever the tier pick. "@nodesktop": the set runs the mobile renderers only (its cook's loose desktop-tier files
  // differ; the deferred tier's container has the set's own copy), so the stage's desktop tier does not count for it (stageHas)
  const textureSets = setting('ue-texture-sets', '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, spec] = s.split('=');
    const [features, flag] = (spec || '').split('@');
    const restriction = (flag || '').trim();
    return { name: name.trim(), features: (features || '').split(',').map((f) => f.trim()).filter(Boolean), mobileOnly: restriction === 'mobile', noDesktop: restriction === 'nodesktop' };
  });
  let chosenSet = null;
  let resolveSet = null;
  const setChosen = new Promise((resolve) => { resolveSet = resolve; });
  // The lowest Safari and iOS version the page lets in, for a build that can run there (ue-memory64=lowered):
  // <meta name="ue-min-apple-version">, 26 by default (Safari's WebGPU starts there), 0 for no version test. An older system
  // hears that an update fixes it, before the tests an update would pass
  // The minimum as [major, minor] ("26" or "26.1"); null for none (0, empty or not a version). Versions compare by major, then minor
  const minAppleMatch = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(setting('ue-min-apple-version', '26'));
  const minApple = minAppleMatch && (Number(minAppleMatch[1]) > 0 || Number(minAppleMatch[2] || 0) > 0) ? [Number(minAppleMatch[1]), Number(minAppleMatch[2] || 0)] : null;
  const minAppleVersion = minApple ? minApple[0] + (minApple[1] ? '.' + minApple[1] : '') : '';
  const appleAtLeast = (v, min) => v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
  function appleUpdate(b, v) {   // v: the system version the gate trusts (null: unknown)
    const ios = b.os === 'iOS';
    const what = ios ? (b.device === 'tablet' ? 'iPadOS' : 'iOS') : 'Safari';
    const where = ios ? 'Settings > General > Software Update' : 'System Settings > General > Software Update';
    const has = v ? v[0] + (minApple && minApple[1] ? '.' + v[1] : '') : '';
    // an iOS browser that names no version and has no WebGPU: either a system older than 26 or WebGPU turned off, so the line
    // names both
    const flag = ios && !v && !navigator.gpu
      ? ` If it already has ${what} 26 or later, check that WebGPU is on in Settings > Apps > Safari > Advanced > Feature Flags.` : '';
    return `The game needs ${what} ${minAppleVersion} or later` + (has ? ` (this ${ios ? (b.device === 'tablet' ? 'iPad' : 'iPhone') : 'Mac'} has ${has})` : '')
      + `. Update it in ${where}.` + flag;
  }
  // Apple GPUs offer texture-compression-bc in WebGPU from the A17 Pro and the M1
  const appleBcDevices = 'iPhones from the iPhone 15 Pro on, and iPads with an M-series or A17 Pro chip, have it.';
  // Linux only when the user agent says so and, where Chromium gives one, its platform hint agrees: the flags advice below must
  // not reach a GPU failure on Windows or a Mac whose user agent or hint names that system
  const onLinux = () => browser().os === 'Linux'
    && !(navigator.userAgentData && navigator.userAgentData.platform && navigator.userAgentData.platform !== 'Linux');
  const linuxAdvice = 'Chrome on Linux keeps WebGPU off. To play here, open chrome://flags, set "Vulkan" (#enable-vulkan) to '
    + 'Enabled and "Choose ANGLE graphics backend" (#use-angle) to Vulkan, restart the browser and reload this page (on a Steam Deck, '
    + 'in Desktop Mode). On Linux and the Steam Deck the native Windows build runs better, through Proton (the Steam compatibility '
    + 'layer)' + (nativeBuild ? ': ' + nativeBuild : '') + '.';

  // A page that is not cross-origin isolated: the fix is the host's, and the message names one that works on any host. Only
  // Cloudflare Pages-style hosts read _headers; a game portal often has no header control and an option instead (itch.io:
  // SharedArrayBuffer support), and a page inside a frame (a portal's player) is isolated only when the page around it is too,
  // which the frame's own headers or service worker cannot change (UE-411132). The frame's parent, where the browser names it
  const frame = () => {
    let framed = true, crossOrigin = true;
    try { framed = window.self !== window.top; } catch (e) { /* a sandboxed frame */ }
    try { crossOrigin = framed && !window.top.location.href; } catch (e) { /* the parent is another origin */ }
    const ancestors = location.ancestorOrigins;
    return { framed, crossOrigin, parent: framed && ancestors && ancestors.length ? ancestors[0] : '' };
  };
  const hostingHelp = 'Hosting help: Engine/Platforms/Wasm/Docs/Deploy.md, "Cross-origin isolation by host".';
  function isolationMessage() {
    const f = frame();
    const headers = 'Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp';
    const option = "turn on the host's cross-origin isolation option (on itch.io: Edit game > Embed options > SharedArrayBuffer support)";
    if (f.framed) {
      return 'The game runs in a frame' + (f.parent ? ' on ' + f.parent : f.crossOrigin ? ' on another site' : '') + ', and the browser '
        + 'isolates a frame only when the page around it is cross-origin isolated too, so the game cannot start its threads '
        + '(SharedArrayBuffer). To fix it, ' + option + ', or send ' + headers + ' with both pages and add '
        + 'allow="cross-origin-isolated" to the iframe. ' + hostingHelp;
    }
    // the page's own fallback (ue-sw-isolation 1) already had its reload when the check runs, so it is no fix to name then
    const fallback = setting('ue-sw-isolation', '0') === '1' ? ''
      : ' A host that offers neither: turn on Inject isolation headers (Project Settings > Platforms > Wasm), and the page\'s '
        + 'service worker adds them.';
    return 'The page is not cross-origin isolated, so the game cannot start its threads (SharedArrayBuffer). To fix it, send '
      + headers + ' with the page from the server (nginx, Apache, Cloudflare Pages\' _headers, ...), or ' + option + '.'
      + fallback + ' ' + hostingHelp;
  }
  // A page opened from disk (file://: a double-clicked index.html in a stage or an unzipped archive) loads no game file and is
  // never isolated, and Chrome counts it a secure context, so without this test it got the isolation message above, which
  // sends the player to server headers though no server is in use (UE-411308). The message names what serves it: the
  // launchers UAT -archive writes beside the page's folder (WasmPlatform.Automation.cs WriteLaunchers: Play_<Project>.bat,
  // play-<project>.sh) and serve.py
  const fromDisk = () => location.protocol === 'file:';
  function diskMessage() {
    const meta = setting('ue-project', '');
    const project = meta && !meta.includes('%') ? meta : '<Project>';
    // the launchers carry the page folder's name when it is not the cook platform's (WasmPlatform.Automation.cs LauncherSuffix:
    // any folder other than Wasm, or WasmClient for a client cook, gives Play_<Project>_<Folder>.bat)
    let folder = '';
    try { folder = decodeURIComponent(location.pathname.split('/').slice(-2, -1)[0] || ''); } catch (e) { /* a malformed path */ }
    const suffix = folder && !/^Wasm(?:Client)?$/i.test(folder) ? '_' + folder : '';
    // the shell command quotes a name with anything but plain characters in single quotes (a ' as '''), so it runs as shown
    // and a folder name can't expand or substitute in the shell
    const script = 'play-' + project.toLowerCase() + suffix + '.sh';
    const shellName = /^[A-Za-z0-9._-]+$/.test(script) ? script : "'" + script.replace(/'/g, "'\\''") + "'";
    return 'This page must be served over http(s): opening index.html from disk (file://) does not work. Run Play_' + project + suffix
      + '.bat next to the game\'s folder (on Mac or Linux: sh ' + shellName + '), or serve the folder '
      + 'that holds index.html with serve.py (python serve.py --root <that folder>), and open the address it prints.';
  }

  // Each test: id, pass, and the line a player reads when it fails
  const MIN_CHROMIUM = 133;   // the oldest Chromium engine the WebGPU RHI runs on (tests(): chromium_version)
  function tests() {
    const b = browser();
    const isolated = !!window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
    const lowered = setting('ue-memory64', '') === 'lowered';
    // Safari on a Mac and every iOS browser (a WebKit browser on Linux that calls itself Safari is not an Apple system)
    const apple = (b.name === 'Safari' && b.os === 'macOS') || b.os === 'iOS';
    // an Apple system older than the page's minimum (only where this build can run on Apple devices at all). An iOS browser
    // other than Safari (Chrome's CriOS, ...) names no version on the frozen "OS 18_6" string; every iOS browser is WebKit and
    // WebGPU arrives with iOS 26, so there no WebGPU means a system older than 26 (the update line), and WebGPU means 26 or later:
    // that meets the default minimum (26) only. A higher minimum (26.1, 27) cannot be shown on such a browser, so it gets the
    // update line too (the gate errs on the side of the minimum the project set)
    // Some iOS browsers send a stale Safari version (Chrome for iOS in desktop-site mode, other third-party browsers): a version
    // below 26 on iOS together with WebGPU (which arrives with 26 there) is not the system's, and on an iPad in desktop mode a
    // version below 26 cannot be told from the system's at all; either counts as unknown (decided by WebGPU, below)
    const staleIos = b.os === 'iOS' && b.webkitVersion && b.webkitVersion[0] < 26 && (/Macintosh/.test(b.ua) || !!navigator.gpu);
    const version = staleIos ? null : b.webkitVersion;
    const appleUnknownOld = b.os === 'iOS' && !version && (!navigator.gpu || (!!minApple && !appleAtLeast([26, 0], minApple)));
    const appleOld = apple && lowered && !!minApple && (version ? !appleAtLeast(version, minApple) : appleUnknownOld);
    // (on iOS another browser never helps: every browser there runs on WebKit)
    const browserHint = appleOld ? appleUpdate(b, version)
      : b.os === 'iOS'
        ? (lowered ? '' : 'This build cannot run on iPhone and iPad: it needs 64-bit WebAssembly memory (Memory64). Try it on a computer.')
        : b.name === 'Safari'
          ? (lowered ? 'Try it in Chrome.' : 'Safari cannot run this build yet: it has no 64-bit WebAssembly memory (Memory64). Try it in Chrome on a desktop.')
          : b.name === 'Firefox'
            ? 'Try it in Chrome.'
            : (b.name === 'Chrome' ? 'Update Chrome to the current version.' : 'Try it in Chrome.');
    const line = (text) => (browserHint ? text + ' ' + browserHint : text);
    // The oldest Chromium engine the WebGPU RHI runs on: it uses the unorm8x4-bgra vertex format (Chromium 133) and
    // read-write storage textures (124). An older one (Samsung Internet 26 is Chromium 121) downloads the game and then hangs,
    // so it stops here, before any download. By the Chrome/NNN token every Chromium browser sends (Samsung Internet, Edge,
    // Opera and Android WebView too); the vertex format has no check that runs without a device. Not on iOS, where every
    // browser is WebKit, and not Firefox or Safari
    const chromium = b.os !== 'iOS' && b.name !== 'Firefox' && b.name !== 'Safari' ? Number((b.ua.match(/Chrome\/(\d+)/) || [])[1]) || 0 : 0;
    const chromiumOld = chromium > 0 && chromium < MIN_CHROMIUM;
    const updateChromium = b.name === 'Chrome' ? 'Update Chrome to the current version.' : 'Update ' + (b.name === 'Chromium' ? 'this browser' : b.name) + ', or try it in Chrome.';
    return [
      { id: 'served', pass: !fromDisk(), message: fromDisk() ? diskMessage() : '' },
      { id: 'secure_context', pass: !!window.isSecureContext,
        message: 'Open the game over https or from localhost: browsers turn off WebGPU and shared memory on plain http pages.' },
      { id: 'webassembly', pass: typeof WebAssembly === 'object', message: line('This browser has no WebAssembly.') },
      { id: 'apple_version', pass: !appleOld, message: appleUpdate(b, version) },
      // (Safari's and iOS's hint for a build that is not lowered states the Memory64 fact itself)
      { id: 'memory64', pass: lowered || validates(memory64), message: !lowered && (b.os === 'iOS' || b.name === 'Safari') ? browserHint : line('This browser has no 64-bit WebAssembly memory (Memory64).') },
      { id: 'threads', pass: validates(lowered ? memory32Threads : memory64Threads), message: line('This browser cannot share WebAssembly memory between threads.') },
      { id: 'simd', pass: validates(simd), message: line('This browser has no WebAssembly SIMD.') },
      { id: 'cross_origin_isolated', pass: isolated,
        message: isolated ? '' : isolationMessage() },
      { id: 'webgpu', pass: !!navigator.gpu,
        message: b.os === 'Android'
          ? (b.name === 'Firefox' ? 'Firefox for Android has no WebGPU, which the game draws with. Try it in Chrome.' : noAdapterAndroid(b))
          : b.os === 'iOS' && lowered && !appleOld
          ? 'This browser has no WebGPU. Safari has it from iOS 26: check that WebGPU is on in Settings > Apps > Safari > Advanced > Feature Flags.'
          : b.name === 'Firefox'
          ? 'WebGPU is off in this Firefox. Firefox has it on Windows from version 141; elsewhere, try it in Chrome.'
          : onLinux()
            ? 'WebGPU is off in this browser. ' + linuxAdvice
            : line('This browser has no WebGPU.') },
      { id: 'mobile', pass: !(policy.mobile === 'block' && b.mobile),
        message: 'This game needs a desktop or laptop computer: phones and tablets are not supported.' },
      { id: 'chromium_version', pass: !chromiumOld,
        message: 'This browser is too old for the game (its engine is Chromium ' + chromium + '; the game needs ' + MIN_CHROMIUM + ' or later). ' + updateChromium },
    ];
  }

  // null when the synchronous tests pass, else the first failure's message (a page from disk first, then secure context: each
  // explains the ones after it);
  // failed(): that test's id (wasm-play.js fail() shows the isolation stop as the site's, not the browser's)
  let failedId = null;
  function check() {
    const failed = tests().find(t => !t.pass);
    failedId = failed ? failed.id : null;
    return failed ? failed.message : null;
  }

  // Chrome on Windows compiles WGSL through D3D12 with DXC, or with FXC when DXC is unavailable, and pipelines then compile about
  // 6x slower. The page cannot ask which; Chrome offers subgroups and shader-f16 on D3D12
  // only with DXC, so their presence says DXC and their absence says FXC, most likely
  function shaderCompiler(adapter) {
    if (browser().os !== 'Windows' || !/Chrome|Chromium|Edge/.test(browser().name)) return 'n/a';
    return adapter.features.has('subgroups') || adapter.features.has('shader-f16') ? 'dxc' : 'fxc (likely)';
  }

  // An integrated GPU, from the adapter's vendor and architecture: true, false, or null when the browser says nothing (Firefox)
  // or the name does not tell (an AMD APU reports the same rdna-N as a discrete card; the GPU timing check of the resolution
  // calibration decides those). Chrome on Windows runs WebGPU on the compositor's GPU and ignores powerPreference, so a
  // hybrid laptop often lands on the integrated one
  function integrated(info) {
    const vendor = (info.vendor || '').toLowerCase();
    const architecture = (info.architecture || '').toLowerCase();
    if (!vendor && !architecture) return null;
    if (vendor === 'intel') return !/hpg|alchemist|battlemage/.test(architecture);
    if (vendor === 'nvidia') return false;
    return null;
  }

  // No adapter (UE-411854). The cause a player can fix is the browser's hardware acceleration, turned off (Chrome and Edge:
  // "Use graphics acceleration when available", Firefox: "Use hardware acceleration when available"): it takes the GPU from
  // WebGPU and WebGL alike, while a GPU or driver the browser blocks for WebGPU (chrome://gpu, about:support) usually still
  // draws WebGL. So a WebGL context tells them apart, and only on this path (the normal start never makes one): a renderer
  // that is a software rasterizer (SwiftShader, llvmpipe, softpipe, WARP: Windows' "Basic Render Driver") is software
  // rendering; none at all is the GPU out of use (Chrome 157 with --disable-gpu gives no WebGL context: it falls back to
  // SwiftShader only with --enable-unsafe-swiftshader) and could also be a whole-GPU blocklist; a named GPU says
  // acceleration is on and only WebGPU has no GPU; a browser that hides the renderer ("WebKit WebGL", Firefox's resist
  // fingerprinting) says nothing, unless it refuses a context with failIfMajorPerformanceCaveat (software). rendering:
  // software, none, hardware or unknown; renderer: the WebGL renderer string (the console line), name: its short form (the card)
  const softwareRenderer = /swiftshader|llvmpipe|softpipe|lavapipe|(microsoft )?basic render driver|\bwarp\b|software (rasterizer|renderer|adapter)|gdi generic/i;
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)": NVIDIA GeForce RTX 4090
  const gpuName = (renderer) => {
    const angle = /^ANGLE \((.*)\)$/.exec(renderer);
    const device = angle ? (angle[1].split(', ')[1] || angle[1]) : renderer;
    return device.replace(/ \(0x[0-9a-f]+\).*$/i, '').replace(/ (Direct3D|OpenGL|Vulkan|Metal)\b.*$/, '').trim() || renderer;
  };
  function rendering() {
    try {
      const context = (attributes) => {
        const canvas = document.createElement('canvas');
        return canvas.getContext('webgl2', attributes) || canvas.getContext('webgl', attributes);
      };
      const done = (gl) => { const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); };
      const gl = context({});
      if (!gl) return { rendering: 'none', renderer: '', name: '' };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').slice(0, 160);
      done(gl);
      const software = softwareRenderer.exec(renderer);
      if (software) return { rendering: 'software', renderer, name: software[0] };
      if (renderer && !/^(webkit webgl|mozilla|generic renderer)$/i.test(renderer)) return { rendering: 'hardware', renderer, name: gpuName(renderer) };
      const fast = context({ failIfMajorPerformanceCaveat: true });
      done(fast);
      return { rendering: fast ? 'unknown' : 'software', renderer: '', name: '' };   // (the hidden name says nothing)
    } catch (e) {
      return { rendering: 'unknown', renderer: '', name: '' };
    }
  }
  // How to turn hardware acceleration back on, in this browser's words
  function accelerationSteps(b) {
    if (b.name === 'Firefox') return 'To turn it on in Firefox: Settings > General > Performance, clear "Use recommended performance settings", '
      + 'tick "Use hardware acceleration when available", then restart Firefox.';
    if (b.name === 'Edge') return 'To turn it on in Edge: Settings > System and performance > "Use graphics acceleration when available", then Restart.';
    // browser() reads desktop Opera as Chrome (its UA carries Chrome/ and OPR/): its setting lives elsewhere
    if (/\bOPR\//.test(navigator.userAgent || '')) return 'To turn it on in Opera: Settings > Advanced > Browser > System, '
      + 'turn on "Use hardware acceleration when available", then Relaunch.';
    if (/^(Chrome|Chromium)$/.test(b.name)) return `To turn it on in ${b.name}: Settings > System > "Use graphics acceleration when available", then Relaunch.`;
    // a browser the page does not know: its settings are not Chrome's
    return 'To turn it on: in the browser\'s settings, turn on hardware (graphics) acceleration, then restart the browser.';
  }
  // The card's text for no adapter on a desktop, by what the WebGL probe saw: hardware acceleration first (off when the probe
  // shows software rendering, else maybe off), then the GPU or driver the browser blocks; a WebGL that names a GPU puts the block first
  // page: the browser's GPU page, '' for a browser with none (the text then leaves the "(see ...)" out)
  function noAdapterDesktop(b, page, seen) {
    const steps = accelerationSteps(b);
    const see = page ? ` (see ${page})` : '';
    if (seen.rendering === 'software') {
      return 'The browser\'s hardware acceleration is off: it draws without the GPU (software rendering' + (seen.name ? ', ' + seen.name : '')
        + '), and WebGPU needs the GPU. ' + steps + ` If it is already on, the browser has blocked the GPU or its driver${see}.`;
    }
    if (seen.rendering === 'hardware') {
      return `WebGPU has no GPU to use here, although the browser's hardware acceleration is on (WebGL draws with ${seen.name}): `
        + `the GPU or its driver may be blocked for WebGPU by the browser${see}. Updating the GPU driver or the browser may help.`;
    }
    return 'WebGPU has no GPU to use here. The browser\'s hardware acceleration may be off. ' + steps
      + ` If it is on, the GPU or its driver may be blocked by the browser${see}.`;
  }
  // what the probe saw when there was no adapter ({ rendering, renderer }), else null: the card's headline (wasm-play.js)
  let noAdapterSeen = null;

  // The adapter, as the RHI asks for it (WebGPUDevice.cpp: high performance). Resolves to { message, adapter }; message is
  // null when the game can draw. Cached: the loader and the report share one request
  let probed = null;
  let adapterNow = null;  // the adapter's summary once probe() has it (runningTier)
  function probe() {
    if (probed) return probed;
    probed = (async () => {
      if (!navigator.gpu) { resolveSet(null); return { message: 'This browser has no WebGPU.', adapter: null }; }
      let adapter = null;
      try {
        adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      } catch (e) {
        resolveSet(null);
        return { message: 'The browser refused a WebGPU adapter: ' + e, adapter: null };
      }
      if (!adapter) {
        resolveSet(null);
        // the browser's GPU page; none for a browser that is not Chromium or Firefox (Safari, an unknown one)
        const page = browser().name === 'Firefox' ? 'about:support' : browser().name === 'Edge' ? 'edge://gpu'
          : /^(Chrome|Chromium)$/.test(browser().name) ? 'chrome://gpu' : '';
        // Stock Chrome on Linux gives no adapter, NVIDIA included: Vulkan alone, ANGLE on
        // Vulkan alone and --enable-unsafe-webgpu with Vulkan all fail; Vulkan with ANGLE on Vulkan plays S2. Project runs pass
        // those switches, so only a stock browser shows this. Tested as switches on NVIDIA, not through the flags page or on AMD
        // (a GPU that fails with the flags already on gets the line for that too). kind: the card's headline says browser, as the
        // fix is the browser's settings (wasm-play.js fail)
        if (browser().os === 'Android') return { message: noAdapterAndroid(browser()), adapter: null };
        const seen = browser().os === 'iOS' ? { rendering: 'unknown', renderer: '' } : rendering();
        console.log('WEB_COMPAT no adapter: rendering ' + seen.rendering + (seen.renderer ? ' (' + seen.renderer + ')' : ''));
        if (onLinux() && /Chrome|Chromium|Edge/.test(browser().name)) {
          // software rendering there: the flags cannot help until the browser uses the GPU at all
          const accel = seen.rendering === 'software'
            ? 'The browser\'s hardware acceleration is off as well (it draws without the GPU: software rendering' + (seen.name ? ', ' + seen.name : '') + '). '
              + accelerationSteps(browser()) + ' If both are already on, the GPU driver may be missing or blocked by the browser (see chrome://gpu).'
            : 'If both are already on, the browser\'s hardware acceleration may be off (' + accelerationSteps(browser()).replace(/\.$/, '')
              + '), or the GPU or its driver may be blocked by the browser (see chrome://gpu).';
          return { message: linuxAdvice + ' ' + accel, adapter: null, kind: 'browser', rendering: seen.rendering };
        }
        // WebKit (Safari, every iOS browser) has no hardware acceleration setting or GPU page. Seen there after the page's web
        // process ended twice in a row (iPhone 15 Pro), and gone once the tab or the app restarted; the card says only that.
        // The other iOS browsers are WebKit too but are not Safari (CriOS, FxiOS, EdgiOS, OPiOS and OPT/: Opera, GSA/: Google's
        // app, Ddg/: DuckDuckGo), nor is an app's web view, nor a WebKit browser on another system that calls itself Safari; a
        // browser that sends Safari's exact user agent is named Safari
        if (browser().name === 'Safari' || browser().os === 'iOS') {
          const apple = browser().os === 'macOS' || browser().os === 'iOS';
          const app = apple && browser().name === 'Safari' && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|Ddg\//.test(navigator.userAgent || '') ? 'Safari' : 'the browser';
          const App = app[0].toUpperCase() + app.slice(1);
          return { message: `${App} gave this page no GPU to use. This can follow several page ends in a row: `
            + `close this tab, or quit ${app} and open the page again.`, adapter: null, rendering: seen.rendering };
        }
        noAdapterSeen = seen;
        return { message: noAdapterDesktop(browser(), page, seen), adapter: null, rendering: seen.rendering };
      }
      let info = adapter.info || {};
      if (!adapter.info && adapter.requestAdapterInfo) {
        try { info = await adapter.requestAdapterInfo(); } catch (e) { info = {}; }
      }
      const limits = {};
      for (const key in adapter.limits) limits[key] = adapter.limits[key];
      const summary = {
        vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '',
        description: info.description || '', fallback: !!(adapter.isFallbackAdapter || info.isFallbackAdapter),
        features: [...adapter.features].sort(), limits,
        shader_compiler: shaderCompiler(adapter),
        integrated: integrated(info),
      };
      const handheld = browser().os === 'Android' || browser().os === 'iOS';
      if (handheld) summary.gpu_family = gpuFamily(info);
      adapterNow = summary;
      let message = null;
      let required = policy.textureFormats;
      const forcedSet = new URLSearchParams(location.search).get('textures');
      if (textureSets.length) {
        const candidates = forcedSet ? textureSets.filter((s) => s.name === forcedSet) : textureSets;
        const fits = (s) => s.features.every((f) => adapter.features.has(f));
        // a phone or tablet: the first ASTC set that fits, ahead of the listed order (the restrictions, "@mobile" and
        // "@nodesktop", only limit the renderers, and a phone or tablet starts on the forward one; ?tier= keeps the set's limit)
        const astcFirst = handheld && !forcedSet ? candidates.find((s) => s.features.includes('texture-compression-astc') && fits(s)) || null : null;
        const listed = candidates.find(fits) || null;
        chosenSet = astcFirst || listed;
        // none fits: the first candidate's missing features say why (the BC set's message where the stage prefers BC)
        required = chosenSet ? chosenSet.features : candidates.length ? candidates[0].features : [];
        if (forcedSet && !candidates.length) message = `This page has no texture set "${forcedSet}" (?textures=): it has ${textureSets.map((s) => s.name).join(', ')}.`;
        summary.texture_set = chosenSet ? chosenSet.name : null;
        console.log('WEB_COMPAT texture set ' + (chosenSet ? chosenSet.name : 'none') + (forcedSet ? ' (?textures=' + forcedSet + ')' : '')
          + (astcFirst && astcFirst !== listed ? ' (ASTC first on a phone or tablet)' : '')
          + ' of ' + textureSets.map((s) => s.name + '=' + s.features.join(',') + (s.mobileOnly ? '@mobile' : s.noDesktop ? '@nodesktop' : '')).join(' '));
      }
      resolveSet(chosenSet);
      const missingFormats = required.filter((f) => !adapter.features.has(f));
      // a desktop GPU on a stage of the ASTC set alone (the Wasm_ASTC cook flavor) that misses only ASTC features and has the BC
      // feature each one stands for (texture-compression-astc -> -bc, -astc-sliced-3d -> -bc-sliced-3d), as the Wasm variant asks
      // for them: the page hosts the phone build, which is the site's stop (below, once the GPU limits, which the Wasm variant
      // needs too, pass)
      const phoneBuild = !handheld && !textureSets.length && missingFormats.length > 0
        && !required.some((f) => f.startsWith('texture-compression-bc'))
        && missingFormats.every((f) => f.startsWith('texture-compression-astc') && adapter.features.has(f.replace('texture-compression-astc', 'texture-compression-bc')));
      let kind;
      if (!message && missingFormats.length && !phoneBuild) {
        // a phone's or tablet's GPU: most offer ASTC and no BC, so the line says which set this build would need
        const what = browser().device === 'tablet' ? 'tablet' : 'phone';
        message = handheld && missingFormats.includes('texture-compression-bc')
          ? `This ${what}'s GPU has no BC texture compression in WebGPU, which this build's textures use`
            + (adapter.features.has('texture-compression-astc') ? '; it has ASTC, which a build cooked with ASTC textures can use.' : '.')
            + (browser().os === 'iOS' ? ' ' + appleBcDevices : '')
          : missingFormats.includes('texture-compression-bc')
          ? 'This GPU has no BC texture compression in WebGPU, which the game\'s textures use. Use a desktop or laptop '
            + 'with an NVIDIA, AMD, Intel or Apple silicon GPU.'
          : 'This GPU lacks WebGPU features the game\'s textures need (' + missingFormats.join(', ') + ').';
      }
      // The lowest GPU limits: the engine's (engineMinLimits) and the project's (<meta name="ue-min-gpu-limits"
      // content="maxSampledTexturesPerShaderStage=20,...">, empty by default), limits its shaders need on the renderer it starts
      // with. A GPU short of one gets a plain message here instead of pipelines that are skipped or fail to build later
      if (!message && policy.minLimits.length) {
        const short = policy.minLimits.filter(([k, v]) => typeof limits[k] === 'number' && limits[k] < v);
        if (short.length) {
          summary.short_limits = short.map(([k]) => k);
          message = 'This GPU\'s WebGPU limits are below what the game\'s shaders need (' + short.map(([k, v]) => `${k} ${limits[k]}, needs ${v}`).join('; ')
            + '). A newer browser or GPU driver may report higher limits.';
        }
      }
      if (!message && phoneBuild) {
        kind = 'site';
        message = 'This page hosts the phone build of the game (the Wasm_ASTC cook flavor, ASTC textures), and this GPU lacks the ASTC '
          + 'texture features it needs in WebGPU (' + missingFormats.join(', ') + '). Desktop browsers need the Wasm variant, whose BC '
          + 'textures this GPU supports.';
      }
      // ?bench=: the bench page prepares its script before the game starts (wasm-bench.js)
      if (!message && window.ueBench) message = await window.ueBench.wait;
      return { message, adapter: summary, ...(kind ? { kind } : {}) };
    })();
    return probed;
  }

  // Warnings that do not stop the game
  function warnings(adapter) {
    const b = browser();
    const list = [];
    if (b.mobile && policy.mobile === 'warn') list.push('Phones and tablets are not supported: the game needs a keyboard and mouse or a gamepad, and more memory than most phones give a page.');
    if (navigator.deviceMemory && policy.minMemoryGb && navigator.deviceMemory < policy.minMemoryGb) list.push(`This device reports ${navigator.deviceMemory} GB of memory; the game is made for ${policy.minMemoryGb} GB or more, so it may run out.`);
    if (policy.minCpus && (navigator.hardwareConcurrency || 0) < policy.minCpus) list.push(`This device reports ${navigator.hardwareConcurrency || '?'} logical CPUs; the game is made for ${policy.minCpus} or more, so it may not keep up.`);
    if (adapter && adapter.shader_compiler === 'fxc (likely)') list.push('The browser compiles shaders with FXC here (no DXC), so the first start compiles about 6x slower.');
    if (adapter && adapter.integrated && browser().os === 'Windows') {
      list.push('The game is running on the integrated GPU. If this computer also has an NVIDIA or AMD graphics card, open '
        + 'Windows Settings > System > Display > Graphics, add ' + browser().name + ', set it to High performance, and restart the browser.');
    }
    if (adapter && adapter.fallback) list.push('WebGPU is running on a software renderer (no GPU), so the game will be very slow.');
    return list;
  }

  // The GPU timing check: a fixed fragment load (a full-screen pass, 48 iterations of noise and fused multiply-adds per
  // pixel) drawn into a 1920x1080 target, timed with timestamp queries when the adapter offers them (Chrome rounds them to
  // 0.1 ms without its unsafe flag: the measured span is several ms) and else by the wall time to onSubmittedWorkDone. It runs
  // on a device of its own while the game downloads, and is destroyed before the game asks for its device. ms is the fastest
  // sample per draw (benchMs); median_ms the median, for the logs; mpix_per_ms the throughput. The resolution pick maps ms to a
  // screen percentage (pickScreenPercentage)
  // A timestamp span longer than the round's wall time (submit to onSubmittedWorkDone, plus staleMarginMs for Chrome's 0.1 ms
  // rounding) cannot be the pass's own: on an Intel Arc A770 (Chrome and Edge, Dawn D3D12) the begin timestamp kept one value
  // in every round while the end advanced, so the check read 15-29 s per draw and started a deferred-class GPU on forward
  // (UE-411822). Such a round takes its wall time, as on an adapter without timestamp queries; timer says so ('wall (stale
  // timestamps)'), and the page logs it once
  const staleMarginMs = 1;
  const benchShader = `
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
      return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    }
    @fragment fn fs(@builtin(position) c: vec4f) -> @location(0) vec4f {
      var v = vec3f(c.xy * 0.001, 0.5);
      for (var k = 0; k < 48; k++) {
        v = fract(sin(v.yzx * 12.9898 + v.zxy * 78.233) * 43758.5453) * 0.5 + v * 0.5;
        v = fma(v, vec3f(1.0001), vec3f(0.0001));
      }
      return vec4f(v, 1.0);
    }`;
  // The check's reading from its samples: the fastest. Other work on the GPU only adds time to a timed pass, never takes it
  // away, so a busy GPU spreads the samples upwards and the median moved with the load (UE-411930: an RTX 3080 sharing its
  // GPU read medians of 0.466-0.634 ms, forward, while its fastest samples read 0.359-0.364, its idle 0.359), and a slow GPU
  // reads slow in every sample, so its fastest stays above the steps. Timestamps rounded to 0.1 ms (Chrome without its unsafe
  // flag) move one sample by at most 0.1 ms / 6 draws, about 0.017 ms. The first check and the recheck of a stored reading
  // both read it from here
  // A wall-time round shorter than the timer's precision reads 0 ms: not a sample. When most rounds read 0 the timer is too coarse
  // for this GPU and the one round that crossed a tick is no timing either: no reading (0)
  const benchMs = (samples) => { const real = samples.filter((x) => x > 0); return real.length && real.length * 2 >= samples.length ? Math.min(...real) : 0; };
  let benched = null;
  function gpuBench() {
    if (benched) return benched;
    benched = (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return null;
        const timed = adapter.features.has('timestamp-query');
        const device = await adapter.requestDevice({ requiredFeatures: timed ? ['timestamp-query'] : [] });
        const width = 1920, height = 1080, draws = 6, rounds = 5;
        const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const module = device.createShaderModule({ code: benchShader });
        const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
        const querySet = timed ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
        const resolve = timed ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
        const read = timed ? device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
        const samples = [];
        let staleLogged = false, staleSamples = 0;
        // No long warm-up: data-center GPUs were at boost clocks during the check and a 400 ms warm-up only pushed one into
        // its power limit, about 10 % slower; round 0 below warms the pipeline
        const warmStart = performance.now();
        for (let round = 0; round < rounds + 1; round++) {
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
            ...(timed ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}) });
          pass.setPipeline(pipeline);
          for (let d = 0; d < draws; d++) pass.draw(3);
          pass.end();
          if (timed) { encoder.resolveQuerySet(querySet, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, read, 0, 16); }
          const t0 = performance.now();
          device.queue.submit([encoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          const wall = performance.now() - t0;
          let ms = wall;
          if (timed) {
            await read.mapAsync(GPUMapMode.READ);
            const [begin, end] = new BigUint64Array(read.getMappedRange());
            const span = Number(end - begin) / 1e6;
            read.unmap();
            if (span > wall + staleMarginMs) {
              if (!staleLogged) console.warn(`GPU check: rejected the GPU timestamps (begin ${begin}, end ${end}: ${span.toFixed(2)} ms in ${wall.toFixed(2)} ms of wall time); timing by the wall time`);
              staleLogged = true;
              if (round > 0) staleSamples++;
            } else if (span > 0) ms = span;
          }
          if (round > 0) samples.push(ms / draws); // round 0 is the first with timestamps
        }
        device.destroy();
        samples.sort((x, y) => x - y);
        const ms = benchMs(samples);
        const median = samples[Math.floor(samples.length / 2)];
        return { ms: +ms.toFixed(3), median_ms: +median.toFixed(3), total_ms: Math.round(performance.now() - warmStart), mpix_per_ms: +(width * height / 1e6 / ms).toFixed(2),
          timer: staleSamples ? 'wall (stale timestamps)' : timed ? 'timestamp' : 'wall', samples: samples.map(x => +x.toFixed(3)) };
      } catch (e) {
        return { error: String(e) };
      }
    })();
    return benched;
  }

  // The starting screen percentage from the GPU timing check. Calibration: on an
  // RTX 5080 a heavy physics test scene costs 1.48 ms of GPU at 72.9 % of 1920x1080 (Chrome, WEBGPU_GPU, every submission timed) and the
  // check reads 0.164 ms, so the scene costs about 9x the check's ms at 72.9 %, scaling with pixels. The pick is the largest
  // step whose predicted collapse cost stays within 6 ms, about a third of a 60 Hz frame (the rest is headroom for spikes, TAA
  // history and the CPU-bound frame overlapping). An 8 ms budget picked 115 on an NVIDIA L4 (0.350 ms), above what the
  // 5080's numbers support for a card a third of its speed; 6 ms gives the L4 100. Measured: L4 0.35-0.39 ms (100 %),
  // L40S 0.11 ms (133 %). The check runs at boost clocks, the game often at idle ones, so this picks a resolution, not a
  // frame time; dynamic resolution corrects it while playing
  const sceneFactor = 9.0, budgetMs = 6, baseSp = 72.9;
  const resolutionSteps = [72.9, 85, 100, 115, 133];
  // <meta name="ue-resolution-floor" content="100">, empty by default: where the adapter has timestamp-query the RHI times the GPU's
  // frames and dynamic resolution lowers the resolution under load, so the start is at least this step (a faster GPU's pick above
  // it stays); without GPU timing dynamic resolution has no input and the start stays the pick from the first step
  const timedFloor = Number(setting('ue-resolution-floor', '')) || 0;
  function pickScreenPercentage(bench, timed) {
    if (!bench || !(bench.ms > 0)) return null;
    const sp = baseSp * Math.sqrt(budgetMs / (sceneFactor * bench.ms));
    let pick = resolutionSteps[0];
    for (const step of resolutionSteps) if (step <= sp) pick = step;
    // (a check whose stale timestamps fell back to wall time still ran on a timestamp-query adapter: the floor applies to it too)
    const floor = (timed ?? (bench.timer === 'timestamp' || bench.timer === 'wall (stale timestamps)')) ? resolutionSteps.find((s) => s >= timedFloor) : null;
    return floor && timedFloor > 0 && floor > pick ? floor : pick;
  }

  // The renderer and preset from the adapter's features and the same GPU check. Three tiers, page ids forward (alias mobile),
  // deferred and desktop. wasm-tiers.json at the stage root lists the stage's shader platforms: "ES3_1" (mobile forward,
  // always), "ES3_1_DEFERRED" (mobile deferred, SP_WEBGPU_ES3_1_DEFERRED: the project's bTargetMobileDeferredTier, also
  // "deferred": true) and "SM5" (the desktop tier: the project's bTargetDesktopTier opt-in, also "sm5": true); a stage without
  // the file is forward only, so this is a no-op there. One cook carries every tier the stage lists.
  // The pick: forward on phones and tablets (iPhone, iPad and Android user agents: no GPU check there), on GPUs below the GPU
  // check's class and without a timing; deferred on desktop-class GPUs (the desktop steps below); desktop only where the stage
  // has SM5 (the project opted in), on a desktop-class GPU with subgroups, clip-distances and texture-formats-tier2. A tier
  // whose device requirements (wasm-tiers.json "requirements", tierShortfall) the adapter falls short of is not picked: the RHI
  // checks the same and would run forward. Medium is the only validated desktop level. Firefox has no
  // subgroups, so it never gets the desktop tier, and it starts forward until the deferred tier is validated there (a desktop
  // request it cannot meet gives forward too; ?tier=deferred and the menu still choose deferred).
  // ?tier=forward|mobile|deferred|desktop and a game menu's choice (localStorage ue.<project>.renderer, written by the game)
  // override the pick, for tiers the stage has (desktop on a stage without SM5 asks for deferred, deferred on a stage without
  // it gives forward)
  // shader-f16 is not needed. The WGSL shader format compiles every shader without 16-bit
  // types (ShaderFormatWGSL.cpp bEnable16bitTypes = false) and the RHI never requests it; Linux Chrome on an L4 or L40S offers no
  // shader-f16 and ran the SM5 tier with 0 WebGPU errors
  const desktopFeatures = ['subgroups', 'clip-distances', 'texture-formats-tier2'];
  // the check's ms per draw (medians, before the check read its fastest sample: on an idle GPU the two are close, e.g. the
  // RTX 3080's 0.359-0.36 in UE-411930): L40S 0.109 (cloud, 3 runs), L4 0.327-0.329 (cloud) and 0.354-0.403 (Windows Chrome). Desktop
  // Medium at 0.42 or less, just above the L4's slowest reading; slower GPUs stay forward. No High bucket: only Medium is validated
  // <meta name="ue-desktop-tiers" content="0.22=High,0.42=Medium"> (strictest first) replaces the steps for a project that has
  // validated more presets on the desktop tier. The loosest step is also the deferred tier's GPU class
  const tierSteps = (text, fallback) => {
    const steps = String(text || '').split(',').map((s) => s.trim().split('=')).filter((p) => p.length === 2 && Number(p[0]) > 0 && /^[A-Za-z0-9_]+$/.test(p[1].trim()))
      .map(([ms, preset]) => ({ ms: Number(ms), preset: preset.trim() })).sort((a, b) => a.ms - b.ms);
    return steps.length ? steps : fallback;
  };
  const desktopTiers = tierSteps(setting('ue-desktop-tiers', ''), [{ ms: 0.42, preset: 'Medium' }]);
  // The mobile renderers' start preset (forward and deferred) by GPU class too. A GPU whose check reads 0.2 ms per draw or less
  // (RTX 5080 0.164, L40S 0.110) starts at High (an RTX 5080 held 16.7 ms through a heavy physics scene at every preset on
  // ES3_1); slower ones get no preset.
  // A game applies it at each start until the player has chosen other scalability settings, so a menu choice stands; a start
  // without a preset keeps the levels the game loads (its saved settings, which can be an earlier start's pick)
  // <meta name="ue-mobile-tiers">, in the same form, replaces these steps
  const mobileTiers = tierSteps(setting('ue-mobile-tiers', ''), [{ ms: 0.2, preset: 'High' }]);
  // <meta name="ue-default-tier">: auto (the default) lets the GPU class pick; deferred: no automatic desktop tier (only on
  // ?tier=desktop or a game menu's choice); forward (or mobile): the forward renderer unless the link or the menu asks for another
  const defaultTier = (() => { const t = setting('ue-default-tier', 'auto'); return t === 'mobile' ? 'forward' : t; })();
  let stageTiers = null;
  let stageNow = null;  // wasm-tiers.json once read (runningTier)
  function tiers() {
    if (!stageTiers) {
      // (a missing file, 404 or 410, is a forward-only stage: {}; any other failure, or a file that is not a JSON object, leaves
      // the tiers unknown, { unread: true }, which reads as forward-only for the pick, as before, except that a harness start
      // without ?tier= gets no worker cap, a harness ?tier=desktop keeps its ask (resolveChoice) and runningTier lets the switches
      // decide)
      stageTiers = fetch('wasm-tiers.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : r.status === 404 || r.status === 410 ? {} : { unread: true })).catch(() => ({ unread: true }))
        .then((s) => (s && typeof s === 'object' && !Array.isArray(s) ? s : { unread: true }))
        .then((s) => { stageNow = s; return s; });
    }
    return stageTiers;
  }
  // What wasm-tiers.json says the stage was cooked for; without the desktop tier once a texture set without it is chosen
  // ("@nodesktop", startArgs), and forward only for a "@mobile" set
  let setNoDesktop = false;
  let setMobileOnly = false;
  // No desktop tier in a Linux browser (the WebGPU RHI runs it there only with -WebGPUSM5 and no -WebGPUNoSM5): Chrome on Linux
  // (NVIDIA L4, Vulkan) spent about 1.3 ms of its GPU process on each indirect compute dispatch, which halved the tier's frame
  // rate in Lyra. -WebGPUSM5 in the link's ?args= (for test runs, such as the farm's desktop-tier runs in Linux Chrome) lifts
  // that, on a stage whose links pass every argument (ue-query-args all, Development): the loader passes the link's -WebGPUSM5
  // to the engine first, so the RHI runs the tier. The switch is read as the engine reads it (FParse::Param: any case, - or /;
  // the loader's splitArgs removes double quotes), or the RHI would run a tier the page did not pick
  const linuxDesktopAllowed = () => setting('ue-query-args', 'safe') === 'all'
    && String(query.get('args') || '').replace(/"/g, '').split(/\s+/).some((a) => /^[-\/]webgpusm5$/i.test(a));
  const noLinuxDesktop = () => onLinux() && !linuxDesktopAllowed();
  function stageHas(stage) {
    const platforms = stage && Array.isArray(stage.shaderPlatforms) ? stage.shaderPlatforms : [];
    return {
      sm5: !setNoDesktop && !setMobileOnly && !noLinuxDesktop() && !!stage && (stage.sm5 === true || platforms.includes('SM5')),
      deferred: !setMobileOnly && !!stage && (stage.deferred === true || platforms.includes('ES3_1_DEFERRED')),
    };
  }
  // What the WebGPU RHI checks on the device before it runs a tier above forward (WebGPUDevice.cpp), from wasm-tiers.json
  // "requirements" (UAT WriteTiers: the deferred tier's GBuffer color attachments and bytes per sample, which
  // r.Mobile.ExtendedGBuffer decides; the desktop tier's limits and features): what this adapter falls short of, as text, empty
  // when it has everything, the stage names nothing (an older stage) or the adapter is not known yet. A limit the adapter does
  // not report counts as met. The RHI's test switches (-WebGPUMobileDeferredForceFallback...) are not read: when one changes the
  // tier, the page follows the RHI's tier event (wasm-loader.js)
  const tierPlatform = { deferred: 'ES3_1_DEFERRED', desktop: 'SM5' };
  function tierShortfall(tier, adapter, stage) {
    const all = stage && stage.requirements && typeof stage.requirements === 'object' ? stage.requirements : {};
    const need = all[tierPlatform[tier]];
    if (!adapter || !need || typeof need !== 'object') return [];
    const limits = need.limits && typeof need.limits === 'object' ? need.limits : {};
    const has = adapter.limits || {};
    const features = Array.isArray(adapter.features) ? adapter.features : [];
    return Object.keys(limits).filter((k) => typeof limits[k] === 'number' && typeof has[k] === 'number' && has[k] < limits[k]).map((k) => `${k} ${has[k]} < ${limits[k]}`)
      .concat((Array.isArray(need.features) ? need.features : []).filter((f) => typeof f === 'string' && !features.includes(f)));
  }
  // The page's one reader of the renderer tier switches (-WebGPUSM5, -WebGPUNoSM5, -WebGPUMobileDeferred, -WebGPUNoMobileDeferred),
  // as the engine reads them (WebGPUDevice.cpp, WasmPlatformMisc.cpp: FParse::Param over the joined command line, a word between
  // spaces in any case, with '-' or '/', never inside quotes): each switch a command line names, lower case with '-'. An argument
  // is joined as LaunchWasm.cpp joins it: one with a space and no quote is quoted, so no word of it is read; one with quotes is
  // read outside them (-a="x y" -WebGPUSM5, a string window.ueExtraArgs). runningTier, wasm-play.js's fallback records and the loader's
  // argument assembly (dropTierSwitches) all read the switches through it (UE-414068: the lost-device record matched only
  // '-WebGPUMobileDeferred' and '-WebGPUSM5' as written, so ?args=-webgpumobiledeferred ran deferred and recorded no fallback)
  const tierSwitchNames = ['-webgpusm5', '-webgpunosm5', '-webgpumobiledeferred', '-webgpunomobiledeferred'];
  const tierSwitch = (arg) => { const a = String(arg).toLowerCase().replace(/^\//, '-'); return tierSwitchNames.includes(a) ? a : ''; };
  // An argument as the engine's parser cuts it: words and the spaces between them, alternately (a word first, maybe empty).
  // A space is what the parser takes for one (isspace, not any Unicode space), outside quotes
  const pieces = (arg) => {
    const s = String(arg);
    if (s.includes(' ') && !s.includes('"')) return [s];   // LaunchWasm.cpp quotes it whole: one word, never a tier switch
    const out = [''];
    let quoted = false;
    for (const c of s) {
      const space = !quoted && ' \t\n\v\f\r'.includes(c);
      if (space !== ((out.length - 1) % 2 === 1)) out.push('');
      out[out.length - 1] += c;
      if (c === '"') quoted = !quoted;
    }
    return out;
  };
  const words = (arg) => pieces(arg).filter((w, i) => i % 2 === 0 && w !== '');
  const tierSwitches = (args) => new Set((Array.isArray(args) ? args : []).flatMap(words).map(tierSwitch).filter(Boolean));
  // A start that asks for a tier above forward by its switches (the RHI's precedence: -WebGPUSM5, else -WebGPUMobileDeferred
  // without -WebGPUNoMobileDeferred, which wins); a start without one runs whatever the RHI picks
  const asksUpperTier = (args) => { const s = tierSwitches(args); return s.has('-webgpusm5') || (s.has('-webgpumobiledeferred') && !s.has('-webgpunomobiledeferred')); };
  // UE-414087: after this tab's GPU fallback the start runs forward, so a tier switch from outside the pick's own (tierArgs: a
  // link's ?args= on a stage whose ue-query-args is all, the staged command line, ue-args, window.ueExtraArgs, a staged
  // wasm-bench.js) is dropped: off Linux the RHI lets -WebGPUSM5 win over the pick's -WebGPUNoSM5, so the start ran desktop
  // again while the toast said forward. Without a fallback the list is returned as it is (a test run's ?args=-WebGPUSM5 stands).
  // where names the source in the PAGE ARGS line; empty: no line (a second read of the same list)
  // Only the two that raise the tier are dropped: -WebGPUNoSM5 and -WebGPUNoMobileDeferred only hold the start at forward, so
  // they stay (a start whose pick failed then still runs forward). A single argument (a string ueExtraArgs) is a list of one
  function dropTierSwitches(args, where) {
    const list = Array.isArray(args) ? args : args == null ? [] : [args];
    if (!gpuFallback()) return list;
    const raises = (w) => tierSwitch(w) === '-webgpusm5' || tierSwitch(w) === '-webgpumobiledeferred';
    const dropped = list.flatMap(words).filter(raises);
    if (!dropped.length) return list;
    if (where) console.log('PAGE ARGS dropped ' + dropped.join(' ') + ' (' + where + '): this tab runs the forward renderer after its GPU fallback');
    // the word goes, with one space character before it (after it, at the start), not the argument around it, whose other
    // words and spacing stay
    const without = (a) => {
      const parts = pieces(a);
      const kept = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1 || !raises(parts[i])) { kept.push(parts[i]); continue; }
        if (kept.length) kept.push(kept.pop().slice(1)); else if (i + 1 < parts.length) parts[i + 1] = parts[i + 1].slice(1);
      }
      return kept.join('');
    };
    return list.map((a) => (words(a).some(raises) ? without(a) : a)).filter((a) => a !== '');
  }
  // The renderer a start runs, from its tier switches (tierArgs). A start without them (?compat=1, a harness run without ?tier=)
  // runs the project's own tier, which the engine starts by itself: desktop or deferred when the stage has it, else forward.
  // -WebGPUNoSM5 alone says forward only on a stage without the deferred tier (an older page's forward start). The switches are
  // read in the WebGPU RHI's order (WebGPUDevice.cpp, FParse::Param: any case, - or /): the desktop tier first (-WebGPUSM5, else the
  // project's desktop tier unless -WebGPUNoSM5), then -WebGPUNoMobileDeferred over -WebGPUMobileDeferred. As in the RHI, a tier
  // runs only where the stage has it (once wasm-tiers.json is read) and the adapter meets its requirements (tierShortfall);
  // a desktop tier that does not run leaves the choice to the deferred switches, a deferred tier that does not run gives forward
  function runningTier(args) {
    const given = tierSwitches(args);
    const has = stageHas(stageNow);
    const known = !!stageNow && !stageNow.unread;
    // (a Linux browser, as in the RHI: the desktop tier only for the link's -WebGPUSM5, and not once the start passes
    // -WebGPUNoSM5, which wins there: the page's mobile pick holds against the link's switch)
    const linuxNoDesktop = noLinuxDesktop() || (onLinux() && given.has('-webgpunosm5'));
    // (a texture set's restriction holds even with the tiers unknown: "@nodesktop" never runs the desktop tier, "@mobile" only
    // forward; stageHas, startArgs)
    const runs = (tier) => !setMobileOnly && !(tier === 'desktop' && (setNoDesktop || linuxNoDesktop)) && (!known || has[tier === 'desktop' ? 'sm5' : 'deferred'])
      && !tierShortfall(tier, adapterNow, stageNow).length;
    if ((given.has('-webgpusm5') || (has.sm5 && !given.has('-webgpunosm5'))) && runs('desktop')) return 'desktop';
    if (given.has('-webgpunomobiledeferred')) return 'forward';
    if (given.has('-webgpumobiledeferred')) return runs('deferred') ? 'deferred' : 'forward';
    return has.deferred && runs('deferred') ? 'deferred' : 'forward';
  }
  // A tier id from the link or the menu: forward, deferred, desktop, or '' (mobile is forward's old name)
  const tierId = (t) => { const v = String(t || '').toLowerCase(); return v === 'mobile' ? 'forward' : ['forward', 'deferred', 'desktop'].includes(v) ? v : ''; };
  // A phone or a tablet: the forward renderer, without the GPU check
  const handheld = () => { const b = browser(); return b.os === 'Android' || b.os === 'iOS'; };
  // Storage keys of this project's page (two projects on one host keep their own choices)
  const storageKey = (name) => 'ue.' + ((document.querySelector('meta[name=ue-project]') || {}).content || 'game') + '.' + name;
  // This tab fell back to the forward renderer after a GPU failure on the deferred or desktop one (wasm-play.js
  // ueOnWebGPUPipelineFailed, ueOnWebGPUDeviceLost and ueOnWebGPUOutOfMemory, sessionStorage for this tab only): the pick
  // follows it, whatever the menu or the link asks, so it cannot loop
  function gpuFallback() {
    try { return JSON.parse(sessionStorage.getItem(storageKey('gpuFallback')) || 'null'); } catch (e) { return null; }
  }
  // The link's or the menu's tier (?tier= first)
  function chosenTier() {
    let choice = tierId(query.get('tier'));
    if (!choice) { try { choice = tierId(localStorage.getItem(storageKey('renderer'))); } catch (e) { choice = ''; } }
    return choice;
  }
  // This tab's GPU fallback, as a pick's reason
  const fallbackWhy = (fell) => 'switched to the forward renderer for this session (' + (fell.why === 'device-lost' ? 'the graphics device was lost' : fell.why === 'gpu-out-of-memory' ? 'the graphics device ran out of memory'
    : "this GPU couldn't build " + (fell.entry || 'a pipeline')) + ')';
  // An explicit tier choice (?tier= or the game menu) resolved to the tier that runs, for both the player's pick (pickTier) and a
  // harness start (harnessTierArgs). The rules apply in order and each one that lowers the tier adds its reason: this tab's GPU
  // fallback; the desktop tier missing from the stage or the texture set ("@nodesktop", stageHas), or the GPU short of it
  // (desktopMissing: the page's features and the RHI's requirements for a pick, the RHI's requirements alone for a harness start);
  // Firefox, which falls from desktop to forward, not deferred; the deferred tier missing from the stage, or the GPU short of
  // its requirements (tierShortfall), where the RHI runs forward. With the stage's tiers unknown (unread), a harness start
  // keeps a desktop ask (a "@nodesktop" set's runs forward, as does one in a Linux browser without the link's -WebGPUSM5, which
  // the RHI would take for the test's ask) and a deferred ask runs forward, as before. Returns { tier, why }; label is the reason when nothing lowers it
  function resolveChoice(choice, { adapter, stage, desktopMissing, label, keepUnknown }) {
    const { sm5, deferred } = stageHas(stage);
    const unknown = keepUnknown && !!stage && !!stage.unread;
    const fell = gpuFallback();
    if (choice !== 'forward' && fell) return { tier: 'forward', why: fallbackWhy(fell) };
    if (choice === 'forward') return { tier: 'forward', why: label };
    // (as before this rule set: an unknown stage keeps a desktop ask, the RHI deciding, and reads as having no deferred tier)
    if (unknown && choice === 'desktop') {
      const refused = setNoDesktop ? 'this texture set has no desktop renderer' : noLinuxDesktop() ? 'the desktop renderer does not run in a Linux browser' : '';
      return refused ? { tier: 'forward', why: refused + ', and the stage\'s tiers are unknown' } : { tier: choice, why: label };
    }
    if (unknown) return { tier: 'forward', why: 'the stage\'s tiers are unknown (wasm-tiers.json could not be read)' };
    const causes = [];
    let want = choice;
    if (want === 'desktop') {
      if (!sm5) causes.push(noLinuxDesktop() ? 'the desktop renderer does not run in a Linux browser' : 'this build has no desktop renderer' + (setNoDesktop ? ' for this texture set' : ''));
      else if (desktopMissing.length) causes.push('the GPU lacks the desktop renderer\'s ' + desktopMissing.join(', '));
      if (!causes.length) return { tier: 'desktop', why: label };
      if (browser().name === 'Firefox') {
        if (deferred) causes.push('the deferred renderer is not validated in Firefox');
        return { tier: 'forward', why: causes.join('; ') };
      }
      want = 'deferred';
    }
    const deferredShort = tierShortfall('deferred', adapter, stage);
    if (!deferred) causes.push('this build has no deferred renderer');
    else if (deferredShort.length) causes.push('the GPU lacks the deferred renderer\'s ' + deferredShort.join(', '));
    else return { tier: 'deferred', why: causes.length ? causes.join('; ') : label };
    return { tier: 'forward', why: causes.join('; ') };
  }
  function pickTier(adapter, ms, stage) {
    // the desktop tier: the page's features and the RHI's requirements (tierShortfall)
    const missing = adapter ? [...new Set(desktopFeatures.filter(f => !adapter.features.includes(f)).concat(tierShortfall('desktop', adapter, stage)))] : desktopFeatures;
    const { sm5, deferred } = stageHas(stage);
    const choice = chosenTier();
    const mobileStep = ms > 0 ? mobileTiers.find(t => ms <= t.ms) : null;
    const forward = (why) => ({ tier: 'forward', preset: mobileStep ? mobileStep.preset : null, why });
    // every deferred pick: where the adapter falls short of the deferred tier's requirements the RHI runs forward, so the page picks it
    const deferredShort = tierShortfall('deferred', adapter, stage);
    const deferredTier = (why) => (deferredShort.length ? forward(why + '; the GPU lacks the deferred renderer\'s ' + deferredShort.join(', '))
      : { tier: 'deferred', preset: mobileStep ? mobileStep.preset : null, why });
    const desktop = (why) => ({ tier: 'desktop', preset: (desktopTiers.find(t => ms <= t.ms) || desktopTiers[desktopTiers.length - 1]).preset, why });
    if (!sm5 && !deferred) return forward('this build has the forward renderer only');
    const fell = gpuFallback();
    if (fell) return forward(fallbackWhy(fell));
    if (choice) {
      const got = resolveChoice(choice, { adapter, stage, desktopMissing: missing, label: 'chosen in the menu' });
      return got.tier === 'desktop' ? desktop(got.why) : got.tier === 'deferred' ? { tier: 'deferred', preset: mobileStep ? mobileStep.preset : null, why: got.why } : forward(got.why);
    }
    const firefox = browser().name === 'Firefox';
    if (handheld()) return forward('a phone or tablet');
    if (defaultTier === 'forward') return forward('the forward renderer by default (ue-default-tier; another tier on ?tier= or the menu)');
    // Firefox stays on forward until the deferred tier is validated there (it drew the level black on mobile deferred); ?tier=
    // and the menu still choose another tier
    if (firefox && deferred) return forward('Firefox: the forward renderer until the deferred one is validated there (?tier=deferred or the menu still chooses it)');
    if (!deferred && missing.length) return forward('the GPU has no ' + missing.join(', '));
    if (!(ms > 0)) return forward('no GPU timing');
    if (!desktopTiers.some(t => ms <= t.ms)) return { ...forward('a GPU below the ' + (deferred ? 'deferred' : 'desktop') + ' tier\'s class'), byTiming: (sm5 && !missing.length && defaultTier === 'auto') || (deferred && !deferredShort.length) };
    if (sm5 && !missing.length && defaultTier === 'auto') return desktop('GPU class');
    if (deferred) return deferredTier('GPU class' + (sm5 && missing.length ? ' (the GPU has no ' + missing.join(', ') + ')' : ''));
    return forward('the desktop tier only on ?tier=desktop or the menu (ue-default-tier)');
  }

  // The start arguments from the GPU check (the loader appends them before the game starts): -WebScreenPercentage=NN, the
  // tier's switches (tierArgs) and -WebQualityPreset=.
  // The check (a second WebGPU device, 0.5-3 s) runs only where its result is read: for the tier pick when the
  // stage has more than one tier (wasm-tiers.json) and the device is no phone or tablet, and for the starting resolution only
  // with <meta name="ue-gpucheck" content="1">
  // or ?gpucheck=1 (the 6 ms budget below was fitted to one game's scene). The check runs on a first visit only, started with the adapter probe so it overlaps the downloads;
  // the pick is kept in localStorage and passed again on later visits (a visit whose kept timing alone holds a GPU off the
  // desktop tier checks again and keeps the faster reading; the game applies the resolution and the preset at each start
  // until the player has chosen other scalability settings). Harness runs keep the default unless ?gpucheck=1; ?sp=NN forces a
  // value. pick() describes the result for the loading screen's step
  let started = null;
  let picked = { source: 'none' };
  // The stored check's version: 2 from UE-411822 on (gpuBench rejects stale timestamps; the record names its timer). A record
  // without it, kept on an adapter with timestamp-query, was timed by unchecked timestamps, so it is checked once again
  const checkVersion = 2;
  // Every pick names its tier in full, since the engine starts a tier by itself when the project targets it
  // (bTargetDesktopTier, bTargetMobileDeferredTier, WebGPUDevice.cpp): without -WebGPUNoSM5 a mobile pick on a two-tier stage
  // still ran SM5 (?tier=mobile logged "-WebGPUSM5: the desktop tier runs"). Forward: -WebGPUNoMobileDeferred -WebGPUNoSM5;
  // deferred: -WebGPUMobileDeferred -WebGPUNoSM5; desktop: -WebGPUSM5, plus -WebGPUNoMobileDeferred on a stage with the deferred
  // tier (where the RHI's limits keep it on ES3_1, it runs forward), so on such a stage every start passes one of the two
  // deferred switches
  // The page's pick of a mobile tier, forward or deferred, starts the engine with 2 task-graph workers (-WebWorkerThreads=2),
  // on every device; without it the engine runs clamp(cores - 4, 2, 12) (WasmPlatformMisc.cpp), and its Workers see the host's
  // core count: 12 on a large desktop. Each worker thread keeps its own task-graph and allocator state in the wasm heap. The cap
  // used to be on the forward pick only, so a desktop on the deferred tier ran 12 workers: in Lyra at 64 CPUs its heap top was
  // 28-38 MB and its heap in use 32-38 MB larger than with 2 workers, at the same frame rate and READY (at 8 CPUs the engine's
  // count is 4, at 4 CPUs it is 2 already).
  // On phones fewer threads also means fewer Workers, each with its own instance of the module (Lyra, iPhone emulation: 37 -> 23
  // Workers, renderer memory in the match -377 MiB, READY 0.7 s sooner); the desktop pthread pool is still sized from the core
  // count (WasmTargetRules.cs), so there the pool's Workers stay. Every start where the page passes a mobile tier's switches
  // carries the cap: its pick, a forward-only texture set, a GPU fallback, and a harness run (with ?tier=, or without it on a
  // stage where runningTier, the tier the RHI runs on this adapter, is a mobile one, as players do). The desktop pick keeps the
  // engine's count (also where the RHI then keeps it on ES3_1), as does a harness run without ?tier= where runningTier is the
  // desktop tier or the tiers are unknown. The cap goes with the page's choice of tier, as the forward cap always did, so tier switches
  // named elsewhere on the command line do not change it. ?threads=all keeps the engine's count; a count the page's own
  // arguments (Page Args ue-args on every device class, or a <meta name="ue-args-desktop"> in the project's own index.html
  // for desktops only) or a staged wasm-bench.js name replaces it (wasm-loader.js)
  const mobileThreadArgs = () => (query.get('threads') === 'all' ? [] : ['-WebWorkerThreads=2']);
  // a phone or tablet (deviceClass) gets the cap on every tier, so the pthread pool its class is sized for holds
  const workerCap = (tier) => (tier !== 'desktop' || deviceClass() !== 'desktop' ? mobileThreadArgs() : []);
  const forwardArgs = () => ['-WebGPUNoMobileDeferred', '-WebGPUNoSM5'];
  function tierArgs(t, stage) {
    const preset = t.preset ? ['-WebQualityPreset=' + t.preset] : [];
    // -WebGPUNoMobileDeferred on every desktop start: where the RHI's limits keep it on ES3_1 it runs forward, never a deferred
    // tier the project targets but the stage may lack the shaders for
    if (t.tier === 'desktop') return ['-WebGPUSM5', '-WebGPUNoMobileDeferred'].concat(preset, workerCap('desktop'));
    if (t.tier === 'deferred') return ['-WebGPUMobileDeferred', '-WebGPUNoSM5'].concat(preset, workerCap('deferred'));
    return forwardArgs().concat(preset, workerCap('forward'));
  }
  // Harness runs skip the GPU check but keep an explicit ?tier= (the play fixture's tier arms), within the stage's tiers and
  // this tab's GPU fallback; without ?tier= the tier is the project's (the engine's own start)
  async function harnessTierArgs() {
    const choice = tierId(query.get('tier'));
    // no ?tier=: the project's own tier, except after this tab's GPU fallback (forward, so a failing tier is not started again).
    // Where runningTier (the tier the RHI runs on this adapter: the stage's tiers and their requirements) is a mobile one, it
    // gets their worker cap; where it is the desktop tier, or the tiers are unknown, the engine's count. A "@nodesktop"
    // texture set keeps the RHI off the desktop tier, whose loose files are the other set's
    // (the adapter, which the loader asked for already, so runningTier and the requirements below know it: tierShortfall)
    const { adapter } = await probe().catch(() => ({ adapter: null }));
    if (!choice) {
      const own = await tiers();
      if (gpuFallback()) return forwardArgs().concat(workerCap('forward'));
      // the cap follows the tier the RHI runs on this adapter (runningTier: the desktop tier only where the adapter meets it). On a
      // desktop-tier stage whose adapter falls short of it, -WebGPUNoSM5 too, so the engine's start, which reads the switches
      // before the RHI, prepares a mobile tier, as the RHI then runs (the project's own mobile tier still decides deferred)
      const short = !setNoDesktop && !own.unread && stageHas(own).sm5 && runningTier([]) !== 'desktop';
      const switches = setNoDesktop || short ? ['-WebGPUNoSM5'] : [];
      return switches.concat(workerCap((own.unread || runningTier(switches) === 'desktop') && !setNoDesktop ? 'desktop' : 'deferred'));
    }
    const stage = await tiers();
    // ?tier= as the player's pick resolves it (resolveChoice), with the RHI's requirements alone for the desktop tier (a harness
    // asks for the tier, not for the page's GPU class): ?tier=desktop on a stage or texture set ("@nodesktop") without the desktop
    // tier, or on an adapter short of it, runs deferred where the stage has it, outside Firefox, else forward; ?tier=deferred on an
    // adapter short of the deferred tier runs forward, as the RHI would; with the tiers unknown a desktop ask stands (forward for a "@nodesktop" set) and a deferred ask runs
    // forward, as before
    const { tier, why } = resolveChoice(choice, { adapter, stage, desktopMissing: tierShortfall('desktop', adapter, stage), label: '?tier=' + query.get('tier'), keepUnknown: true });
    picked = { ...picked, tier, why };
    if (tier !== choice) console.log('WEB_TIER ' + JSON.stringify(picked));
    return tierArgs({ tier }, stage);
  }
  // A stage cooked with ASTC textures (ue-texture-formats names texture-compression-astc) passes -WebGPUASTC: the RHI asks for
  // ASTC by itself only on an adapter without BC, so on one with both (iPhones, Apple silicon Macs) every ASTC texture had
  // a format the device lacked. A page with texture sets leaves it to the loader, which adds it for the chosen set only
  function textureArgs(args) {
    const list = args || [];
    if (textureSets.length) return list;
    return policy.textureFormats.includes('texture-compression-astc') && !list.includes('-WebGPUASTC') ? list.concat(['-WebGPUASTC']) : list;
  }
  function startArgs() {
    if (started) return started;
    started = (async () => {
      const forcedSp = Number(query.get('sp'));
      const forced = forcedSp >= 50 && forcedSp <= 200 ? forcedSp : null;
      const benchMode = !!query.get('bench');
      // the compatibility report's start: the project's own tier, except after this tab's GPU fallback (forward); the stage's
      // tiers are read first so wasm-play.js runningTier knows the tier a start without switches runs
      // A texture set's restriction ("@mobile", "@nodesktop"): the set's files leave out the other set's loose desktop- or deferred-tier
      // files (UAT AddTextureSet tags them with the other set), so the RHI cannot run that tier for it on any command line; the
      // switches passed here, on every start path, keep the pick and the prefetch on the tiers the set runs
      const set = textureSets.length ? await textureSet() : null;
      if (set && set.noDesktop) setNoDesktop = true;
      if (set && set.mobileOnly) setMobileOnly = true;
      if (query.get('compat') === '1') {
        // (the adapter too, for runningTier's requirements: tierShortfall)
        await Promise.all([tiers(), probe().catch(() => null)]);
        return gpuFallback() || (set && set.mobileOnly) ? forwardArgs() : setNoDesktop ? ['-WebGPUNoSM5'] : [];
      }
      if (set && set.mobileOnly) {
        picked = { source: forced ? 'forced' : 'none', screen_percentage: forced, tier: 'forward', why: 'the ' + set.name + ' texture set has the forward renderer only' };
        console.log('WEB_TIER ' + JSON.stringify(picked));
        return (forced ? ['-WebScreenPercentage=' + forced] : []).concat(forwardArgs(), workerCap('forward'));
      }
      if (query.get('harness') === '1' && query.get('gpucheck') !== '1' && !benchMode) {
        if (forced) { picked = { source: 'forced', screen_percentage: forced }; return ['-WebScreenPercentage=' + forced].concat(await harnessTierArgs()); }
        return harnessTierArgs();
      }
      // ?sp=NN and ?bench= set the resolution only; the tier is still picked (a desktop machine keeps the desktop
      // renderer, and the bench measures the tier a player gets). The bench runs fresh each time (no stored value)
      const stage = await tiers();
      const { sm5, deferred } = stageHas(stage);
      const resolution = benchMode || query.get('gpucheck') === '1' || (document.querySelector('meta[name=ue-gpucheck]') || {}).content === '1';
      const spArgs = (sp) => (forced ? ['-WebScreenPercentage=' + forced] : resolution && sp ? ['-WebScreenPercentage=' + sp] : []);
      // No GPU check where nothing reads it: a forward-only stage, a tab after its GPU fallback, and a phone or tablet that asks
      // for no other tier (forward)
      const asked = chosenTier();
      if (!resolution && (!(sm5 || deferred) || gpuFallback() || (handheld() && (!asked || asked === 'forward')))) {
        const tier = pickTier(null, 0, stage);
        picked = { source: forced ? 'forced' : 'none', ...(forced ? { screen_percentage: forced } : {}), ...tier };
        if (sm5 || deferred) console.log('WEB_TIER ' + JSON.stringify(picked));
        return spArgs(null).concat(tierArgs(tier, stage));
      }
      let stored = null;
      if (!benchMode) { try { stored = JSON.parse(localStorage.getItem(storageKey('gpucheck')) || 'null'); } catch (e) { stored = null; } }
      const gpu = await probe();
      let fresh = null;
      if (stored && stored.ms && !(stored.version >= checkVersion) && !gpu.message && gpu.adapter && gpu.adapter.features.includes('timestamp-query')) {
        fresh = await gpuBench();
        // (the faster of the two readings is kept, as the recheck below keeps its faster one: a busy GPU reads slower)
        if (fresh && fresh.ms > 0 && fresh.ms <= stored.ms) {
          stored = { screen_percentage: pickScreenPercentage(fresh, true) || stored.screen_percentage, ms: fresh.ms, at: Date.now(), version: checkVersion, timer: fresh.timer };
          try { localStorage.setItem(storageKey('gpucheck'), JSON.stringify(stored)); } catch (e) { /* private window */ }
        } else if (fresh && fresh.ms > 0) {
          stored = { ...stored, at: Date.now(), version: checkVersion };
          try { localStorage.setItem(storageKey('gpucheck'), JSON.stringify(stored)); } catch (e) { /* private window */ }
        }
      }
      if (stored && stored.ms) {
        let ms = stored.ms;
        let tier = pickTier(gpu.adapter, ms, stage);
        // One slow reading (the first check overlaps the downloads, and a busy GPU reads slower) must not keep a GPU off the
        // desktop tier on every later visit: when only the stored timing keeps it off, check again and keep the faster reading
        // (the recheck reads its fastest sample too, benchMs; a reading stored before that rule was a median)
        let recheck = fresh;
        let keptSp = stored.screen_percentage;
        if (tier.byTiming && !gpu.message) {
          recheck = await gpuBench();
          if (recheck && recheck.ms > 0 && recheck.ms < ms) {
            ms = recheck.ms;
            tier = pickTier(gpu.adapter, ms, stage);
            // the resolution follows the faster reading too (the stored one was picked from the slower timing)
            keptSp = pickScreenPercentage(recheck) || keptSp;
            try { localStorage.setItem(storageKey('gpucheck'), JSON.stringify({ ...stored, ms, screen_percentage: keptSp, at: Date.now() })); } catch (e) { /* private window */ }
          }
        }
        // with a resolution floor the start is picked again from the kept ms, so a start kept under the floor moves up
        const timed = !!gpu.adapter && gpu.adapter.features.includes('timestamp-query');
        const kept = timedFloor > 0 ? pickScreenPercentage({ ms }, timed) || keptSp : keptSp;
        picked = { source: forced ? 'forced' : 'stored', ms, stored_ms: stored.ms, recheck, screen_percentage: forced || (resolution ? kept : null), ...tier };
        console.log('WEB_TIER ' + JSON.stringify(picked));
        return spArgs(kept).concat(tierArgs(tier, stage));
      }
      if (gpu.message) return spArgs(null).concat(forwardArgs());
      const bench = await gpuBench();
      const sp = pickScreenPercentage(bench);
      const tier = pickTier(gpu.adapter, bench && bench.ms, stage);
      picked = { source: forced ? 'forced' : 'measured', bench, ms: bench && bench.ms, screen_percentage: forced || (resolution ? sp : null), ...tier };
      console.log('WEB_GPU_CHECK ' + JSON.stringify({ bench, screen_percentage: sp, tier }));
      console.log('WEB_TIER ' + JSON.stringify(picked));
      if (sp && !benchMode && !forced) {
        try { localStorage.setItem(storageKey('gpucheck'), JSON.stringify({ screen_percentage: sp, ms: bench.ms, at: Date.now(), version: checkVersion, timer: bench.timer })); } catch (e) { /* private window */ }
      }
      return spArgs(sp).concat(tierArgs(tier, stage));
    })().then((args) => textureArgs(args));
    return started;
  }
  function pick() { return picked; }

  // The texture set the adapter plays ({ name, features }), once probe() has the adapter; null when the stage has one set or
  // the adapter fits none (probe's message says why)
  function textureSet() { probe(); return setChosen; }
  function hasTextureSets() { return textureSets.length > 0; }

  // Every browser but Chrome gets a line that says to try Chrome (no other browser is named); Firefox also hears why (it
  // compiles one WebGPU pipeline at a time). The game's name is the page title. The text is a project setting, shown as
  // before. The built-in line is not shown on Apple devices: on iOS and iPadOS every browser is WebKit (Chrome there
  // reports CriOS and runs like Safari), and on a Mac every browser plays the mobile tiers
  function advice() {
    const b = browser();
    const name = b.name;
    // (no other browser on iOS, where every browser runs on WebKit: not even a project's own advice)
    if (b.os === 'iOS' || policy.browserAdvice === 'none') return null;
    const game = document.title && !document.title.includes('%') ? document.title : 'This game';
    // Chromium browsers on a Mac: no built-in line. The RHI runs the mobile tiers there (10 storage buffers per stage, short of
    // the desktop tier's 16), which is the tier Safari plays too, so no other browser on a Mac plays better
    if (b.os === 'macOS' && (name === 'Chrome' || name === 'Chromium' || name === 'Edge')) {
      return name === 'Chrome' ? null : (policy.browserAdvice || null);   // a project's own advice, as before
    }
    if (name === 'Chrome') return null;
    if (policy.browserAdvice) return policy.browserAdvice;
    // The built-in line is not shown on Apple devices: there Chrome is no better (see above)
    if (b.os === 'iOS' || b.os === 'macOS') return null;
    return name === 'Firefox'
      ? game + ' plays much better in Chrome: try it there. Firefox compiles its shaders one at a time, so this first start takes longer.'
      : game + ' plays best in Chrome: try it there.';
  }

  // Everything, for the bench page and ?compat=1
  async function report() {
    const t = tests();
    const gpu = await probe();
    const b = browser();
    const pass = t.every(x => x.pass) && !gpu.message;
    // The GPU check only where asked for (?compat=1, the bench page, ?gpucheck=1): harness runs log report() at start-up, and a
    // second device's 0.5-3 s of load there would move their start-up timings
    const wanted = query.get('compat') === '1' || !!query.get('bench') || query.get('gpucheck') === '1';
    const bench = pass && wanted ? await gpuBench() : null;
    return {
      version: 1, pass,
      reason: t.find(x => !x.pass)?.message || gpu.message || null,
      browser: b,
      cpus: navigator.hardwareConcurrency || null,
      device_memory_gb: navigator.deviceMemory || null,
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio || 1 },
      tests: Object.fromEntries(t.map(x => [x.id, x.pass])),
      adapter: gpu.adapter,
      ...(gpu.rendering ? { rendering: gpu.rendering } : {}),
      gpu_bench: bench,
      screen_percentage: pickScreenPercentage(bench),
      warnings: warnings(gpu.adapter),
    };
  }

  // Threading and sound by device class, from the project settings (UWasmTargetSettings: IOSThreadingMode, bIOSEnableSound,
  // IOSPthreadPoolSize and the Android and Desktop ones), which UAT writes as <meta name="ue-threads-ios"> (single | threaded),
  // <meta name="ue-sound-ios"> (1 | 0) and <meta name="ue-pool-ios"> (pthread pool size, 0: automatic), -android and -desktop
  // alike. A page without them gets the template's defaults: iOS single-threaded (WebKit copies the module's data and table into
  // every pthread and the tab's memory limit allows few) with sound, Android and desktop threaded with sound. The class is the
  // device profile's (wasm-profile.js: iOS includes iPadOS, which asks for desktop
  // pages as a Mac with touch; ?profile=ios tries iOS on a desktop). Single-threaded, the engine runs its mixer on the game
  // thread, so sound can stutter on shader compiles and long frames.
  // Link overrides: ?threads=1 (threaded; on a single-threaded class it lifts the whole profile as it always did, sound too,
  // unless ?sound=0; refused on iOS, below), ?threads=force (?threads=1 on iOS too), ?threads=0 (single-threaded) and
  // ?sound=1|0. ?threads=all is the mobile tiers' Worker count (above), not this.
  // The result: the engine switches (-nothreading, -nosound) and the pthread pool size for the game script's PTHREAD_POOL_SIZE
  // expression (WasmTargetRules.cs PthreadPoolSize reads globalThis.ueProfile.poolSize first): the class's pool override, else a
  // size only where the choice differs from what the expression assumes from the user agent and ?threads=1 (iOS 1, or 3 with
  // ?threads=1; Android 24; desktop W+27): 1 single-threaded off iOS or on an iOS that refused ?threads=1 (2 with the audio
  // thread), 3 on a threaded iOS without ?threads=1; else null (the expression decides)
  const classDefaults = { ios: { threads: 'single', sound: '1' }, android: { threads: 'threaded', sound: '1' }, desktop: { threads: 'threaded', sound: '1' } };
  const appleTouchUa = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  function deviceClass() {
    const profile = window.ueProfile;
    if (profile && Object.prototype.hasOwnProperty.call(classDefaults, profile.name)) return profile.name;
    if (appleTouchUa()) return 'ios';
    return /Android/.test(navigator.userAgent) ? 'android' : 'desktop';
  }
  function threading() {
    const cls = deviceClass();
    const setThreads = setting('ue-threads-' + cls, classDefaults[cls].threads) === 'single' ? 'single' : 'threaded';
    const setSound = setting('ue-sound-' + cls, classDefaults[cls].sound) !== '0';
    const linkThreads = query.get('threads');
    const linkSound = query.get('sound');
    // UE-411514: ?threads=1 does not lift an iOS page the project keeps single-threaded. The threaded engine starts 3 pool Workers
    // and then a Worker per thread past the pool, 22 in all on the mobile tier (32 on the desktop tier), each with its own instance
    // of the module (WebKit: a copy of its 360k-entry function table and data each), against a tab that dies at about 7 (Safari
    // reloads it, "A problem repeatedly occurred", with no console line); single-threaded starts 2. The page says so and runs
    // single-threaded. ?threads=force still starts it threaded (to test it on an iPhone); a project set threaded on iOS
    // (ue-threads-ios) keeps its setting
    const iosRefused = cls === 'ios' && linkThreads === '1' && setThreads === 'single';
    const linkThreaded = linkThreads === 'force' || (linkThreads === '1' && !iosRefused);
    const threads = linkThreaded ? 'threaded' : linkThreads === '0' ? 'single' : setThreads;
    const liftedSound = linkThreaded && setThreads === 'single';
    // Single-threaded, the device profile's audio thread (wasm-profile.js audioThread; iOS only; the order of its inputs is in
    // Docs/PageContract.md, ue-audio-thread: ?audiothread=1|0, else <meta name="ue-audio-thread"> from bSingleThreadedAudioThread
    // or the profile's audio=thread, those two only with <meta name="ue-audio-thread-ios26"> 1 on WebKit 26 or earlier)
    // renders and plays the sound on one pthread of its own (-WebAudioThread, AudioMixerWebAudio.cpp)
    // instead of the game thread, so it plays on through long frames. It applies only where there is sound (the project's sound
    // setting, ?sound=1, or an explicit ?audiothread=1, which turns the sound on); ?sound=0 still turns it off. Sound without it on
    // a single-threaded engine is the game thread's mixer, and the page always says so (-NoWebAudioThread), since the engine's own
    // setting (bSingleThreadedAudioThread) is on by default. On iOS why.audioThread names what decided: wasm-profile.js's audioWhy,
    // or ?sound=0 or sound (the sound setting) when the profile asked for it but there is no sound (Docs/PageContract.md lists them)
    const soundAsked = linkSound === '1' ? true : linkSound === '0' ? false : liftedSound ? true : setSound;
    const audioThread = threads === 'single' && !!(window.ueProfile && window.ueProfile.audioThread) && linkSound !== '0'
      && (soundAsked || query.get('audiothread') === '1');
    const sound = audioThread || soundAsked;
    const override = Math.min(128, Math.max(0, Math.floor(Number(setting('ue-pool-' + cls, '0')) || 0)));
    // what the expression picks without the page: an iOS user agent gets 1, or 3 with ?threads=1 (its own test of the link)
    const exprIos = appleTouchUa();
    const exprThreads1 = /[?&]threads=1(?![^&])/.test(location.search);
    // (a refused ?threads=1 is still in the link, where the expression would give its 3: the page gives the single-threaded pool)
    const pool = override > 0 ? override
      : threads === 'single' ? (!exprIos ? 1 + (audioThread ? 1 : 0) : exprThreads1 ? 1 + (audioThread ? 1 : 0) : null)   // (the expression adds the audio thread's itself)
      : exprIos && !exprThreads1 ? 3 : null;
    const args = (threads === 'single' ? ['-nothreading'] : []).concat(!sound ? ['-nosound'] : audioThread ? ['-WebAudioThread']
      : threads === 'single' ? ['-NoWebAudioThread'] : []);
    const from = (link, name) => (link === '1' || link === '0' || link === 'force' ? '?' + name + '=' + link : 'setting');
    return { class: cls, threads, sound, audioThread, pool, args, refused: iosRefused ? '?threads=1' : null,
      why: { threads: iosRefused ? 'setting (?threads=1 refused on ios)' : from(linkThreads, 'threads'),
        sound: linkSound === '1' || linkSound === '0' ? '?sound=' + linkSound : liftedSound ? '?threads=' + linkThreads : audioThread && !soundAsked ? '?audiothread=1' : 'setting',
        pool: override > 0 ? 'setting' : pool === null ? 'build' : threads === 'single' ? 'single-threaded' : 'threaded',
        ...(cls === 'ios' && threads === 'single' && window.ueProfile && window.ueProfile.audioWhy
          ? { audioThread: window.ueProfile.audioThread && !audioThread ? (linkSound === '0' ? '?sound=0' : 'sound') : window.ueProfile.audioWhy } : {}) } };
  }

  return { check, failed: () => failedId, fromDisk, probe, noAdapter: () => noAdapterSeen, report, warnings, browser, gpuBench, benchMs, pickScreenPercentage, startArgs, pick, pickTier, stageHas, runningTier, tierSwitches, asksUpperTier, dropTierSwitches, advice, policy, minAppleVersion, textureSet, hasTextureSets, deviceClass, threading };
})();

// ?bench=<kind>: a project that stages its own wasm-bench.js (the engine template has none) gets it loaded; the script sets
// window.ueBench.args (its UE arguments) and resolves window.ueBench.wait before the game starts
if (query.get('bench')) {
  window.ueBench = { kind: query.get('bench'), args: [] };
  window.ueBench.wait = new Promise((resolve) => { window.ueBench.resolve = resolve; });
  const element = document.createElement('script');
  element.src = 'wasm-bench.js';
  element.onerror = () => window.ueBench.resolve('This stage has no wasm-bench.js.');
  document.head.appendChild(element);
}

// ?compat=1: a report card in place of the game (it replaces the page; the loader stops at check()'s message)
if (query.get('compat') === '1') {
  window.ueCompatOnly = true;
  window.addEventListener('DOMContentLoaded', async () => {
    const r = await window.ueCompat.report();
    // Every interpolated value is escaped (the title, the reason and warnings carry project settings; the adapter
    // strings come from the browser)
    const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const rows = Object.entries(r.tests).map(([k, v]) => `<tr><td>${v ? 'pass' : 'FAIL'}</td><td>${h(k)}</td></tr>`).join('');
    const a = r.adapter;
    document.body.innerHTML = `<div class="card" style="margin:24px auto"><h1>Can this browser run ${h(document.title && !document.title.includes('%') ? document.title : 'this game')}?</h1>
      <p class="sub">${r.pass ? 'Yes.' : 'No: ' + h(r.reason)}</p>
      <p>${h(r.browser.name)} ${h(r.browser.version)} on ${h(r.browser.os)}; ${h(r.cpus)} logical CPUs${r.device_memory_gb ? ', ' + h(r.device_memory_gb) + ' GB' : ''}</p>
      <p>GPU: ${a ? h([a.vendor, a.architecture, a.device || a.description].filter(Boolean).join(' ') + (a.fallback ? ' (software)' : '') + (a.shader_compiler !== 'n/a' ? '; shader compiler ' + a.shader_compiler : '')) : 'none'}</p>
      ${r.gpu_bench && r.gpu_bench.ms ? `<p>GPU check: ${h(r.gpu_bench.ms)} ms per draw (${h(r.gpu_bench.mpix_per_ms)} Mpix/ms, ${h(r.gpu_bench.timer)}); starting resolution ${h(r.screen_percentage ?? 'the default')} %</p>` : ''}
      ${r.warnings.map(w => `<p style="color:var(--accent)">${h(w)}</p>`).join('')}
      <table>${rows}</table>
      <details><summary>Report (JSON)</summary><pre id="compat-json" style="white-space:pre-wrap;font-size:12px"></pre></details>
      <div class="row" style="margin-top:12px"><button id="compat-copy">Copy the report</button></div></div>`;
    document.body.style.overflow = 'auto';
    const json = JSON.stringify(r, null, 1);
    document.getElementById('compat-json').textContent = json;
    document.getElementById('compat-copy').onclick = () => navigator.clipboard.writeText(json);
    console.log('WEB_COMPAT ' + JSON.stringify(r));
  });
}

// Harness runs (?harness=1: run_page.py): the report once in the console, so every run records its browser and adapter
// (after the start gate, wasm-gate.js, which a harness run passes unless its link names ?startgate=)
if (query.get('harness') === '1') Promise.resolve(window.ueStartGate).then(() => window.ueCompat.report()).then(r => console.log('WEB_COMPAT ' + JSON.stringify(r)));
