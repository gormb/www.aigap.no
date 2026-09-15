const qr=async(x,N,ec,u)=>{window.qrcode||await new Promise((r,j)=>(s=document.createElement("script"),s.src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",s.onload=r,s.onerror=j,document.head.appendChild(s)));
  const c=(N===21?'www.aigap.no/':'https://aigap.no/')+x,mk=m=>{const d=m?c.toUpperCase():c,q=qrcode((N-17)/4,ec);q.addData(d,/^[0-9A-Z $%*+\-./:]+$/.test(d)?'Alphanumeric':'Byte');q.make();
    const n=q.getModuleCount(),cv=document.createElement('canvas');cv.width=cv.height=n;const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,n,n);g.fillStyle='#000';
    for(let y=0;y<n;y++)for(let xx=0;xx<n;xx++)if(q.isDark(y,xx))g.fillRect(xx,y,1,1);return cv.toDataURL()};
  try{return mk(u)}catch(e){if(u||N!==21)throw e;return mk(1)}}
,go=(p,k,u)=>{p.delete(k);
  s=p.toString();
  window.location.replace(u+(s?(u.includes("?")?"&":"?")+s:"")+(location.hash&&!u.includes('#')?location.hash:''))
}
,rh={apikey:SUPABASE.publishableKey,'Authorization':'Bearer '+SUPABASE.publishableKey}
,dbL=async k=>{if(!k||!/^[A-Za-z0-9]+$/.test(k)||SUPABASE.url.includes('YOUR-'))return null;try{const r=await(await fetch(SUPABASE.url+"/rest/v1/redir?select=id,url&or=(id.eq."+k+",id.ilike."+k+")",{headers:rh})).json();if(!Array.isArray(r))return null;const e=r.find(x=>x.id===k);return (e||(r.length===1?r[0]:null)||{}).url||null}catch(e){return null}}
,dbA=async()=>{if(SUPABASE.url.includes('YOUR-'))return[];const r=await fetch(SUPABASE.url+"/rest/v1/redir?select=id,\"desc\",\"group\",sort,present,qr&order=sort.asc,id.asc",{headers:rh});if(!r.ok)throw new Error(r.status);const a=await r.json();if(!Array.isArray(a))throw new Error('bad');return a}
,phT="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
,hp=async (u='https://aigap.no/h.html')=>{if(!window.keep21)await new Promise((r,j)=>{const s=document.createElement('script');s.src='/i/u/qrmetrics.js?v=2';s.onload=r;s.onerror=j;document.head.appendChild(s)});
const out=document.createElement('div');document.body.appendChild(out);
  out.insertAdjacentHTML('beforeend'
    ,`<div style="height:30vw;left:2vw;top:2vw">
    <a href="mailto:gorm@aigap.no"><h4>&nbsp;&nbsp;Gorm Braarvig&nbsp;&nbsp;&nbsp;</h4></a>
    &nbsp;&nbsp;<img src="i/png.png" style="height:15vw">
    <p>&nbsp;&nbsp;&nbsp;<a href="${u}">https://aigap.no</div>`);
  let g,pg,n=0,t=null,tr=null;
  const row=()=>{tr=document.createElement('tr');t.appendChild(tr)}
  let db;try{db=await dbA()}catch(e){out.insertAdjacentHTML('beforeend','<h2>Could not load data</h2>');return}if(!db)return;const rows=db.filter(r=>r.present!=='none');let Q=Promise.resolve();for(const r of rows){const x=r.id;if(r.group)g=r.group;if(g&&g!==pg){out.insertAdjacentHTML('beforeend',`<h2><hr>${g}</h2>`);t=document.createElement('table');out.appendChild(t);row();pg=g;n=0}else if(n&&n%5===0)row();if(!t){t=document.createElement('table');out.appendChild(t);row()}const td=document.createElement('td');td.innerHTML=r.present==='qr'?`<br><a href="?${x}"><span style="display:block;position:relative;width:15vw;height:15vw"><img loading="eager" src="${phT}" style="display:block;width:15vw;height:15vw"></span><br>${r.desc||x}</a>`:`<br><a href="?${x}"><img loading="lazy" src="i/${x}.png" style="width:15vw"><br>${r.desc||x}</a>`;tr.appendChild(td);if(r.present==='qr'){const im=td.querySelector('img'),q=r.qr||'',f=q?'i/'+x+'.'+q+'.png':'',N=+q.slice(0,2)||21,ec=q[2]||'L',h=+q[3]||0,T=/t/.test(q),U=/u$/.test(q);let k=0;
  const rt=()=>{console.warn('OPTIMIZE QR','run-time generation for '+x,q?'token '+q:'no token in the DB','pre-generate to drop the qrcode-generator CDN: python3 i/u/qrgen.py '+x,'(then check the png in)');Q=Q.then(()=>qr(x,N,ec,U).then(s=>{im.onerror=null;im.src=s}).catch(()=>{im.onerror=null;im.style.visibility='hidden';console.warn('OPTIMIZE QR','no QR for '+x,'neither '+(f||'a pre-generated png')+' nor the in-browser generator worked')}))}
  ,nx=()=>{k++;if(k===1&&f)return void(im.src=f);if(k>2){im.onerror=null;im.style.visibility='hidden';return}
    if(q)console.warn('OPTIMIZE QR',f+' not pre-generated','execute: python3 i/u/qrgen.py '+x,'on the client and check the png in');else console.warn('OPTIMIZE QR',x+' has no qr token','pick one in i/u/qrgallery.html');rt()};
  im.onload=()=>{if(h&&im.naturalWidth>20&&im.naturalWidth<42)art(im,x,h,T)};im.onerror=nx;nx()}else{const im=td.querySelector('img');if(im)im.onerror=()=>im.src=phT}n++}}
,p=new URLSearchParams(location.search); 
function cut(im,h,lo){                                  // 21x21 h9: the kept modules, cut out of the code
  const c=document.createElement('canvas');c.width=c.height=h,g=c.getContext('2d');
  g.drawImage(im,lo,lo,h,h,0,0,h,h);
  g.globalCompositeOperation='destination-out';
  for(let y=0;y<h;y++)for(let x=0;x<h;x++)if(!keep21(y+lo,x+lo))g.fillRect(x,y,1,1);
  return c.toDataURL()}
function key(a){try{const k=keyArt(a,1,0.20);return k?k.toDataURL():a.src}catch(e){return a.src}}
function art(im,i,h,tr){const s=(100*artSide(im.naturalWidth,h)).toFixed(2)+'%',L=document.createElement('img');L.className='ov';L.loading='lazy';L.style.width=s;L.style.height=s;L.style.objectFit=tr?'contain':'cover';L.onerror=()=>{L.remove();console.warn('OPTIMIZE QR','art i/'+i+'.png not there','the '+h+'-module hole stays white: add the art image or pick a hole-0 variant in i/u/qrgallery.html')};L.onload=()=>{L.onload=null;if(tr)L.src=key(L)};L.src='i/'+i+'.png';im.parentElement.appendChild(L);
  if(im.naturalWidth===21&&h===9){const lo=(21-h)>>1,K=document.createElement('img');K.className='ov';K.style.width=s;K.style.height=s;K.style.imageRendering='pixelated';K.src=cut(im,h,lo);im.parentElement.appendChild(K)}}
(async()=>{
  let k=[...p.keys()][0]
  if(!k){logVisit(k||'', '');hp() ;return}
  let u;try{u=await dbL(k)}catch(e){u=null}
  if(u){logVisit(k,u);go(p,k,u)}else{logVisit(k||'', '');hp()}
})()