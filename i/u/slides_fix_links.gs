/**
 * Fix Gorm links in this Google Slides deck (visible text):
 *   https://gormb.github.io/_?<base>     ->  https://aigap.no/<base>
 *   https://gormb.github.io/_?<base>qr   ->  https://aigap.no/<base>
 *   https://gormb.github.io/_?<base>qra  ->  https://aigap.no/<base>
 *
 * No Advanced services needed - just open the deck ->
 * Extensions -> Apps Script, paste this, press Run. That applies the changes.
 * previewLinks() instead only reports what it would do, writing nothing.
 *
 * Links are shown in black Garamond (the font is only set when it is not
 * Garamond already).
 *
 * NOTE: this changes the text shown in the deck. If your items are QR IMAGES,
 * replace text does NOT change what the images encode - swap in the new QR
 * images for those. (Retargeting clickable hyperlink URLs needs the Slides
 * REST/Advanced service, which this intentionally avoids.)
 */
function fixGormbLinks(dry) {
  const D = !!dry, deck = SlidesApp.getActivePresentation();
  let n = 0, styled = 0, els = 0, chars = 0, runs = 0, links = 0, txtEls = 0, imgs = 0, other = 0;
  const would = [];

  function linkStyle(text) {
    for (const run of text.getRuns()) {
      runs++;
      let s = '', url = null;
      try { s = run.asString(); } catch (e) {}
      try { url = run.getLinkUrl(); } catch (e) {}
      if (url) links++;

      if (!url && !/aigap\.no[\/?]|gormb\.github\.io/.test(s)) continue;
      if (would.length < 5) would.push(JSON.stringify(s.slice(0, 60)));
      styled++;
      if (D) continue;
      const st = run.getTextStyle();
      if ((st.getFontFamily() || '').toLowerCase() !== 'garamond') st.setFontFamily('Garamond');
      if ((st.getForegroundColor() || '').toUpperCase() !== '#000000') st.setForegroundColor('#000000');
    }
  }

  function fix(text) {
    const s = text.asString();
    chars += s.length;
    if (s.indexOf('gormb.github.io/_?') >= 0) {
      const fixed = s.replace(/https:\/\/gormb\.github\.io\/_\?([A-Za-z0-9]+)/g, function (m, id) {
        const base = id.endsWith('qra') ? id.slice(0, -3)
                   : id.endsWith('qr')  ? id.slice(0, -2)
                   : id;
        return 'https://aigap.no/' + base;
      });
      if (fixed !== s) { if (!D) text.replaceAllText(s, fixed); n++; }
    }
    linkStyle(text);
  }

  function walk(el) {
    els++;
    const t = el.getPageElementType();
    if (t === SlidesApp.PageElementType.GROUP) {
      for (const kid of el.asGroup().getChildren()) walk(kid);
    } else if (t === SlidesApp.PageElementType.TABLE) {
      const tb = el.asTable();
      for (let r = 0; r < tb.getNumRows(); r++)
        for (let c = 0; c < tb.getNumColumns(); c++)
          fix(tb.getCell(r, c).getText());
    } else if (t === SlidesApp.PageElementType.IMAGE || t === SlidesApp.PageElementType.VIDEO) {
      imgs++;
    } else {
      try { fix(el.asShape().getText()); txtEls++; } catch (e) { other++; }
    }
  }

  const pages = deck.getSlides().concat(deck.getLayouts(), deck.getMasters());
  for (const page of pages)
    for (const el of page.getPageElements()) {
      try { walk(el); } catch (e) { /* ignore individual element errors */ }
    }
  const tag = D ? 'DRY RUN (nothing written) - ' : '';
  Logger.log(tag + 'pages: ' + pages.length + ' (slides ' + deck.getSlides().length + '), elements: ' + els +
             ', shapes with text: ' + txtEls + ', images/videos: ' + imgs + ', other: ' + other);
  Logger.log(tag + 'text chars: ' + chars + ', runs: ' + runs + ', hyperlink runs: ' + links +
             ', replaced: ' + n + ', link runs styled: ' + styled);
  Logger.log('matched link runs: ' + (would.join(' | ') || '(none)'));
}

/** Default Run = apply. previewLinks() = report only, writes nothing. */
function myFunction() {
  fixGormbLinks();
}

function previewLinks() {
  fixGormbLinks(true);
}
