// The page's own strings in other languages. A project replaces this file through its Build/Wasm/Template
// (or the engine adds languages here): one table per language tag, lower case, the English text as the key. The page picks
// navigator.language ("fr-ca"), then its first part ("fr"); a missing entry stays English. Keys are the exact English
// strings in index.html (data-i18n elements), wasm-play.js, wasm-gate.js and wasm-loader.js.
//   window.ueStrings.fr = { 'Downloading the game': 'Telechargement du jeu', 'Ready': 'Pret' };
// The error cards' texts are keys too (wasm-play.js errorCards, errorTitles), for example the card of a download the connection
// broke (kind 'network', UE-411928):
//   'The connection was lost.'
//   'The connection to the game server was lost while the game was downloading. Reload to continue the download.'
// A key with %s keeps it in its translation: the page fills it in after the lookup, in order (the stop card's file line,
// wasm-play.js fileProblemText: 'A file of the game is missing (or incomplete) on this site: %s. Upload it again.' gets the file's
// path and why, e.g. "MyGame/Content/Paks/pakchunk0-Wasm.ucas (HTTP 404)"; '%s of %s bytes' the bytes the host sent and the list's)
window.ueStrings = window.ueStrings || {};
