# Bokleser
## Ordne denne listen
## Kompletter denne listen
## Lyd ift lesing
## Avdekk funksjonalitet
# Funksjonalitet
## ASIS
Kartlagt fra `LdD.html` (struktur + all logikk i inline `<script>`, `nav`-objektet), `LdD.js` (`cBook` + kobling mot `books.book`/`books.map`) og `LdD.css`.
### Velg bok
Både i TOC og som parameter kan man velkge bok
- Tittel i TOC (`#_dTocTitle`) er lenke → `nav.Books()`: samme `#_dTocList` bytter fra kapittelliste til bokvelger (`dataset.bk='1'`), og tilbake igjen.
- Bokvelgeren leser `books` (publiserte PDF-er) og `book_versions` (lokaliserte navn) direkte fra Supabase; PDF-stien tas fra `books.deployed`, ikke gjettet.
- Hver bok får to rader (🇳🇴 og 🇬🇧) som dyp-lenker til `https://aigap.no/b?book=…&page=…&c=w,1000,nLg0|nLg1`.
- Valgt bok huskes i `localStorage` (`LdD.book`) og kan overstyres med `?book=<sti>`.
- Kapittel-TOC caches i `nav._tocHtml` og gjenopprettes når man går tilbake fra bokvelgeren.
### Vise boka
- PDF rendres med pdf.js 4.4.168 (cdnjs) til `#_cBook`; bare én side om gangen, og bare den delen av PDF-en som trengs (`disableStream`/`disableAutoFetch`, range-lesing).
- Sida rendres til et offscreen canvas og byttes inn i én paint (`_renderToken` hindrer at et eldre resultat overskriver et nyere).
- PDF-ens tekst brukes ikke til visning, bare til å viske ut skriftlag som ikke hører til utgaven (se Premium).
- Første side vises straks som JPEG-plakat (`<base>.jpg` i `#_iBook`) mens PDF-en parses i bakgrunnen; spinner (`aigap.webp`) forsvinner når plakaten er malt.
- Siste fire sider i PDF-en er mal og regnes ikke som boksider (`np() = numPages - 4`).
- Ikke-PDF-bøker (iframe/ekstern side) støttes via `books.book.s(false, src)` → `#_fBook`; da er lokal tekstsøk og PDF-funksjoner av.
- Lasting som feiler gir melding på canvas ("⚠️ Kunne ikke laste boken"), ikke krasj.
- Førstepaint blokkeres aldri av premium-sjekk eller PDF-parse.
### Bla og navigere
- Knapper: ⏮️ første (`nFt`), ◀️ forrige (`nPv`), ⏫ opp (`nUp`), 🔢 sidenummer (`nGo`+`nGoTxt`), ⏬ ned (`nDn`), ▶️ neste (`nNt`), ⏭️ siste (`nLt`).
- ⏫/⏬ scroller 75 % av bokas vindu; på topp/bunn bytter de side (⏫ lander nederst på forrige side).
- 🔢 gir et tallfelt (Enter eller change) → `nav.Page(n, 0)`; feltet lukkes etterpå.
- Sida lagres ved hvert sidebytte (`LdD.<bok>.page`), og `UpdButtons` deaktiverer knapper på første/siste side.
- Kantkontroller vises bare når de trengs: 🫲/☝️ øverst til høyre (`nUp2`/`nUp3`) og 🫱/👇 nederst til høyre (`nNt2`/`nNt3`); er hele arket synlig, er det alltid 🫲/🫱.
- Mus: horisontalt og *vedvarende* (|dx| > 2·|dy| i minst to hendelser) → sidebytte; loddrett og diagonal går til native scroll.
- Touch: aksen låses etter 80 px og 3× dominans, ellers native scroll gjennom hele gesten; swipe som startet på en flytende kontroll angres (`UndoTap`) slik at det touchen åpnet lukkes igjen.
- `GEST` er en tilstandsmaskin (none/busy/up/dn/left/right/pgup/pgdn) med én beslutning per gest; `pgup/pgdn` er definert men ikke i bruk.
- Tastatur: bare Enter (sidenummer) og Escape (søkefelt) – ingen piltaster.
### Sidetall og tilstand
- `#_dPage` viser sidenummeret på 25 % og 75 % (én per halvdel, så tallet blir stående midt), og også nederst når sida er høyere enn vinduet (landskap).
- Gjeldende gest-symbol settes på begge sider av tallet, og speiles fast midt på venstre/høyre kant (`#nStL`/`#nStR`).
### Layout og størrelse
- Dokumentet scroller aldri (`html,body{overflow:hidden}`); `#_dBook` er eneste scroll-container (`touch-action:pan-y`, `overscroll-behavior:contain`).
- Canvas/iframe er 2× sidebredde; `hAlign` viser venstre (NO) eller høyre (EN) halvdel.
- Størrelse regnes fra vinduet med gyldent snitt (`aRatio = 2·4.13/5.83`); `whole` = arket får plass i vinduet, og da sentreres det.
- Alle mål er `calc(vw+vh)`; stående skjerm (`max-aspect-ratio:1/1`) dobler topp-padding, og skjult meny fjerner den.
- Resize venter til vinduet er rolig (iOS) før re-render.
### Innholdsfortegnelse
- Bygges fra `.md`-sidecaren (via `books.map.book`), ikke fra PDF-tekst: `##` = kapittel, `###` = underkapittel, `#### p. N` = side, `🎵` = sang.
- `TocCur` markerer gjeldende kapittel med fet skrift uten å bygge lista på nytt.
- Hvert kapittel/underkapittel kan ha ♫ (Spotify) → `music.Tgl`; spillelista ligger også som fast Spotify-embed nederst i TOC.
- Engangs-hint for iOS om «Legg til på Hjem-skjermen» (`LdD.hsTip`), bare når ikke allerede standalone.
- Innholdet bygges én gang og caches; lukking av TOC fjerner et aktivt filter.
### Søk og filter
- Én boks (🔍 `nFd`) med tre funksjoner, valgt av kontekst: fritekstsøk i boka, filter i kapittellista, filter i bokvelgeren.
- Boktekst: indeks bygges fra sidecaren per side; søket går live mens man skriver og hopper til neste treff, backspace hopper tilbake til treffet for den kortere lengden, ⏶/⏷ blar i treffene (med wrap), Escape tømmer.
- Treffet sentreres vertikalt på sida når arket er høyere enn vinduet (anslag ut fra treffets plass i sideteksten).
- TOC-filter skjuler rader i stedet for å bygge ny liste (spilleren overlever); `_dTc2Txt` («Filter chapter content / sound») er en plassholder for senere.
- Bokvelger-filter: først treff på tittel; hvis ingen, bøker som har treff i et kapittel (sidecaren hentes og bufres per bok), med inntil 4 kapitlenavn under.
- Søk er slått av for iframe-bøker (ingen lokal tekst).
### Språk (NO/EN)
- 🇳🇴/🇬🇧 (`nLg`) bytter språk for hele leseopplevelsen og lagres per bok (`lang`).
- Sidecar-navn er `<base>_<NO|EN>_<PREM|FREE>.md` – språk × utgave.
- `hAlign` justerer arket mot venstre (NO) eller høyre (EN) halvdel av canvas.
- Språkbytte tømmer TOC-cachen; automatisk bytte ved horisontal scroll er fjernet (bare knappen).
- `nLg0`/`nLg1` er skjulte knapper som dyp-lenker bruker for å sette språk deterministisk.
### Premium (PIN) og freemium
- 🔓/👑 (`nPr`): 6-sifret PIN (`nPin`) sjekkes ved hvert tastetrykk (ingen Enter) mot Supabase-tabellen `codes` via `db.js` (`codeValid(code, boknavn)`, gyldighetsvindu dtfrom–dtto).
- Gyldig kode gir premium og lagres per bok (`LdD.<bok>.code`); ugyldig gir lesbar melding i 4 s (`nPinMsg`) og feltet åpnes for nytt forsøk.
- Premium slås av bare fra åpen meny; av = lagret kode slettes. Utenfor menyen vises 👑-knappen ikke.
- Bakgrunnssjekk hvert `premiumCheckInterval` sekund (Supabase, default 60) via `stillValid`: mistet rett (andre har tatt over) → freemium; teknisk feil → bli premium. `prem.Load()` går også i bakgrunnen ved oppstart.
- Låst tekstlag: skrift som hører til den andre utgaven viskes ut fra canvas (`Hide`); premium-tekst i freemium får gullstrøk. Kommentarfont (Arial) skjules alltid.
- Fontlistene er plassholdere: `premFonts ['EBGaramond','CEGaramond']`, `freeFonts ['Calibri']`, `commentFonts ['Arial']`.
- Eksport er premium-only.
### Dele (QR)
- 📲 (`nSh`) viser to QR-koder: «Book» (ren boklenke) og «Deep» (bok + side + posisjon), med avkrysning for bok/side/pos/TOC/en.
- Lenken er `https://aigap.no/b?book=…&page=…&c=w,1000,nLg0,nTc,s,<scrollY>`; QR lages med `qr-code-styling` (lastes lazy fra unpkg) med `<base>.png`/`<base>2.png` i midten. Fallbilde: `failedqr.png`.
- Scroll-posisjon huskes når panelet åpnes (sida rulles til topp), og gjenopprettes når det lukkes.
### Eksport
- 📤 (`nEx`) i premium: teksten hentes fra `.md`-sidecaren (aldri fra PDF), forside og resten hver for seg; musikkinjer hoppes over, overskrifter blir fete.
- Teksten vises i et A4-ark (`#_dExportTxt`, contenteditable); 💾 lagrer som PDF via html2pdf (lazy).
- `nav.ExportSave` (lagre som .txt) finnes, men knappen bruker `cBook.Save` – funksjonen er ubrukt.
### Musikk
- `music.js` (Spotify/Jamendo/FMA): `♪` per sanglinje i sidecaren plasseres på sida etter anslag av hvor sangen står, og `♫` i TOC.
- Avspilling i innebygd Spotify-iframe inne i TOC, med 🎶-knapp for stopp (`#_spCollapse`).
- `music.Play()` kalles etter hver sidelaging; `music.Page(key)` brukes av dyp-lenker med musiknøkkel (`m…`) og hopper til sida der sangen står.
- 🎵-knappen i menyen (`nMu`) er skjult for tiden (`uishow(nMu,0)`).
### Meny og UI-oppførsel
- ⏷/⏶ (`nMt`) utvider/skjuler knapperaden; tilstanden huskes (`LdD.menu`).
- Skjult meny: 📚 flytende midt til venstre, 🔍 på 40 %, 🔓 (bare freemium) på 70 %, deleknappen flyttet nederst til venstre – alle gråtonet.
- Auto-skjul etter 3 s uten aktivitet (`body.hideNav`), men ikke mens TOC/dele/eksport/søkefelt er åpent. Klikk på boka viser menyen igjen; flytende kontroller og musikk vekker den ikke. Kantkontrollene blir stående.
- PWA-metadata for fullskjerm fra Hjem-skjermen (apple-mobile-web-app-*, theme-color), favicon `aigap.webp`.
- Ingen innstillinger (fontstørrelse, tema, spredning/oppslag) – alt følger skjermen.
### Dyp-lenker
- `?c=` er en kommandorekke som spilles av med `nav.btSimul`: knappe-id-er (f.eks. `nLg0`, `nTc`), `w,<ms>` = vent, `s,<y>` = scrollTop, `m…` = musikknøkkel.
- `?book=`, `?page=`, `?y=`, `?bookT=` (pdf/iframe) støttes i tillegg til lagrede verdier.
### Lagring (localStorage)
- Globale: `LdD.book`, `LdD.menu`, `LdD.hsTip`.
- Per bok (`LdD.<boknavn>.`): `page`, `Y` (scroll), `lang`, `prem`, `code`. Gamle flate nøkler leses som fallback.
### Logging
- `window.db.logUsage({event, book, page, code})` → Supabase `usage`: `page` ved sidebytte/åpning, `premium_activate` ved gyldig PIN.
## TODO

## Kodekommentarer
