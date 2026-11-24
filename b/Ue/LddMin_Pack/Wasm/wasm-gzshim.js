// Serves the game's WebAssembly module from its gzip sibling.
// GitHub Pages cannot send Content-Encoding and the raw module is larger than the
// site's per-file limit, so the page decompresses it here instead.
(() => {
  "use strict";
  const isWasm = /\.wasm$/i;
  const original = window.fetch ? window.fetch.bind(window) : null;
  if (!original || typeof DecompressionStream !== "function") return;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const q = url.indexOf("?");
    const path = q < 0 ? url : url.slice(0, q);
    if (!isWasm.test(path)) return original(input, init);

    const gz = path + ".gz" + (q < 0 ? "" : url.slice(q));
    const target = typeof input === "string" ? gz : new Request(gz, input);
    return original(target, init).then((response) => {
      if (!response.ok || !response.body) return original(input, init);
      return new Response(response.body.pipeThrough(new DecompressionStream("gzip")), {
        status: 200,
        headers: { "Content-Type": "application/wasm" }
      });
    });
  };
})();