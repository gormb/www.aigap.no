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
 * Garamond already), and the https://aigap.no/m* URLs are made clickable
 * (hyperlinked to their own text) when they are not links yet.
 *
 * NOTE: this changes the text shown in the deck. If your items are QR IMAGES,
 * replace text does NOT change what the images encode - swap in the new QR
 * images for those. (Retargeting clickable hyperlink URLs needs the Slides
 * REST/Advanced service, which this intentionally avoids.)
 */
function fixGormbLinks(dry) {
  const D = !!dry, ONLY = 0, deck = SlidesApp.getActivePresentation();   // ONLY = slide number to touch, 0 = every slide
  let n = 0, hit = 0, made = 0, els = 0, chars = 0, txtEls = 0, imgs = 0, other = 0;
  const texts = [], found = [], errs = [];

  function urls(text) {   // black Garamond + clickable on every https://aigap.no/m* URL in this text
    const s = text.asString();
    chars += s.length;
    if (ONLY && texts.length < 10) texts.push(JSON.stringify(s.replace(/\s+/g, ' ').trim().slice(0, 70)));
    const re = /https?:\/\/aigap\.no\/m[^\s]*/g;
    let m;
    while ((m = re.exec(s))) {
      hit++;
      if (found.length < 5) found.push(m[0]);
      if (D) continue;
      let r = s.trim() === m[0] ? text : null;                       // URL is the whole text
      if (!r) { try { r = text.find(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch (e) {} }
      if (!r) { if (errs.length < 3) errs.push('not found: ' + m[0]); continue; }
      const st = r.getTextStyle();
      try { st.setLinkUrl(m[0]); made++; }                           // link lives on the text style in Slides
      catch (e) { if (errs.length < 3) errs.push('link: ' + e); }
      try {
        st.setUnderline(false);                                      // Slides underlines new hyperlinks
        if ((st.getFontFamily() || '').toLowerCase() !== 'garamond') st.setFontFamily('Garamond');
        if ((st.getForegroundColor() || '').toUpperCase() !== '#000000') st.setForegroundColor('#000000');
      } catch (e) { if (errs.length < 3) errs.push('style: ' + e); }
    }
  }

  function fix(text) {
    const s = text.asString();
    if (s.indexOf('gormb.github.io/_?') >= 0) {
      const fixed = s.replace(/https:\/\/gormb\.github\.io\/_\?([A-Za-z0-9]+)/g, function (m, id) {
        const base = id.endsWith('qra') ? id.slice(0, -3)
                   : id.endsWith('qr')  ? id.slice(0, -2)
                   : id;
        return 'https://aigap.no/' + base;
      });
      if (fixed !== s) { if (!D) text.replaceAllText(s, fixed); n++; }
    }
    urls(text);   // re-reads the text itself, so offsets stay correct after a replace
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

  const slides = deck.getSlides(), pages = slides.concat(deck.getLayouts(), deck.getMasters());
  for (let i = 0; i < pages.length; i++) {
    if (ONLY && !(i < slides.length && i + 1 === ONLY)) continue;
    for (const el of pages[i].getPageElements()) {
      try { walk(el); } catch (e) { /* ignore individual element errors */ }
    }
  }
  const tag = D ? 'CHECK ONLY, the deck was NOT changed - ' : '';
  Logger.log(tag + 'pages: ' + pages.length + ' (slides ' + slides.length + ', only slide ' + (ONLY || 'all') +
             '), elements: ' + els + ', shapes with text: ' + txtEls + ', images/videos: ' + imgs + ', other: ' + other);
  Logger.log(tag + 'text chars: ' + chars + ', matched URLs: ' + hit + ', links set: ' + made + ', replaced: ' + n);
  Logger.log('matched: ' + (found.join(' | ') || '(none)'));
  if (ONLY) Logger.log('text on slide ' + ONLY + ': ' + (texts.join(' | ') || '(no text found)'));
  if (errs.length) Logger.log('errors: ' + errs.join(' | '));
}

/** Default Run = apply. previewLinks() = report only, writes nothing. */
function myFunction() {
  fixGormbLinks();
}

function previewLinks() {
  fixGormbLinks(true);
}
