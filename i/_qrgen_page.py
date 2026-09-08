#!/usr/bin/env python3
"""_qrgen_page.py - build a page to view/test the per-code qr21/qr25i files.

Card per base: the scannable .qr21.png + the white-centre .qr25i.png, with
status (size, module dim, decodes?, white centre?).  Click an image to open the
raw PNG full size (for scanning).

Usage: python3 _qrgen_page.py [out.html]
"""
import glob, os, sys
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = 'www.aigap.no/'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'u', 'qrgen.html')

def decodes(f):
    im = Image.open(f).convert('L')
    a = np.array(im)
    if a.shape[0] < 80:
        a = np.kron(a, np.ones((4, 4), dtype=a.dtype))
    return cv2.QRCodeDetector().detectAndDecode(a)[0]

QUIET = 0            # must match the generator's quiet zone (0 = no border)
WHITE_LO, WHITE_HI = 8, 17     # white hole = modules 8..16 (9 wide) on the 25
BOX = 10                       # upscale factor for the composite

def centre_white(f, N):
    # white hole = modules 9..15 (7, centred on module 12); borderless 25 grid
    lo = 9 + QUIET; hi = 16 + QUIET
    g = Image.open(f).convert('L').crop((lo, lo, hi, hi))
    h = g.histogram()
    return sum(h[129:]) / (sum(h) or 1)

def main():
    u_dir = os.path.dirname(OUT)
    files = sorted(glob.glob(os.path.join(HERE, '*.qr21.png')))
    cards = []
    n_ok = n_bad = 0
    for p in files:
        base = os.path.basename(p)[:-len('.qr21.png')]
        q25 = os.path.join(HERE, base + '.qr25i.png')
        has_art = os.path.exists(os.path.join(HERE, base + '.png'))
        # qr21 raw
        d21 = decodes(p)
        im21 = Image.open(p); N21 = (im21.size[0]) - 2 * 2  # minus QUIET margin approx
        sz21 = os.path.getsize(p)
        ok21 = bool(d21) and d21 == PREFIX + base
        # qr25i white
        d25 = decodes(q25)
        sz25 = os.path.getsize(q25)
        wc = centre_white(q25, 25)
        okw = wc >= 0.9
        good = ok21 and okw
        cls = 'ok' if good else 'bad'
        if good: n_ok += 1
        else: n_bad += 1
        badge = lambda k, v: f'<span class="b {"b-ok" if v else "b-bad"}">{k}{"✓" if v else "✗"}</span>'
        w21 = Image.open(p).size[0]            # natural px of qr21 file
        w25 = Image.open(q25).size[0]          # natural px of qr25i file (29)
        SC = 4                                  # integer upscale (no distorted modules)
        cards.append(f'''
<div class="card {cls}">
 <div class=tt><b>{base}</b> <span class=pay>{PREFIX}{base}</span></div>
 <div class=imgs>
   <a href="../{base}.qr21.png" target=_blank title="open raw"><img src="../{base}.qr21.png" style="width:{w21*SC}px;height:{w21*SC}px"></a>
   <a href="../{base}.qr25i.png" target=_blank title="open white"><img src="../{base}.qr25i.png" style="width:{w25*SC}px;height:{w25*SC}px"></a>
 </div>
 <div class=chk>
   {badge('decodes', ok21)}
   {badge('white-centre', okw)}
 </div>
 <div class=meta>qr21 {sz21}B · {d21 if d21 else "no decode"} &nbsp;|&nbsp; qr25i {sz25}B ctr{wc:.0%}</div>
 <div class=comp data-base="{base}" data-art="{'1' if has_art else ''}">
   <img class=q src="../{base}.qr25i.png"><img class=art src="../{base}.png">
 </div>
 <div class=flab>composite variant: <b class=combo>25 L 5</b></div>
</div>''')

    def radio(kind, items, default):
        out = []
        for v in sorted(items):
            sel = ' checked' if str(v) == str(default) else ''
            out.append('<label><input type=radio class="f %s" name="%s" value="%s"%s> %s</label>'
                       % (kind, kind, v, sel, v))
        return ''.join(out)

    css = """
body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#eef1f4}
h1{font-size:19px;margin:0 0 4px} h1 small{color:#666;font-weight:normal}
.sum{margin:6px 0 14px} .sum b{margin:0 12px 0 4px}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin:0 4px 0 0;vertical-align:-1px}
.toolbar{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px 12px;margin:10px 0;display:flex;flex-wrap:wrap;gap:6px 20px}
.toolbar label{white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:#fff;border:1px solid #ddd;border-left:5px solid #c33;border-radius:10px;padding:12px}
.card.ok{border-left-color:#2c8c3c}
.tt{margin-bottom:8px} .pay{color:#888;font-size:11px;word-break:break-all}
.imgs{display:flex;gap:10px;align-items:center;justify-content:center;background:#fff;padding:8px;border-radius:6px}
.imgs a{background:#fff;display:inline-flex;padding:6px;border:1px solid #ddd;border-radius:6px}
.imgs img{width:120px;height:120px;image-rendering:pixelated;display:block}
.comp{position:relative;width:250px;height:250px;margin:10px auto 2px;overflow:hidden;background:#fff}
.comp img.q{width:100%;height:100%;display:block;image-rendering:pixelated}
.comp img.art{position:absolute;object-fit:cover;border:0}
.flab{color:#888;font-size:11px;margin-top:2px}
.chk{margin:8px 0 4px;display:flex;gap:6px}
.b{font-size:11px;padding:2px 7px;border-radius:9px}
.b-ok{background:#e5f6e7;color:#1e6b2a} .b-bad{background:#fdecec;color:#a12}
.meta{color:#888;font-size:11px;word-break:break-all}
"""
    js = """
function val(kind){ var r=document.querySelector('.f.'+kind+':checked'); return r?r.value:'25'; }
function update(){
  var N=val('n'), ec=val('ec'), h=val('hole');
  document.querySelectorAll('.card').forEach(function(card){
    var comp=card.querySelector('.comp'); if(!comp) return;
    var base=comp.dataset.base, hasArt=comp.dataset.art==='1';
    var name=base+'.qr'+N+ec+h+'.png';
    var q=comp.querySelector('img.q'), a=comp.querySelector('img.art');
    var pre=new Image();
    pre.onload=function(){
      q.src='../'+name; comp.style.display='';
      var s=(+N - +h)/2;
      if(a){ a.style.display = hasArt?'':'none';
        a.style.left='calc(100% * '+s+' / '+N+')'; a.style.top='calc(100% * '+s+' / '+N+')';
        a.style.width='calc(100% * '+h+' / '+N+')'; a.style.height='calc(100% * '+h+' / '+N+')'; }
      var cb=card.querySelector('.combo'); if(cb) cb.textContent=N+' '+ec+' '+h;
    };
    pre.onerror=function(){ comp.style.display='none'; };
    pre.src='../'+name;
  });
}
document.querySelectorAll('.f').forEach(function(x){ x.addEventListener('change', update); });
document.querySelectorAll('.card').forEach(function(card){
  var comp=card.querySelector('.comp'); if(!comp){return;}
  var a=comp.querySelector('img.art');
  if(a) a.addEventListener('error', function(){ this.style.display='none'; });
});
update();
"""
    toolbar = ('<div class=toolbar>'
               '<span>Size ' + radio('n', [21, 25, 29], 25) + '</span>'
               '<span>EC ' + radio('ec', ['L', 'M', 'Q', 'H'], 'L') + '</span>'
               '<span>Hole ' + radio('hole', [3, 5, 7, 9], 5) + '</span>'
               '</div>')
    grid = ''.join(cards)
    html = ('<!doctype html><html><head><meta charset=utf-8>'
            '<title>QR qr21/qr25i gallery</title><style>' + css + '</style></head><body>'
            '<h1>qr21 / qr25i <small>generated</small></h1>'
            '<div class=sum><span class=dot style="background:#2c8c3c"></span><b>' + str(n_ok) + '</b> good'
            '<span class=dot style="background:#c33"></span><b>' + str(n_bad) + '</b> flagged</div>'
            + toolbar +
            '<div class=grid>' + grid + '</div>'
            '<script>' + js + '</script></body></html>')
    open(OUT, 'w', encoding='utf-8').write(html)
    print(f'wrote {OUT}  ({len(cards)} codes: {n_ok} good, {n_bad} flagged)')

if __name__ == '__main__':
    main()
