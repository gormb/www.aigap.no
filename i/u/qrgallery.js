// ── state shared by every iframe ──────────────────────────────────────────
var TRS=0;                  // 0 Opaque, 1 Transparent, 2 All
var HID=false;              // ex=1 -> show extra tiles
var X21U=false;             // x21=U -> uppercase 21x21 URL
var MISS=false;             // filter: show only codes with no selection recorded yet
var cards={};               // base -> {el, fr, pick, cur, sav, btn, sel, tiles, up, triedUp}
var io=null;                // kept at module scope: a local-only observer can be GC'd and stop firing

var supa=(window.SUPABASE&&SUPABASE.url&&SUPABASE.url.indexOf('YOUR-')<0)?SUPABASE:null;
var HDR=supa?{apikey:supa.publishableKey,'Authorization':'Bearer '+supa.publishableKey}:null;
var exBtn=document.getElementById('ex'),vtBtn=document.getElementById('vt'),c21Btn=document.getElementById('c21');
var missBtn=document.getElementById('miss');
var SQL=document.getElementById('sql').textContent.trim();

function srcFor(base,expanded){            // mirrors qr.html's own deep-link order
  var p=new URLSearchParams();
  var c=cards[base];
  var sel=c&&c.sel;
  // render a card UPPERCASE when its own override says so, when the global
  // toggle is on, or when its stored token is an uppercase 21x
  var up=(c&&c.up!=null)?c.up:(X21U||/u$/.test(sel||''));
  if(up)p.set('x21','U');
  if(HID)p.set('ex','1');
  p.set('v',(expanded?['o','t','a']:['O','T','A'])[TRS]);   // UPPER = collapsed minimal view
  if(sel)p.set('sel',sel);
  p.set('x',base);                                          // x is always the LAST param
  return 'qr.html?'+p.toString();
}
function reload(base){var c=cards[base];if(c&&c.fr&&c.fr.dataset.on)c.fr.src=srcFor(base,c.el.classList.contains('exp'));}
function reloadAll(){Object.keys(cards).forEach(reload);}
function ensure(base){          // lazy: only start an iframe once it is near the viewport
  var c=cards[base];if(!c||!c.fr||c.fr.dataset.on)return;
  c.fr.dataset.on='1';
  c.fr.src=srcFor(base,c.el.classList.contains('exp'));
}
function expand(c,on){
  c.el.classList.toggle('exp',on);
  c.btn.textContent=on?'collapse':'expand';
  if(c.fr&&c.fr.dataset.on)c.fr.src=srcFor(c.el.dataset.base,on);
}
function setEx(on){HID=on;exBtn.textContent=HID?'Hide extra':'Show extra';reloadAll();}
function setVt(){TRS=(TRS+1)%3;vtBtn.textContent=['Opaque','Transparent','All'][TRS];reloadAll();}
function setC21(on){X21U=on;c21Btn.textContent=X21U?'21\u00d721 CAPS: on':'21\u00d721 CAPS: off';reloadAll();}
exBtn.onclick=function(){setEx(!HID);};
vtBtn.onclick=setVt;
c21Btn.onclick=function(){setC21(!X21U);};
missBtn.onclick=function(){setMiss(!MISS);};
function applyFilter(){   // hide codes that already have a selection (or vice versa)
  var shown=0,missing=0;
  Object.keys(cards).forEach(function(b){
    var c=cards[b];if(!c.sel)missing++;
    var hide=(MISS&&!!c.sel)||c.present==='none';
    c.el.style.display=hide?'none':'';
    if(!hide)shown++;
  });
  document.getElementById('count').textContent=shown+' of '+Object.keys(cards).length+' shown';
  missBtn.textContent=MISS?'Showing missing':('Missing only ('+missing+')');
  missBtn.classList.toggle('on',MISS);
}
function setMiss(on){
  MISS=on;applyFilter();
  if(!on)Object.keys(cards).filter(function(b){return cards[b].el.style.display!=='none';}).slice(0,4).forEach(ensure);
}
document.getElementById('xall').onclick=function(){Object.keys(cards).forEach(function(b){expand(cards[b],true);ensure(b);});};
document.getElementById('cnone').onclick=function(){Object.keys(cards).forEach(function(b){expand(cards[b],false);});};

// ── selection: the engine posts back what it renders ──────────────────────
function label(o){
  var caps=o.lab.slice(-1)==='u'?' \u00b7 CAPS':'';
  var star=o.rec?' \u2605':'';
  var col=o.col?(o.col==='g'?' \u00b7 safe':o.col==='y'?' \u00b7 near':' \u00b7 over'):'';
  return o.lab+caps+star+col+(o.pct!=null?' '+o.pct+'%':'');
}
function fillPick(base,d){
  var c=cards[base];if(!c||!c.pick)return;
  var seen={},opts=[];
  function add(lab,rec){                       // 21x always offers BOTH cases
    if(!lab||seen[lab])return;seen[lab]=1;opts.push({lab:lab,rec:rec});
    if(lab.slice(0,2)==='21'){
      var twin=lab.slice(-1)==='u'?lab.slice(0,-1):lab+'u';
      if(!seen[twin]){seen[twin]=1;opts.push({lab:twin,rec:rec});}
    }
  }
  (d.recs||[]).forEach(function(l){add(l,1);});
  (d.tiles||[]).forEach(function(t){add(t.lab,0);});
  c.pick.innerHTML='<option value="">\u2014 none \u2014</option>'+opts.map(function(o){
    return '<option value="'+o.lab+'">'+label(o)+'</option>';}).join('');
  var stored=c.sel||'';
  var effUp=(c.up!=null)?c.up:X21U;               // the case THIS card is rendered in
  var legacy21=stored.slice(0,2)==='21'&&stored.slice(-1)!=='u';   // pre-'u' token: the case is implicit
  // such a token may only exist UPPERCASE (Byte vs Alphanumeric capacity) ->
  // render this card uppercase and re-check once
  if(legacy21&&!seen[stored]&&d.fitL&&d.fitU&&!c.triedUp){
    var ec21=stored.slice(2,3);
    if(d.fitL['21'].indexOf(ec21)<0&&d.fitU['21'].indexOf(ec21)>=0){c.triedUp=1;c.up=true;reload(base);return;}
  }
  var tok=legacy21?(effUp?stored+'u':stored):stored;   // the token as rendered in this case
  var found=!stored||!!seen[tok];
  if(stored&&!found){                 // stored token is not renderable for this id -> say so, never blank
    c.pick.insertAdjacentHTML('afterbegin','<option value="'+stored+'">'+stored+' \u00b7 STORED \u2014 not renderable</option>');
    c.pick.value=stored;
    c.el.classList.add('badpick');
    c.sav.className='sav err';c.sav.textContent=whyMissing(stored,d,effUp);
  }else{
    if(c.el.classList.contains('badpick')){c.sav.className='sav';c.sav.textContent='';}   // clear the mismatch note
    c.el.classList.remove('badpick');
    c.pick.value=found?tok:'';
    if(c.up===true&&tok!==stored){   // auto-resolved: tell them the token is ambiguous
      c.sav.className='sav';
      c.sav.textContent='stored '+stored+' has no case marker \u2014 only exists UPPER; re-save to record '+tok;
    }
  }
}
function whyMissing(tok,d,effUp){      // explain WHY a stored token cannot be shown here
  var N=tok.slice(0,2),ec=tok.slice(2,3);
  if(N!=='21'||!d.fitL||!d.fitU)return 'stored '+tok+' is not offered in this view \u2014 turn on Show extra';
  var low=d.fitL['21'].indexOf(ec)>=0, up=d.fitU['21'].indexOf(ec)>=0;
  if(!low&&!up)return 'stored '+tok+' cannot exist: 21 modules at EC '+ec+' never fits this id (lower fits '+(d.fitL['21'].join('/')||'-')+', UPPER fits '+(d.fitU['21'].join('/')||'-')+')';
  return 'stored '+tok+' only fits '+(low?'lower':'')+(low&&up?' + ':'')+(up?'UPPER':'')+' \u2014 toggle 21\u00d721 CAPS, or re-save the right case';
}
window.addEventListener('message',function(e){
  var d=e.data;if(!d||d.type!=='qr-tiles'||!d.x)return;
  var c=cards[d.x];if(!c)return;
  c.tiles=d.tiles||[];
  fillPick(d.x,d);
});

async function patch(base,data,okMsg){
  var c=cards[base];
  if(!supa){c.sav.className='sav err';c.sav.textContent='db.js not configured';return null;}
  c.sav.className='sav';c.sav.textContent='saving…';
  try{
    var r=await fetch(supa.url+'/rest/v1/redir?id=eq.'+encodeURIComponent(base),
      {method:'PATCH',headers:Object.assign({'Content-Type':'application/json','Prefer':'return=representation'},HDR),body:JSON.stringify(data)});
    if(!r.ok){var t=await r.text();c.sav.className='sav err';c.sav.textContent=r.status+' '+t.slice(0,140);return null;}
    var rows=await r.json();
    if(!rows||!rows.length){c.sav.className='sav err';c.sav.textContent='no row updated (needs the anon UPDATE policy)';return null;}
    c.sav.className='sav ok';c.sav.textContent=okMsg;
    return rows[0];
  }catch(err){c.sav.className='sav err';c.sav.textContent=err.message;return null;}
}
async function save(base){
  var c=cards[base];if(!c||!c.pick)return;
  var val=c.pick.value||'';
  if(!await patch(base,{qr:val||null},val?'saved':'cleared'))return;
  c.sel=val;c.cur.innerHTML='selected: <b>'+(val||'none')+'</b>';
  c.triedUp=0;c.up=/u$/.test(val)?true:null;   // an uppercase token pins the card; otherwise follow the toggle
  reload(base);applyFilter();
}
async function savePresent(base){
  var c=cards[base];if(!c)return;
  var v=c.prs.value;
  if(!await patch(base,{present:v},'present: '+v))return;
  c.present=v;reload(base);applyFilter();
}

// ── build the cards from the live redir table ─────────────────────────────
function showWarn(msg,pre){var w=document.getElementById('warn');w.innerHTML=msg+(pre?'<pre>'+pre.replace(/[<>&]/g,'')+'</pre>':'');w.classList.add('on');}
async function dbRows(sel){
  var r=await fetch(supa.url+'/rest/v1/redir?select='+sel+'&order=sort.asc,id.asc',{headers:HDR});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+await r.text());
  return r.json();
}
function cardEl(base,sel,present){
  var el=document.createElement('div');el.className='card';el.dataset.base=base;
  el.innerHTML='<div class=hd><b>'+base+'</b>'+
    '<a class=lnk href="https://aigap.no/'+base+'" target=_blank rel=noopener>aigap.no/'+base+'</a>'+
    '<span class=sp></span>'+
    '<a class=lnk href="qr.html?x='+encodeURIComponent(base)+'&v=o" target=_blank rel=noopener>open</a>'+
    (present==='qr'?'<button class=btn type=button>expand</button>':'')+'</div>'+
    '<div class=picker><span class=cur>selected: <b>'+(sel||'none')+'</b></span>'+
    (present==='qr'?'<select class=pick><option value="'+(sel||'')+'">'+(sel||'\u2014 none \u2014')+'</option></select>':'')+
    '<select class=prs>'+['qr','img','none'].map(function(v){return '<option value="'+v+'"'+(v===present?' selected':'')+'>'+v+'</option>';}).join('')+'</select>'+
    '<span class=sav></span></div>'+
    (present==='qr'
      ?'<iframe class=fr loading=lazy title="QR for '+base+'"></iframe>'
      :'<img class=art loading=lazy alt="'+base+'" src="i/'+base+'.png">');
  return el;
}

(async function(){
  var st=document.getElementById('status'),grid=document.getElementById('grid');
  if(!supa){st.textContent='\u26a0\ufe0f db.js not configured';return;}
  try{
    var rows,hasQr=true;
    try{ rows=await dbRows('id,url,%22desc%22,sort,qr,present'); }
    catch(e){ hasQr=false; rows=await dbRows('id,url,%22desc%22,sort'); }
    if(!hasQr)showWarn('The <code>qr</code>/<code>present</code> columns do not exist yet, so nothing can be recorded. Run this in the Supabase SQL editor:',SQL);
    var coded=rows.filter(function(r){return r.present==='qr'||r.present==='img';})
      .sort(function(a,b){return a.id<b.id?-1:a.id>b.id?1:0;});
    if(!coded.length){st.textContent='No QR/image codes (present) in the redir table.';return;}
    var frag=document.createDocumentFragment();
    coded.forEach(function(r){
      var base=r.id,sel=hasQr?(r.qr||''):'';
      var el=cardEl(base,sel,r.present);frag.appendChild(el);
      var c={el:el,fr:el.querySelector('.fr'),pick:el.querySelector('.pick'),prs:el.querySelector('.prs'),
             cur:el.querySelector('.cur'),sav:el.querySelector('.sav'),btn:el.querySelector('.btn'),
             sel:sel,present:r.present,tiles:[],up:null,triedUp:0};
      cards[base]=c;
      if(c.btn)c.btn.onclick=function(){expand(c,!el.classList.contains('exp'));ensure(base);};
      if(c.pick)c.pick.onchange=function(){save(base);};
      if(c.prs)c.prs.onchange=function(){savePresent(base);};
    });
    grid.appendChild(frag);
    st.textContent=coded.length+' codes from the redir table (live)';
    applyFilter();
    var ioObs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)ensure(e.target.dataset.base);});},{rootMargin:'300px'});
    io=ioObs;
    Object.keys(cards).forEach(function(b){ioObs.observe(cards[b].el);});
    Object.keys(cards).slice(0,4).forEach(ensure);   // never start blank if the observer is slow
  }catch(e){st.textContent='DB error: '+e.message;}
})();
