#!/usr/bin/env python3
"""_qrmat_page.py - build a filterable page over the generated QR matrix.

Each generated file <base>.qr<N><EC><hole>.png is shown as a tile: the QR with
the base's cover art (<base>.png) overlaid in the centre hole (a JS mirror of
the python blank_centred_hole).  Checkboxes filter by size / EC / hole; a text
box filters by base.

Usage: python3 _qrmat_page.py [out.html]
"""
import glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'u', 'qrmatrix.html')
PREFIX = 'https://aigap.no/'

PAT = re.compile(r'^(.*)\.qr(21|25|29)([LMQH])([03579])\.png$')
GLOB = '*.qr2[159][LMQH][03579].png'

def geo(N, hole):
    """JS-mirror of python blank_centred_hole: centred hole of `hole` modules.
    Returns (startModule, hole)."""
    return (N - hole) // 2, hole

def main():
    files = sorted(glob.glob(os.path.join(HERE, GLOB)))
    cards = []
    seen = set()
    for p in files:
        b = os.path.basename(p)
        m = PAT.match(b)
        if not m:
            continue
        base, N, ec, hole = m.group(1), m.group(2), m.group(3), m.group(4)
        key = (base, N, ec, hole)
        if key in seen:
            continue
        seen.add(key)
        N = int(N); hole = int(hole)
        art = ('../' + base + '.png') if os.path.exists(os.path.join(HERE, base + '.png')) else ''
        artimg = '<img class=art src="%s" onerror="this.remove()">' % art if art else ''
        cards.append(
            '<div class="card" data-n="%s" data-ec="%s" data-hole="%s" data-base="%s">'
            '<div class=tt>%s <span class=ec>%s%s%s</span>'
            '<a class=pay href="https://aigap.no/%s" target=_blank rel=noopener>'
            '(https://www.)aigap.no/%s</a></div>'
            '<div class=comp data-n="%s" data-hole="%s" style="width:%dpx;height:%dpx">'
            '<img class=q src="../%s">%s</div></div>' % (
                N, ec, hole, base.lower(), base, N, ec, hole, base, base,
                N, hole, N * 4, N * 4, b, artimg))

    # collect distinct values for the checkbox groups
    ns, ecs, holes = set(), set(), set()
    for c in cards:
        ns.add(int(c.split('data-n="')[1].split('"')[0]))
        ecs.add(c.split('data-ec="')[1].split('"')[0])
        holes.add(int(c.split('data-hole="')[1].split('"')[0]))
    sel_ns = {int(x) for x in ns}
    sel_ecs = {x for x in ecs}
    sel_holes = {int(x) for x in holes}

    def chk(kind, items):
        return ''.join('<label><input type=checkbox class="f %s" value="%s"> %s</label>'
                       % (kind, v, v) for v in sorted(items))

    chk_n = chk('n', sorted(ns))
    chk_ec = chk('ec', sorted(ecs))
    chk_h = chk('hole', sorted(holes))
    grid = ''.join(cards)

    css = """
body{font:13px/1.4 system-ui,sans-serif;margin:14px;background:#eef1f4}
h1{font-size:18px;margin:0} h1 small{color:#666;font-weight:normal}
.toolbar{background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px 12px;margin:10px 0}
.toolbar .g{display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0}
.toolbar label{white-space:nowrap}
.toolbar input[type=text]{padding:4px 6px;width:180px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.card{display:none;background:#fff;border:1px solid #ddd;border-radius:10px;padding:8px;text-align:center}
.card.show{display:block}
.tt{font-weight:600;margin-bottom:6px} .ec{color:#0a5;font-weight:700} .pay{display:block;color:#999;font-size:10px;word-break:break-all;text-decoration:none}.pay:hover{text-decoration:underline}
.comp{position:relative;margin:0 auto;overflow:hidden}
.comp img.q{width:100%;height:100%;display:block;image-rendering:pixelated}
.comp img.art{position:absolute;object-fit:cover;border:0}
#count{margin-left:8px;color:#666}
"""

    js = """
function applyGeo(){ // JS mirror of python blank_centred_hole
  document.querySelectorAll('.comp').forEach(function(c){
    var art=c.querySelector('img.art'); if(!art) return;
    var N=+c.dataset.n, h=+c.dataset.hole, s=(N-h)/2;
    art.style.left='calc(100% * '+s+' / '+N+')';
    art.style.top ='calc(100% * '+s+' / '+N+')';
    art.style.width ='calc(100% * '+h+' / '+N+')';
    art.style.height='calc(100% * '+h+' / '+N+')';
  });
}
function sel(kind){ return Array.from(document.querySelectorAll('.f.'+kind+':checked')).map(function(e){return e.value;}); }
function update(){
  var ns=sel('n').map(Number), ecs=sel('ec'), hs=sel('hole').map(Number);
  var bf=document.getElementById('bf').value.trim().toLowerCase();
  var n=0;
  document.querySelectorAll('.card').forEach(function(c){
    var ok = ns.indexOf(+c.dataset.n)>=0 && ecs.indexOf(c.dataset.ec)>=0 && hs.indexOf(+c.dataset.hole)>=0
          && (!bf || c.dataset.base.indexOf(bf)>=0);
    c.classList.toggle('show', ok); if(ok)n++;
  });
  document.getElementById('count').textContent = n+' shown';
}
document.querySelectorAll('.f').forEach(function(x){ x.addEventListener('change', update); });
document.getElementById('bf').addEventListener('input', update);
document.getElementById('all').onclick=function(){document.querySelectorAll('.f').forEach(function(x){x.checked=true;});update();};
document.getElementById('none').onclick=function(){document.querySelectorAll('.f').forEach(function(x){x.checked=false;});update();};
applyGeo();
update();
"""

    html = ('<!doctype html><html><head><meta charset=utf-8><title>QR matrix</title>'
            '<style>' + css + '</style></head><body>'
            '<h1>QR matrix <small>https://aigap.no/&lt;base&gt;</small></h1>'
            '<div class=toolbar>'
            '<div class=g>Size: ' + chk_n + '</div>'
            '<div class=g>EC: ' + chk_ec + '</div>'
            '<div class=g>Hole: ' + chk_h + '</div>'
            '<div class=g>Base: <input id=bf type=text placeholder="e.g. bgda"> '
            '<button id=all>all</button><button id=none>none</button><span id=count></span></div>'
            '</div><div class=grid>' + grid + '</div>'
            '<script>' + js + '</script></body></html>')
    open(OUT, 'w', encoding='utf-8').write(html)
    print(f'wrote {OUT}  ({len(cards)} distinct combos across bases)')

if __name__ == '__main__':
    main()
