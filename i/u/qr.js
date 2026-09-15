var x=(new URLSearchParams(location.search).get('x')||'').trim();
var I=(new URLSearchParams(location.search).get('i')||'').trim();      // i=overlay image (basename or full URL)
var V=(new URLSearchParams(location.search).get('v')||'').trim();      // v=o|t|a (normal) / v=O|T|A (collapsed minimal); legacy m=t
var SP=new URLSearchParams(location.search);                           // shared parser for the deep-link params
var X21=(SP.get('x21')||'').trim().toUpperCase();                      // x21=U|L -> 21x21 URL case (U=UPPER, L=lower); overrides legacy u=1
var SEL=(SP.get('sel')||'').trim();                                    // sel=<N><EC><hole>[t] -> outline the stored selection
var EX=(SP.get('ex')||'').trim();                                      // ex=1 -> show extra tiles (ex=0 = don't); legacy hid=1
var HID=EX==='1';                                                      // ex=1 -> show extra tiles
var MIN=(V==='T'||V==='O'||V==='A');                                   // minimalistic (iframe) view
if(MIN)document.body.classList.add('vonly');
if(V==='T'||V==='t')document.body.classList.add('showtr');   // transparent
if(V==='A'||V==='a')document.body.classList.add('showall');           // show both variants
var FULLURL=/^(https?:\/\/|www\.)/i.test(x);   // x is a full URL -> normalise host, no aigap.no
var BASE=FULLURL?x.replace(/^https?:\/\//i,'').replace(/^www\./i,''):'aigap.no/'+x;
// 21 uses the 'www.' host, all other sizes use 'https://'
var ART=null;
function artFit(side,aW,aH,tr){   // destination rect for the art inside a side×side hole
  if(!(aW&&aH))return {sx:0,sy:0,sw:1,sh:1,x:0,y:0,w:side,h:side};
  if(!tr){var s=Math.min(aW,aH);return {sx:aW>aH?(aW-s)/2:0,sy:aH>aW?(aH-s)/2:0,sw:s,sh:s,x:0,y:0,w:side,h:side};}   // opaque: crop (cover)
  var r=Math.min(side/aW,side/aH),w=aW*r,h=aH*r;   // transparent: whole image, centred (contain)
  return {sx:0,sy:0,sw:aW,sh:aH,x:(side-w)/2,y:(side-h)/2,w:w,h:h};
}
function loadArt(u){return new Promise(function(res){var im=new Image();
  if(/^https?:\/\//i.test(u))im.crossOrigin='anonymous';   // allow pixel read if the server sends CORS
  im.onload=function(){res(im)};im.onerror=function(){res(null)};im.src=u;});}
var KEYTOL=1;   // per-channel slack around the exact most-used colour (0 = exact match only)
var KEYSHR=0.20; // skip the colour key unless the most-used colour covers >= this share of pixels
var COV={};      // hole -> alpha[] of the keyed art at hole x hole (per-module coverage)
var METGEN=0;    // bumped on each recalc; guards stale async byte-size results
var KEYED=null, KEYED_TRIED=false, KEYED_BLOCKED=false;
function keyed(){ // turn the most-used opaque colour transparent -- unless the art already has
                  // transparency, or no colour dominates (<KEYSHR); rule lives in qrmetrics.js
  if(KEYED_TRIED)return KEYED;
  KEYED_TRIED=true;
  if(!(ART&&ART.naturalWidth))return KEYED=null;
  try{KEYED=keyArt(ART,KEYTOL,KEYSHR);}
  catch(e){KEYED=null;KEYED_BLOCKED=true;}   // pixel access blocked -> keying unavailable
  return KEYED;
}
function coverageAlpha(hole){ // per-module alpha of the transparent overlay (0 = see-through, 255 = covers the module)
  if(hole in COV)return COV[hole];
  // colour-keyed art if the key was usable, otherwise the art's OWN alpha (already-transparent art)
  var k=keyed()||ART;
  if(!k||!(k.naturalWidth||k.width)){COV[hole]=null;return null;}
  var c=document.createElement('canvas');c.width=c.height=hole;var g=c.getContext('2d');
  var f=artFit(hole,k.naturalWidth||k.width,k.naturalHeight||k.height,true); // transparent variant: whole image, centred; rest of the hole stays transparent
  g.drawImage(k,f.sx,f.sy,f.sw,f.sh,f.x,f.y,f.w,f.h);
  var al=null;
  try{var d=g.getImageData(0,0,hole,hole).data;al=new Array(hole*hole);
    for(var i=0;i<hole*hole;i++)al[i]=d[i*4+3];}catch(e){al=null;KEYED_BLOCKED=true;}
  COV[hole]=al;return al;
}
function metricFor(N,ec,h,tr){ // erasure for the opaque (square hole) or transparent (coverage) variant
  if(tr&&h>0){var al=coverageAlpha(h);
    if(al){var lo=(N-h)>>1;
      return qrErasure(N,ec,function(r,c){if(r<lo||r>=lo+h||c<lo||c>=lo+h)return false;return al[(r-lo)*h+(c-lo)]>=128;});}}
  return qrHoleErase(N,ec,h);
}function showWarn(msg){var w=document.getElementById('warn');if(!w)return;w.textContent=msg;w.classList.add('on');
  try{console.warn('[qr] '+msg);}catch(e){}}
function whiteFn(N,h,tr){     // module is white (shows QR underneath) for the given variant
  var lo=(N-h)>>1;
  if(N===21&&h===9){          // the requested pattern: 9 of the 81 cells keep the QR (KEEP21)
    if(tr&&h>0){var al=coverageAlpha(h);if(al){
      return function(r,c){if(r<lo||r>=lo+h||c<lo||c>=lo+h||keep21(r,c))return false;
        return al[(r-lo)*h+(c-lo)]<128;};}}
    return function(r,c){return r>=lo&&r<lo+h&&c>=lo&&c<lo+h&&!keep21(r,c);};
  }
  if(tr&&h>0){var al2=coverageAlpha(h);if(al2){
    return function(r,c){if(r<lo||r>=lo+h||c<lo||c>=lo+h)return false;return al2[(r-lo)*h+(c-lo)]<128;};}}
  return function(r,c){return r>=lo&&r<lo+h&&c>=lo&&c<lo+h;};
}
// hole pattern / artwork keying / hole area: i/u/qrmetrics.js (shared with /_/r.js)
function repaint21(g,M,hole,S,mar){   // put those 9 cells back on top of the image
  var N=M.length,lo=(N-hole)>>1,off=(mar||0)*S;
  for(var r=lo;r<lo+hole;r++)for(var c=lo;c<lo+hole;c++)if(keep21(r,c)){
    g.fillStyle=M[r][c]?'#000':'#fff';g.fillRect(off+c*S,off+r*S,S,S);}
}
function recalcMetrics(){     // (re)compute erasure/colour for every tile from its own variant
  METGEN++;
  [].slice.call(document.querySelectorAll('.tpl')).forEach(function(el){
    var N=+el.dataset.size,ec=el.dataset.ec,h=+el.dataset.hole,tr=+el.dataset.tr;
    var na=tr&&h>0&&!coverageAlpha(h);   // transparent variant fell back (pixel access blocked)
    el.classList.toggle('trna',!!na);
    if(na)el.title='transparent unavailable: browser blocks reading image pixels (serve over http)';
    var q=metricFor(N,ec,h,tr);
    el.classList.remove('g','y','r');el.classList.add(q.col);
    el.dataset.er=q.erased;el.dataset.ecp=q.ecPer;el.dataset.pct=Math.round(100*q.erased/q.ecPer);
    el.querySelector('.er').textContent=(na?'\u26a0 ':'')+'erases '+q.erased+'/'+q.ecPer+' EC cw';
    el.querySelector('.sz').title='erases '+q.erased+' of '+q.ecPer+' EC codewords';
  });
}
var SIZ=[21,25,29],EC=['L','M','Q','H'],HOLES=[0,3,5,7,9];
var FIT={};   // size -> EC levels the payload actually fits (for this UP/mode)
var EB={L:7,M:15,Q:25,H:30};                       // EC error budget (% codewords)
var CAP={21:{L:17,M:14,Q:11,H:7},25:{L:32,M:26,Q:20,H:18},29:{L:53,M:42,Q:34,H:27}};
var GS=[21,25,29];                                 // grid sizes, index = g (0,1,2)
// recommended ec / hole per grid g and id-length c (from the layout tables)
var REC_EC=['MMLLL','QMMMLLL','HHHQQQQMMMMLLLLLLL'];
var REC_HOLE=[[5,5,5,5,5],[7,7,7,7,5,5,5],[9,9,9,7,7,7,7,5,5,5,5,5,5,5,5,5,5]];
var box=document.getElementById('box'),meta=document.getElementById('meta');
var UP=X21==='U';   // x21=U -> 21x21 URL UPPERCASE
function contentFor(N,up){var s=(N===21?'www.':'https://')+BASE;return (((up===undefined)?UP:up)&&N===21)?s.toUpperCase():s;}
function modeFor(s){return /^[0-9A-Z $%*+\-./:]+$/.test(s)?'Alphanumeric':'Byte';}   // uppercased URLs fit far more in 21x21
function fitOf(up){   // which EC levels fit each size for a given 21x case (the QR itself is case-dependent!)
  var f={21:[],25:[],29:[]};
  for(var N of SIZ)for(var ec of EC){try{matrixFor(N,ec,up);}catch(e){continue;}f[N].push(ec);}
  return f;}
function renderMeta(){ if(!x)return;   // show the EXACT strings that get encoded (mirrors contentFor)
  var a=contentFor(21),b=contentFor(25);
  meta.innerHTML='<b>'+x+'</b> &mdash; 21x21: <b>'+a+'</b> ['+modeFor(a)+'] &middot; 25/29: '+b+' ['+modeFor(b)+']';}
function titleTiles(){ [].slice.call(document.querySelectorAll('.tpl')).forEach(function(el){
  if(!el.classList.contains('trna'))el.title=contentFor(+el.dataset.size);}); }
function artStyle(N,h){var lo=((N-h)/2)|0;return 'left:'+(lo*100/N).toFixed(2)+'%;top:'+(lo*100/N).toFixed(2)+'%;width:'+(h*100/N).toFixed(2)+'%;height:'+(h*100/N).toFixed(2)+'%;';}
function matrixFor(N,ec,up){
  var s=contentFor(N,up);
  var qr=qrcode((N-17)/4, ec); qr.addData(s,modeFor(s)); qr.make();
  var n=qr.getModuleCount(),M=[];
  for(var r=0;r<n;r++){var row=[];for(var c=0;c<n;c++)row.push(qr.isDark(r,c));M.push(row);}
  return M;
}
function draw(M,hole,tr){
  var N=M.length, S=5, cv=document.createElement('canvas'); cv.width=cv.height=N*S;
  var g=cv.getContext('2d'); g.fillStyle='#fff';g.fillRect(0,0,cv.width,cv.height);
  g.fillStyle='#000';
  for(var y=0;y<N;y++)for(var xx=0;xx<N;xx++)if(M[y][xx])g.fillRect(xx*S,y*S,S,S);
  var a=(tr?keyed():null)||ART;
  if(hole&&a&&(a.naturalWidth||a.width)){var lo=(N-hole)>>1,p=lo*S,size=hole*S;
    var f=artFit(size,a.naturalWidth||a.width,a.naturalHeight||a.height,tr);
    if(!tr){g.fillStyle='#fff';g.fillRect(p,p,size,size);}   // opaque: the hole reads as a white block
    g.drawImage(a,f.sx,f.sy,f.sw,f.sh,p+f.x,p+f.y,f.w,f.h);
    if(N===21&&hole===9)repaint21(g,M,hole,S,0);}
  return cv;
}
function pngSize(cv){return new Promise(function(res){cv.toBlob(function(b){res(b?b.size:null);},'image/png');});}
function setHID(){document.body.classList.toggle('showred',HID);
  document.getElementById('showred').textContent=HID?'Hide extra':'Show hidden';markSel();updateDeep();}
document.getElementById('showred').onclick=function(){HID=!HID;setHID();};
setHID();
var TRS=document.body.classList.contains('showall')?2
        :(document.body.classList.contains('showtr')?1:0);   // derived from v= (showall All / showtr Transparent)
function setTRS(){document.body.classList.remove('showtr','showall');
  if(TRS===1)document.body.classList.add('showtr'); else if(TRS===2)document.body.classList.add('showall');
  document.getElementById('trtog').textContent=['Opaque','Transparent','All'][TRS];markRec();updateDeep();}
document.getElementById('trtog').onclick=function(){TRS=(TRS+1)%3;setTRS();};
setTRS();
function setCase(){document.getElementById('casetog').textContent=UP?'21xUpper':'21xLower';updateDeep();}
document.getElementById('casetog').onclick=function(){UP=!UP;setCase();
  renderMeta();                         // show the new encoded 21x21 string + mode
  if(x)buildGrid().then(titleTiles);    // capacity depends on mode -> rebuild the whole tile set
  if(ovCur){renderOv();document.querySelector('#ov .cap').textContent=contentFor(ovCur.N)+'  \u00b7  '+ovCur.N+' '+ovCur.ec+'  hole '+ovCur.h+(ovCur.tr?'  transparent':'')+'  \u00b7  click to close';}};
setCase();
function deepURL(){   // reconstruct the URL that reproduces the current UI state
  var p=new URLSearchParams();
  if(I)p.set('i',I);
  if(UP)p.set('x21','U');
  if(HID)p.set('ex','1');
  p.set('v',(MIN?['O','T','A']:['o','t','a'])[TRS]);   // ONE v= for Opaque/Transparent/All; UPPER = collapsed view
  if(SEL)p.set('sel',SEL);                             // stored selection (highlighted tile)
  if(x)p.set('x',x);                                   // x is always the LAST parameter
  var q=p.toString();
  return location.href.split(/[?#]/)[0]+(q?'?'+q:'');
}
function updateDeep(){   // (re)render the deep link under the image grid AND sync the address bar
  var d=document.getElementById('deep');
  if(!x){if(d)d.textContent='';return;}
  var u=deepURL();
  try{history.replaceState(null,'',u);}catch(e){}   // keep the address bar in step (no history entry)
  if(!d)return;
  d.textContent='deep link: ';
  var a=document.createElement('a');a.href=u;a.textContent=u;d.appendChild(a);
}
updateDeep();
var collBtn=document.getElementById('coll');
function setVonly(on){   // collapse = minimal view (only the recommended tiles); expand = full grid
  MIN=on;
  document.body.classList.toggle('vonly',MIN);
  setTRS();                                    // re-applies showtr/showall + re-lays out + syncs the deep link & address bar
  updateDeep();
  if(collBtn)collBtn.textContent=MIN?'\u25b8 expand':'\u25c2 collapse';   // label = the ACTION
}
function placeColl(){   // park the button on the far right, just below the orange (recommended) tiles
  if(!collBtn)return;
  var rc=document.getElementById('recs'),maxB=0;
  if(rc)[].slice.call(rc.children).forEach(function(t){var r=t.getBoundingClientRect();if(r.bottom>maxB)maxB=r.bottom;});
  collBtn.style.top=Math.max(4,maxB+6)+'px';
}
if(collBtn){
  if(!x)collBtn.style.display='none';
  collBtn.textContent=MIN?'\u25b8 expand':'\u25c2 collapse';
  collBtn.onclick=function(){setVonly(!MIN);};
}
window.addEventListener('resize',placeColl);
function redrawTiles(){
  [].slice.call(document.querySelectorAll('.tpl')).forEach(function(el){
    var N=+el.dataset.size,ec=el.dataset.ec,h=+el.dataset.hole,tr=+el.dataset.tr;
    try{var cv=draw(matrixFor(N,ec),h,tr),cn=el.querySelector('canvas');
      cn.width=cv.width;cn.height=cv.height;cn.getContext('2d').drawImage(cv,0,0);}catch(e){}
  });
}
if(!x){meta.textContent='No ?x=<id>. e.g. qr.html?x=bgda';}
else{(async function(){
  renderMeta();
  // overlay image: ?i=<basename|url> overrides; else art named after x (www./http x has none)
  var imgUrl=I?(/^https?:\/\//i.test(I)?I:('../'+(/\.[a-z0-9]+$/i.test(I)?I:I+'.png')))
              :(FULLURL?null:'../'+x+'.png');
  ART=imgUrl?await loadArt(imgUrl):null;
  if(ART&&!keyed()&&KEYED_BLOCKED)showWarn('Pixel access is blocked in this browser (file://), so the transparent variants cannot be scored from the artwork. Open the page over http (e.g. Live Server) to enable this.');
  await buildGrid();
  initOverlay();
})();}
async function buildGrid(){   // (re)generate the whole tile set for the current UP/mode (capacity depends on it)
  document.getElementById('recs').innerHTML='';   // drop previously promoted recommended tiles
  var tiles=[];FIT={21:[],25:[],29:[]};
  for(var N of SIZ){for(var ec of EC){
    try{ matrixFor(N,ec); }catch(e){ continue; }     // payload too big for this size+EC
    FIT[N].push(ec);
    for(var h of HOLES){for(var ti=0;ti<2;ti++){
      var tr=ti===1;
      if(tr&&(!ART||h===0))continue;       // transparent needs an overlay image
      var q=metricFor(N,ec,h,tr);          // opaque: square hole; transparent: image coverage
      var cv=draw(matrixFor(N,ec),h,tr);   // fresh matrix per hole+variant
      tiles.push({col:q.col,N:N,ec:ec,h:h,tr:tr,cv:cv,erased:q.erased,ecPer:q.ecPer});
    }}
  }}
  var frag='';
  for(var t of tiles){
    var pct=Math.round(100*t.erased/t.ecPer);
    frag+='<span class="tpl '+t.col+(t.tr?' trp':'')+'" title="'+contentFor(t.N)+'" data-size="'+t.N+'" data-ec="'+t.ec+'" data-hole="'+t.h+'" data-tr="'+(t.tr?1:0)+'" data-er="'+t.erased+'" data-ecp="'+t.ecPer+'" data-pct="'+pct+'">'
      +'<div class=sz></div>'
      +'<span class="q"><canvas></canvas></span>'
      +'<i>'+t.N+t.ec+t.h+(t.tr?' trans':'')+'</i>'
      +'<div class=er>erases '+t.erased+'/'+t.ecPer+' EC cw</div></span>';
  }
  box.innerHTML=frag||'<div class=legend>No combos fit this id.</div>';
  box.querySelectorAll('.tpl').forEach(function(el,i){var cn=el.querySelector('canvas'),g=cn.getContext('2d');
    cn.width=tiles[i].cv.width;cn.height=tiles[i].cv.height;g.drawImage(tiles[i].cv,0,0);});
  recalcMetrics();await loadSizes();markRec();dedup();sortTiles();   // bytes first (sort tie-break), then dedup + sort the grid
  postTiles();   // let a parent gallery (qrgallery.html) offer a selection dropdown
}
function lab(t){   // selection token: <N><EC><hole>[t][u]  (t=transparent, u=21x UPPERCASE host)
  var N=t.dataset.size;
  return N+t.dataset.ec+t.dataset.hole+(t.dataset.tr==='1'?'t':'')+((UP&&N==='21')?'u':'');}
var FITL=null,FITU=null;   // fit maps for the lower / upper 21x case (cached per id)
function postTiles(){   // publish what renders here so an embedding gallery stays in sync
  if(window.parent===window)return;
  try{
    if(!FITL)FITL=fitOf(false);
    if(!FITU)FITU=fitOf(true);
    var recs=[].slice.call(document.querySelectorAll('.tpl.rec')).map(lab);
    var tiles=[].slice.call(document.querySelectorAll('#box .tpl')).map(function(t){
      return {lab:lab(t),N:+t.dataset.size,ec:t.dataset.ec,h:+t.dataset.hole,tr:t.dataset.tr==='1',
              col:colorOf(t),pct:+t.dataset.pct};});
    window.parent.postMessage({type:'qr-tiles',x:x,sel:SEL,recs:recs,tiles:tiles,fit:FIT,fitL:FITL,fitU:FITU,up:UP},'*');
  }catch(e){}
}
function hintFor(){   // the stored variant is off screen -> the control that reveals it
  if(!SEL||!document.querySelector('.tpl'))return null;
  if(MIN)return 'coll';   // collapsed: #box is hidden and so is #tools, so expanding comes first
  var t=[].slice.call(document.querySelectorAll('.tpl')).filter(function(e){return lab(e)===SEL;})[0];
  if(!t)return /^21/.test(SEL)&&UP!==/[0-9]u$/.test(SEL)?'casetog':null;   // the label only exists in the other 21x case
  var trp=t.classList.contains('trp');
  if((trp&&TRS===0)||(!trp&&TRS===1))return 'trtog';
  if((t.classList.contains('r')||t.classList.contains('dup'))&&!HID)return 'showred';
  return null;
}
function markSel(){   // outline the variant stored in the DB (sel=); if it is off screen, mark the button to click
  var hit=null;
  [].slice.call(document.querySelectorAll('.tpl')).forEach(function(t){
    t.classList.remove('sel');
    if(SEL&&lab(t)===SEL&&t.getClientRects().length)hit=t;});
  var h=hit?null:hintFor();
  ['showred','trtog','casetog','coll'].forEach(function(i){
    document.getElementById(i).classList.toggle('need',i===h);});
  if(hit)hit.classList.add('sel');
}
// high-res render: S px per module + a quiet zone of `mar` white modules
function renderHi(N,ec,h,tr,mar){if(mar==null)mar=4;var S=40,M=matrixFor(N,ec);
  var D=(N+2*mar)*S,cv=document.createElement('canvas');cv.width=cv.height=D;
  var g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,D,D);g.fillStyle='#000';
  for(var y=0;y<N;y++)for(var xx=0;xx<N;xx++)if(M[y][xx])g.fillRect((mar+xx)*S,(mar+y)*S,S,S);
  var a=(tr?keyed():null)||ART;
  if(h&&a&&(a.naturalWidth||a.width)){var lo=(N-h)>>1,px=(mar+lo)*S,pw=h*S;
    var f=artFit(pw,a.naturalWidth||a.width,a.naturalHeight||a.height,tr);
    if(!tr){g.fillStyle='#fff';g.fillRect(px,px,pw,pw);}     // opaque: the hole reads as a white block
    g.drawImage(a,f.sx,f.sy,f.sw,f.sh,px+f.x,px+f.y,f.w,f.h);
    if(N===21&&h===9)repaint21(g,M,h,S,mar);}
  return cv;}
var ovCur=null,ovTpl=null,ovAt=0,ovX=0,ovY=0;
function renderOv(){if(!ovCur)return;var ov=document.getElementById('ov'),cv=renderHi(ovCur.N,ovCur.ec,ovCur.h,ovCur.tr);
  var c=ov.querySelector('canvas');c.width=cv.width;c.height=cv.height;c.getContext('2d').drawImage(cv,0,0);}
function pickTile(t){   // tell an embedding picker (dbAdm.html / qrgallery.html) which variant was chosen
  if(!x||window.parent===window)return;
  SEL=lab(t);markSel();
  window.parent.postMessage({type:'qr-pick',x:x,lab:SEL},'*');}
function showOv(t,e){var ov=document.getElementById('ov');
  ovCur={N:+t.dataset.size,ec:t.dataset.ec,h:+t.dataset.hole,tr:+t.dataset.tr};ovTpl=t;ovAt=Date.now();ovX=e.clientX;ovY=e.clientY;renderOv();
  ov.querySelector('.cap').textContent=contentFor(ovCur.N)+'  ·  '+ovCur.N+' '+ovCur.ec+'  hole '+ovCur.h+(ovCur.tr?'  transparent':'')+'  ·  click to close';
  ov.classList.add('on');}
function initOverlay(){var ov=document.getElementById('ov'),t1=null,tmo=null;
  document.addEventListener('click',function(e){   // 2nd click on the same tile = select it; a lone click opens the zoom 250ms later
    var t=e.target.closest?e.target.closest('.tpl'):null;
    if(!t)return;
    if(tmo&&t===t1){clearTimeout(tmo);tmo=null;return pickTile(t);}
    clearTimeout(tmo);t1=t;tmo=setTimeout(function(){tmo=null;showOv(t,e);},500);});
  ov.addEventListener('click',function(e){ov.classList.remove('on');   // slow double-click: its 2nd click lands on the zoom overlay
    if(ovTpl&&Date.now()-ovAt<500&&Math.abs(e.clientX-ovX)<8&&Math.abs(e.clientY-ovY)<8)pickTile(ovTpl);});
  window.addEventListener('keydown',function(e){if(e.key==='Escape')ov.classList.remove('on');});}
function colorOf(t){return t.classList.contains('g')?'g':(t.classList.contains('y')?'y':(t.classList.contains('r')?'r':null));}
function markRec(){ // orange-border the recommended (ec,hole) per grid for this id length
  if(!x)return;
  var c=(FULLURL?BASE:x).length;   // key off the normalised host, not the raw x (www./https:// differ)
  for(var g=0;g<3;g++){
    var ec=(REC_EC[g]||'')[c]||null, hole=REC_HOLE[g]?.[c]??null;
    if(ec==null||hole==null)continue;
    [].slice.call(document.querySelectorAll('#box .tpl')).forEach(function(t){
      if(+t.dataset.size===GS[g]&&t.dataset.ec===ec&&+t.dataset.hole===hole){
        t.classList.add('rec');
        t.classList.remove('dup','r');   // always show it, highlighted orange
      }});
  }
  // move the recommended tiles into the fixed top-right corner
  var rc=document.getElementById('recs'); if(!rc)return;
  var recs=[].slice.call(document.querySelectorAll('.tpl.rec'));   // document-wide: they move from #box to #recs
  var ops=recs.filter(function(t){return !t.classList.contains('trp');});
  var trs=recs.filter(function(t){return t.classList.contains('trp');});
  if(MIN){                          // minimal view: unit-spaced row (All -> 6 tiles, else 3)
    var per=(TRS===2)?37:19;
    [ops,trs].forEach(function(arr){arr.forEach(function(t,i){
      var idx=(TRS===2)?(i+(t.classList.contains('trp')?3:0)):i;
      t.style.left=(100*(1+6*idx)/per).toFixed(3)+'vw';
      t.style.top =(100/per).toFixed(3)+'vw';
      t.style.width=(500/per).toFixed(3)+'vw';
      rc.appendChild(t);
    });});
  }else{                            // normal: one SMALL row filling the right half, with space around
    ops.concat(trs).forEach(function(t){rc.appendChild(t);});
    layoutExpanded();
  }
  upgradeRec();  // give the recommended tiles a high-res render (crisp when enlarged + printable)
  placeColl();   // keep the collapse button just below the recommended tiles
  markSel();     // outline the stored selection
}
function upgradeRec(){   // recommended tiles: high-res S=40 BORDERLESS render (no quiet zone) so the centre art stays sharp
  [].slice.call(document.querySelectorAll('#recs .tpl')).forEach(function(t){
    if(t.dataset.hi)return;
    var cv; try{cv=renderHi(+t.dataset.size,t.dataset.ec,+t.dataset.hole,+t.dataset.tr,0);}catch(e){return;}
    var cn=t.querySelector('canvas'); cn.width=cv.width; cn.height=cv.height; cn.getContext('2d').drawImage(cv,0,0);
    t.dataset.hi='1';   // re-render on each toggle too: cheap for ~3-6 tiles
  });
}
function layoutExpanded(){   // tight row of the VISIBLE recommended tiles, right-aligned into the top-right corner
  var rc=document.getElementById('recs'); if(!rc)return;
  var vis=[].slice.call(rc.children).filter(function(t){return getComputedStyle(t).display!=='none';});
  if(!vis.length)return;
  var w=4.5,gap=w*0.5,mright=1.5,pitch=w+gap,rightmost=100-mright-w;   // 4.5vw tile, half-tile gap, 1.5vw margin
  vis.forEach(function(t,k){t.style.width=w+'vw';t.style.top='1vh';
    t.style.left=(rightmost-(vis.length-1-k)*pitch).toFixed(3)+'vw';});   // last tile hugs the right edge
}
function tileCmp(a,b){            // sort: size asc, hole desc, err% asc, transparent first, filesize desc
  var A=+a.dataset.size,B=+b.dataset.size; if(A!==B)return A-B;
  var h=(+b.dataset.hole)-(+a.dataset.hole); if(h)return h;
  var e=(+a.dataset.pct)-(+b.dataset.pct); if(e)return e;
  var t=(b.dataset.tr==='1'?1:0)-(a.dataset.tr==='1'?1:0); if(t)return t;
  return (+b.dataset.bytes||0)-(+a.dataset.bytes||0);
}
function sortTiles(){             // order the grid by the same sort used to pick the best
  [].slice.call(box.querySelectorAll('.tpl')).sort(tileCmp).forEach(function(t){box.appendChild(t);});
}
function dedup(){var rep={};
  var all=[].slice.call(document.querySelectorAll('#box .tpl'));
  all.forEach(function(t){t.classList.remove('dup');});
  all.forEach(function(t){var col=colorOf(t);if(!col)return;
    var k=t.dataset.size+'-'+col+'-'+(t.dataset.tr||0);
    if(!(k in rep)||tileCmp(t,rep[k])<0)rep[k]=t;});   // first in sort order = best
  all.forEach(function(t){var col=colorOf(t);if(!col)return;
    var k=t.dataset.size+'-'+col+'-'+(t.dataset.tr||0); if(rep[k]!==t)t.classList.add('dup');});}
function loadSizes(){ // real 1-bit indexed PNG size, and the filesize tie-break for sorting
  return Promise.all([].slice.call(document.querySelectorAll('.tpl')).map(function(t){
    var N=+t.dataset.size, ec=t.dataset.ec, h=+t.dataset.hole, M;
    try{ M=matrixFor(N,ec); }catch(e){ return null; }
    var g=METGEN;
    return palettePngBytes(N,function(y,x){return M[y][x];},whiteFn(N,h,+t.dataset.tr)).then(function(sz){
      if(g!==METGEN)return;            // a newer recalc superseded this one
      t.dataset.bytes=sz;
      var el=t.querySelector('.sz'); if(!el)return;
      el.textContent=sz+'B / e:'+t.dataset.pct+'%';
      el.title='erases '+t.dataset.er+' of '+t.dataset.ecp+' EC codewords';});
  }));
}
