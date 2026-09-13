const qr=async(x,I=1)=>{window.QRCodeStyling||await new Promise((r,j)=>(s=document.createElement("script"),s.src="https://unpkg.com/qr-code-styling@1.5.0/lib/qr-code-styling.js",s.onload=r,s.onerror=j,document.head.appendChild(s)));const o={width:300,height:300,qrOptions:{errorCorrectionLevel:'M'},data:"https://aigap.no/"+x,imageOptions:{margin:0}};if(I){if(await new Promise(res=>{const i=new Image();i.onload=()=>res(1);i.onerror=()=>res(0);i.src='i/'+x+'.png'}))o.image='i/'+x+'.png';else o.image=phW}console.log('[QR] id='+x+' | URL sent to library="'+o.data+'" | errorCorrectionLevel='+o.qrOptions.errorCorrectionLevel);return URL.createObjectURL(await new window.QRCodeStyling(o).getRawData('png'))}
,go=(p,k,u)=>{p.delete(k);
  s=p.toString();
  window.location.replace(u+(s?(u.includes("?")?"&":"?")+s:"")+(location.hash&&!u.includes('#')?location.hash:''))
}
,rh={apikey:SUPABASE.publishableKey,'Authorization':'Bearer '+SUPABASE.publishableKey}
,dbL=async k=>{if(!k||!/^[A-Za-z0-9]+$/.test(k)||SUPABASE.url.includes('YOUR-'))return null;try{const r=await(await fetch(SUPABASE.url+"/rest/v1/redir?select=id,url&or=(id.eq."+k+",id.ilike."+k+")",{headers:rh})).json();if(!Array.isArray(r))return null;const e=r.find(x=>x.id===k);return (e||(r.length===1?r[0]:null)||{}).url||null}catch(e){return null}}
,dbA=async()=>{if(SUPABASE.url.includes('YOUR-'))return[];const r=await fetch(SUPABASE.url+"/rest/v1/redir?select=id,\"desc\",\"group\",sort,present&order=sort.asc,id.asc",{headers:rh});if(!r.ok)throw new Error(r.status);const a=await r.json();if(!Array.isArray(a))throw new Error('bad');return a}
,phT="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
,phW="i/w.png"
,hp=async u=>{const out=document.createElement('div');document.body.appendChild(out);
  out.insertAdjacentHTML('beforeend',`<table border="0"><tr><td colspan=6><a href="${u}"><img src="i/png.png" style="height:20vw"><br>gormb.github.io/_</a></td><td><h1>Gorm Braarvig</h1><a href="mailto:gorm@aigap.no">gorm@aigap.no</a></td></tr></table>`);
  let g,pg,n=0,t=null,tr=null;
  const row=()=>{tr=document.createElement('tr');t.appendChild(tr)}
  let db;try{db=await dbA()}catch(e){out.insertAdjacentHTML('beforeend','<h2>Could not load data</h2>');return}if(!db)return;const rows=db.filter(r=>r.present!=='none');let Q=Promise.resolve();for(const r of rows){const x=r.id;if(r.group)g=r.group;if(g&&g!==pg){out.insertAdjacentHTML('beforeend',`<h2><hr>${g}</h2>`);t=document.createElement('table');t.setAttribute('border','0');out.appendChild(t);row();pg=g;n=0}else if(n&&n%10===0)row();if(!t){t=document.createElement('table');t.setAttribute('border','0');out.appendChild(t);row()}const td=document.createElement('td');td.innerHTML=r.present==='qr'?`<br><a href="?${x}"><span style="display:block;position:relative;width:15vw;height:15vw"><img loading="eager" src="${phT}" style="display:block;width:15vw;height:15vw"></span><br>${r.desc||x}</a>`:`<br><a href="?${x}"><img loading="lazy" src="i/${x}.png" style="width:16vw"><br>${r.desc||x}</a>`;tr.appendChild(td);if(r.present==='qr'){const im=td.querySelector('img'),a=['i/'+x+'.qr1.png','i/'+x+'.qr.png'];let n=0;im.onload=()=>{if(im.naturalWidth>=21&&im.naturalWidth<=41)hpC(im,x)};im.onerror=()=>{if(n<a.length-1)im.src=a[++n];else{im.onerror=null;Q=Q.then(()=>qr(x).then(s=>im.src=s).catch(()=>qr(x,0).then(s=>im.src=s).catch(()=>{im.style.visibility='hidden'})))}};im.src=a[0]}else{const im=td.querySelector('img');if(im)im.onerror=()=>im.src=phT}n++}}
,hpC=(im,i)=>{const L=document.createElement('img');L.loading='lazy';L.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:31%;padding:0;z-index:2;image-rendering:auto;pointer-events:none';L.onerror=()=>L.src=phW;L.src='i/'+i+'.png';im.parentElement.appendChild(L)}
,p=new URLSearchParams(location.search); 
(async()=>{
  let k=[...p.keys()][0]
  if(!k){logVisit(k||'', '');hp("https://gormb.github.io/_") ;return}
  let u;try{u=await dbL(k)}catch(e){u=null}
  if(u){logVisit(k,u);go(p,k,u)}else{logVisit(k||'', '');hp("https://gormb.github.io/_")}
})()