let _db;const db=()=>_db||(_db=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm').then(m=>m.createClient(SUPABASE.url,SUPABASE.publishableKey))); // single client (avoid "Multiple GoTrueClient instances")
const iso=v=>v&&new Date(new Date(v).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
const utc=v=>v?new Date(v).toISOString():null; // datetime-local (local time) → correct UTC for Supabase
const stat=r=>{const n=Date.now(),f=new Date(r.dtfrom).getTime(),t=new Date(r.dtto).getTime();
  return n<f?['ok','waiting']:n>t?['exp','expired']:(t-n<7*864e5?['soon','expiring soon']:['ok','active'])};
const gridEl=document.getElementById('grid');
const grid=async()=>{const{data,error}=await (await db()).from('codes').select('*').order('dtfrom',{ascending:false});
  if(error){gridEl.innerHTML=`<p class="exp">${error.message}</p>`;return}
  // used per code: unique devices that activated the code (premium_activate)
  const{data:usage}=await (await db()).from('usage').select('code_id,fingerprint').eq('event','premium_activate');
  const useCount={};(usage||[]).forEach(u=>{const k=u.code_id||'—';(useCount[k]=useCount[k]||new Set()).add(u.fingerprint)});
  gridEl.innerHTML=`<table><tr><th>code</th><th>book</th><th>emails</th><th>limit</th><th>usage</th><th>from</th><th>to</th><th>status</th><th></th></tr>`+(data||[]).map(r=>{
    const[c,label]=stat(r), used=useCount[r.code]?.size||0;
    return `<tr><td>${r.code}</td><td>${r.book||'—'}</td><td>${(r.mails||'').split(',').filter(Boolean).map(m=>m.trim()).join('<br>')||'—'}</td>
      <td>${r.use_limit??'∞'}</td><td class="${r.use_limit!=null&&used>=r.use_limit?'exp':'ok'}">${used}/${r.use_limit??'∞'}</td>
      <td>${(r.dtfrom||'').slice(0,16)}</td><td>${(r.dtto||'').slice(0,16)}</td>
      <td class="${c}">${label}</td>
      <td><button onclick="edit('${r.code}')">✎</button> <button onclick="resetUsage('${r.code}')" title="tøm bruk">🧹</button> <button onclick="del('${r.code}')">×</button></td></tr>`}).join('')+'</table>'||'<p>(empty)</p>'};
window.resetUsage=async c=>{if(confirm('Tøm all bruk (usage) for '+c+'?')){await (await db()).from('usage').delete().eq('code_id',c);grid()}};
window.resetF=()=>{f.reset();code.value='';dtFrom.value=iso(Date.now());dtTo.value='2099-12-31T23:59'};
window.edit=async c=>{const{data}=await (await db()).from('codes').select('*').eq('code',c).single();
  if(data){code.value=data.code;c_book.value=data.book||'';c_limit.value=data.use_limit??'';dtFrom.value=iso(data.dtfrom);dtTo.value=iso(data.dtto);mails.value=data.mails||''}};
window.del=async c=>{if(confirm('Delete '+c+'?')){await (await db()).from('codes').delete().eq('code',c);grid()}};
window.save=async e=>{e.preventDefault();
      await (await db()).from('codes').upsert({code:code.value.trim(),book:c_book.value.trim(),use_limit:c_limit.value!==''?+c_limit.value:null,dtfrom:utc(dtFrom.value)||new Date().toISOString(),dtto:utc(dtTo.value)||'2099-12-31T23:59:59Z',mails:mails.value.trim()});
  resetF();grid()};
resetF();grid();

// === books (auto-deploy links) ===
const gridBEl=document.getElementById('gridB');
// deployed-field color from public.log (k='sync'|'sync_error'): ok=green (last run ok),
// soon=yellow (last failed but an earlier ok exists), exp=red (never ok, or empty log)
const gridB=async()=>{const{data,error}=await (await db()).from('books').select('*').order('book',{ascending:true});
  if(error){gridBEl.innerHTML=`<p class="exp">${error.message}</p>`;return}
  const{data:logs}=await (await db()).from('log').select('u,k,ts').in('k',['sync','sync_error']).order('ts',{ascending:true});
  const hist={};(logs||[]).forEach(r=>{(hist[r.u]=hist[r.u]||[]).push(r)});
  const st=u=>{const a=hist[u]||[];if(!a.length)return ['exp','aldri ok / tom logg'];const last=a[a.length-1];
    return last.k==='sync'?['ok','siste synk ok']:(a.some(x=>x.k==='sync')?['soon','siste synk feilet (tidligere ok)']:['exp','aldri ok'])};
  gridBEl.innerHTML=(data||[]).length?`<table><tr><th>book</th><th>deployed</th><th>prod</th><th>autosync from</th><th>autosync to</th><th>premCheck (s)</th><th></th></tr>`+data.map(r=>{const[c,tip]=st(r.book);
    return `<tr><td>${r.book}</td><td>${r.deployed?`<a class="${c}" title="${tip}" href="https://aigap.no/b?book=${encodeURIComponent(r.deployed)}" target="_blank">${r.deployed}</a>`:'—'}</td><td>${r.prod?`<a href="${r.prod}" target="_blank">link</a>`:'—'}</td>
      <td>${(r.dtautosyncfrom||'').slice(0,16)||'—'}</td><td>${(r.dtautosyncto||'').slice(0,16)||'—'}</td>
      <td>${r.premiumCheckInterval??60}</td>
      <td><button onclick="editB('${r.book}')">✎</button> <button onclick="bookLog('${r.book}')" title="siste synk">⏱</button> <button onclick="delB('${r.book}')">×</button></td></tr>`}).join('')+'</table>':'<p>(empty)</p>'}
window.resetB=()=>{fB.reset()}
window.editB=async b=>{const{data}=await (await db()).from('books').select('*').eq('book',b).single();
  if(data){b_book.value=data.book;b_deployed.value=data.deployed||'';b_prod.value=data.prod||'';b_dtFrom.value=iso(data.dtautosyncfrom)||'';b_dtTo.value=iso(data.dtautosyncto)||'';b_premInt.value=data.premiumCheckInterval??''}}
window.delB=async b=>{if(confirm('Delete '+b+'?')){await (await db()).from('books').delete().eq('book',b);gridB()}}
window.saveB=async e=>{e.preventDefault();
  await (await db()).from('books').upsert({book:b_book.value.trim(),deployed:b_deployed.value.trim(),prod:b_prod.value.trim(),dtautosyncfrom:utc(b_dtFrom.value),dtautosyncto:utc(b_dtTo.value),premiumCheckInterval:b_premInt.value!==''?+b_premInt.value:60});
  resetB();gridB()}
resetB();gridB();
// === book_versions (visningsnavn per bok / språk – driver bokvelgeren i leseren) ===
const gridVEl=document.getElementById('gridV');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); // text cells
const q=s=>String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); // inside onclick="...('...')"
const gridV=async()=>{const{data,error}=await (await db()).from('book_versions').select('*').order('book',{ascending:true}).order('version',{ascending:true});
  if(error){gridVEl.innerHTML=`<p class="exp">${error.message}</p>`;return}
  gridVEl.innerHTML=(data||[]).length?`<table><tr><th>book</th><th>version</th><th>name</th><th>description</th><th></th></tr>`+data.map(r=>
    `<tr><td>${esc(r.book)}</td><td>${esc(r.version)}</td><td>${esc(r.name)}</td><td>${esc(r.description)}</td>
     <td><button onclick="editV('${q(r.book)}','${q(r.version)}')">✎</button> <button onclick="delV('${q(r.book)}','${q(r.version)}')">×</button></td></tr>`).join('')+'</table>':'<p>(empty)</p>'}
window.resetV=()=>{fV.reset()}
window.editV=async(b,v)=>{const{data}=await (await db()).from('book_versions').select('*').eq('book',b).eq('version',v).single();
  if(data){v_book.value=data.book;v_version.value=data.version;v_name.value=data.name||'';v_desc.value=data.description||''}}
window.delV=async(b,v)=>{if(confirm(`Delete ${b}/${v}?`)){await (await db()).from('book_versions').delete().eq('book',b).eq('version',v);gridV()}}
window.saveV=async e=>{e.preventDefault();
  await (await db()).from('book_versions').upsert({book:v_book.value.trim(),version:v_version.value.trim(),name:v_name.value.trim(),description:v_desc.value.trim()});
  resetV();gridV()}
resetV();gridV();
// === book_variant (varianter per book, gir EN+NO og FREE+PREM) ===
const gridVrEl=document.getElementById('gridVr');
const vrUrl=r=>`https://aigap.no/b/_r/?book=../${r.book}/${r.variant}/${r.variant}.pdf`; // leseren ligger i /b/_r/, så ../ = /b/
const gridVr=async()=>{const{data,error}=await (await db()).from('book_variant').select('*').order('book',{ascending:true}).order('variant',{ascending:true});
  if(error){gridVrEl.innerHTML=`<p class="exp">${error.message}</p>`;return}
  gridVrEl.innerHTML=(data||[]).length?`<table><tr><th>book</th><th>variant</th><th>title_no</th><th>title_en</th><th>description</th><th>from</th><th>to</th><th>viewer</th><th></th></tr>`+data.map(r=>
    `<tr><td>${esc(r.book)}</td><td>${esc(r.variant)}</td><td>${esc(r.title_no)}</td><td>${esc(r.title_en)}</td><td>${esc(r.description)}</td>
     <td>${(r.dtfrom||'').slice(0,16)}</td><td>${(r.dtto||'').slice(0,16)}</td>
     <td><a href="${vrUrl(r)}" target="_blank" title="åpne varianten i leseren">View ↗</a></td>
     <td><button onclick="buildVr('${q(r.book)}','${q(r.variant)}')" title="bygg varianten som md + pdf (GitHub Actions)">Create</button> <button onclick="editVr('${q(r.book)}','${q(r.variant)}')">✎</button> <button onclick="delVr('${q(r.book)}','${q(r.variant)}')">×</button></td></tr>`).join('')+'</table>':'<p>(empty)</p>'}
window.resetVr=()=>{fVr.reset();vr_dtFrom.value=iso(Date.now());vr_dtTo.value='2099-12-31T23:59'}
window.editVr=async(b,v)=>{const{data}=await (await db()).from('book_variant').select('*').eq('book',b).eq('variant',v).single();
  if(data){vr_book.value=data.book;vr_variant.value=data.variant;vr_title_no.value=data.title_no||'';vr_title_en.value=data.title_en||'';vr_desc.value=data.description||'';vr_dtFrom.value=iso(data.dtfrom)||'';vr_dtTo.value=iso(data.dtto)||''}}
window.delVr=async(b,v)=>{if(confirm(`Delete ${b}/${v}?`)){await (await db()).from('book_variant').delete().eq('book',b).eq('variant',v);gridVr()}}
window.saveVr=async e=>{e.preventDefault();
  await (await db()).from('book_variant').upsert({book:vr_book.value.trim(),variant:vr_variant.value.trim(),title_no:vr_title_no.value.trim(),title_en:vr_title_en.value.trim(),description:vr_desc.value.trim(),dtfrom:utc(vr_dtFrom.value)||new Date().toISOString(),dtto:utc(vr_dtTo.value)||'2099-12-31T23:59:59Z'});
  resetVr();gridVr()}
// Create: dispatcher build-variant.yml – den skriver b/<book>/<variant>/<variant>.{md,pdf} og committer
const vrMsg=h=>{const e=document.getElementById('vrMsg');if(e)e.innerHTML=h};
window.buildVr=async(b,v)=>{
  vrMsg(`${esc(v)}: dispatcher …`);
  try{
    const{data,error}=await (await db()).from('cfg').select('val').eq('id','ghtoken').single();
    if(error||!(data&&data.val))throw new Error('mangler cfg-rad id=ghtoken (GitHub-token med Actions: write)');
    const r=await fetch('https://api.github.com/repos/gormb/www.aigap.no/actions/workflows/build-variant.yml/dispatches',{
      method:'POST',
      headers:{Authorization:'Bearer '+data.val,Accept:'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({ref:'main',inputs:{book:b,variant:v}})});
    if(r.status!==204)throw new Error('github: '+((await r.json().catch(()=>({}))).message||r.status));
    vrMsg(`${esc(v)}: bygg startet → <a href="https://github.com/gormb/www.aigap.no/actions/workflows/build-variant.yml" target="_blank">se kjøringen ↗</a> · skriver b/${esc(b)}/${esc(v)}/<b>${esc(v)}</b>.md + .pdf`);
  }catch(e){vrMsg(`${esc(v)}: ${esc(e.message)}`)}
};
resetVr();gridVr();
// === usage (logg) – gruppert (bok → kode) og utvidbar ===
const gridUEl=document.getElementById('gridU');
const gridU=async()=>{const{data,error}=await (await db()).from('usage').select('*,codes(code)').order('created_at',{ascending:false}).limit(1000);
  if(error){gridUEl.innerHTML=`<p class="exp">${error.message}</p>`;return}
  if(!(data||[]).length){gridUEl.innerHTML='<p>(empty)</p>';return}
  const byBook={};
  (data||[]).forEach(r=>{(byBook[r.book||'(ingen bok)']=byBook[r.book||'(ingen bok)']||[]).push(r)});
  const byCode=rows=>{const g={};rows.forEach(r=>{const k=r.codes?.code||r.code_id||'—';(g[k]=g[k]||[]).push(r)});return Object.entries(g)};
  gridUEl.innerHTML=Object.entries(byBook).map(([b,rows])=>`<details><summary>📖 ${b} — ${rows.length}</summary>`+
    byCode(rows).map(([c,cr])=>`<details style="margin-left:1.2em"><summary>🔑 ${c} — ${cr.length}</summary>`+
      cr.map(r=>`<div style="margin-left:2em">${(r.created_at||'').slice(0,16)} · ${r.event||''} · p${r.page??''} · ${(r.fingerprint||'').slice(0,8)}</div>`).join('')
    +`</details>`).join('')+`</details>`).join('')};
gridU();

// === book sync result (public.log) – per-book ⏱ button in the books grid ===
window.bookLog=async b=>{const el=document.getElementById('bLog');
  const{data,error}=await (await db()).from('log').select('*').eq('u',b).in('k',['sync','sync_error']).order('ts',{ascending:false}).limit(10);
  if(error){el.innerHTML=`<p class="exp">${error.message}</p>`;return}
  el.innerHTML=`<p><b>${b}</b> – siste synk</p>`+(!(data||[]).length?'<p>(empty)</p>':
    `<table><tr><th>ts</th><th></th><th>kind</th><th>msg</th></tr>`+
    data.map(r=>`<tr><td>${(r.ts||'').slice(0,16).replace('T',' ')}</td><td class="${r.k==='sync'?'ok':'exp'}">${r.k==='sync'?'✓':'✗'}</td><td>${(r.d&&r.d.kind)||''}</td><td>${(r.d&&r.d.msg)||''}</td></tr>`).join('')+`</table>`);};

// === book_chapter (TOC per variant; drag subchapters between variants, Ctrl/⌘ = copy) ===
const tcBoardEl=document.getElementById('tcBoard'),tcMsgEl=document.getElementById('tc_msg');
const TC_UNPLACED='LddUnplaced';
let tcBook='LifeDemandedDeath',tcRows=[],tcChapters=[],tcPool=[],tcUnplacedName='Uplassert og ubestemt',tcMods=false;
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey)tcMods=true});
document.addEventListener('keyup',e=>{if(!e.ctrlKey&&!e.metaKey)tcMods=false});
const tcNorm=s=>String(s||'').replace(/[\u201c\u201d]/g,'"').replace(/[\u2018\u2019]/g,"'").replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const tcSubs=r=>String(r.subchapters||'').split('|').map(s=>s.trim()).filter(Boolean);
const tcBookChapters=async()=>{ // the book's own ## / ### headings, read from the book (md)
  for(const ed of ['NO_PREM','NO_FREE','EN_PREM','EN_FREE']){
    try{const r=await fetch(`../${tcBook}/${tcBook}_${ed}.md`,{cache:'no-store'});if(!r.ok)continue;
      const ch=[];let cur=null;
      (await r.text()).split('\n').forEach(l=>{const m=l.match(/^(#{2,3})\s+(.*)$/);if(!m)return;
        const t=tcNorm(m[2].replace(/\s*#+\s*$/,''));
        if(m[1]==='##'){cur={name:t,subs:[]};ch.push(cur)}else if(cur)cur.subs.push(t)});
      if(ch.length)return ch;
    }catch(e){}
  }
  return [];
};
const tcPoolFrom=()=>{ // unplaced = every subchapter of the book that is not placed in a variant
  const placed=new Set(tcRows.filter(r=>r.variant!==TC_UNPLACED).flatMap(tcSubs).map(tcNorm));
  const up=tcChapters.find(c=>/uplassert|ubestemt/i.test(c.name));
  if(up)tcUnplacedName=up.name;
  const out=[];
  tcChapters.forEach(c=>c.subs.forEach(s=>{if(!placed.has(tcNorm(s))&&!out.includes(s))out.push(s)}));
  return out;
};
const tcMarkDups=()=>{ // names that occur in more than one variant are shown in italic
  const n={};
  tcBoardEl.querySelectorAll('.tcCol:not([data-unplaced]) .tcName').forEach(el=>{const k=tcNorm(el.textContent);n[k]=(n[k]||0)+1});
  tcBoardEl.querySelectorAll('.tcName').forEach(el=>el.classList.toggle('tcDup',(n[tcNorm(el.textContent)]||0)>1));
};
const tcChip=s=>`<span class="tcChip"><span class="tcGripS" title="dra · Ctrl = kopi">⠿</span><span class="tcName" contenteditable="true">${esc(s)}</span><button type="button" class="tcBtn" onclick="tcDel(this)" title="fjern">×</button></span>`;
const tcCardHTML=(main,subs)=>`<div class="tcMain"><div class="tcHead"><span class="tcName tcChap" contenteditable="true">${esc(main)}</span><button type="button" class="tcBtn" onclick="tcAddSub(this)" title="underkapittel">+</button><button type="button" class="tcBtn" onclick="tcDel(this)" title="slett kapittel">×</button></div><div class="tcSubs">${(subs||[]).map(s=>tcChip(s)).join('')}</div></div>`;
const tcUnplacedHTML=()=>`<div class="tcCol tcUp" data-variant="${TC_UNPLACED}" data-unplaced="1"><div class="tcTitle">Uplassert <small>· ${tcPool.length} fra boken</small> <button type="button" class="tcBtn" onclick="tcLoad()" title="hent på nytt fra boken">↻</button></div><div class="tcList">${tcCardHTML(tcUnplacedName,tcPool)}</div></div>`;
const tcRender=variants=>{
  const cols=[...variants.filter(v=>v!==TC_UNPLACED).sort((a,b)=>String(a).localeCompare(String(b))),TC_UNPLACED];
  tcBoardEl.innerHTML=cols.map(v=>{
    if(v===TC_UNPLACED)return tcUnplacedHTML();
    const by={},order=[];
    tcRows.filter(r=>r.variant===v).forEach(r=>{if(!(r.mainchapter in by)){by[r.mainchapter]=order.length;order.push({main:r.mainchapter,subs:tcSubs(r)})}else order[by[r.mainchapter]].subs.push(...tcSubs(r))});
    return `<div class="tcCol" data-variant="${esc(v)}"><div class="tcTitle">${esc(v)} <button type="button" class="tcBtn" onclick="tcAddMain('${q(v)}')" title="nytt kapittel">+</button></div><div class="tcList">${order.map(m=>tcCardHTML(m.main,m.subs)).join('')}</div></div>`;
  }).join('');
  tcSort();
  tcMarkDups();
};
const tcSort=()=>{ // only subchapters are dragged; Ctrl (⌘) keeps a copy behind in the source
  tcBoardEl.querySelectorAll('.tcSubs').forEach(el=>{if(el._tc)return;el._tc=1;
    new Sortable(el,{group:{name:'tcSub',pull:true,put:el.closest('.tcCol').dataset.unplaced!=='1'},handle:'.tcGripS',animation:150,onEnd:evt=>{
      if(tcMods&&evt.from){const dup=evt.item.cloneNode(true);evt.from.insertBefore(dup,evt.from.children[evt.oldDraggableIndex]||null)}
      tcSave();
    }});});
};
window.tcAddMain=v=>{tcBoardEl.querySelector('.tcCol[data-variant="'+v+'"] > .tcList').insertAdjacentHTML('beforeend',tcCardHTML('Nytt kapittel|',[]));tcSort()};
window.tcAddSub=btn=>{btn.closest('.tcMain').querySelector('.tcSubs').insertAdjacentHTML('beforeend',tcChip('Nytt underkapittel'));tcSort()};
window.tcDel=btn=>{(btn.closest('.tcChip')||btn.closest('.tcMain')).remove();tcSave()};
window.tcSave=async()=>{ // one row per chapter, subchapters pipe-delimited (Uplassert is derived, never stored)
  const rows=[];
  tcBoardEl.querySelectorAll('.tcCol:not([data-unplaced])').forEach(col=>{
    const variant=col.dataset.variant;
    col.querySelectorAll(':scope > .tcList > .tcMain').forEach((m,i)=>{
      const main=m.querySelector(':scope > .tcHead > .tcName').textContent.trim();
      const subs=[...m.querySelectorAll(':scope > .tcSubs > .tcChip > .tcName')].map(s=>s.textContent.trim()).filter(Boolean);
      rows.push({book:tcBook,variant:variant,mainchapter:main,subchapters:subs.join('|'),ord:i});
    });
  });
  const d=await db();
  const del=await d.from('book_chapter').delete().eq('book',tcBook);
  if(del.error){alert(del.error.message);return}
  if(rows.length){const{error}=await d.from('book_chapter').insert(rows);if(error){alert(error.message);return}}
  tcRows=rows;
  tcPool=tcPoolFrom();
  const up=tcBoardEl.querySelector('.tcCol[data-unplaced]');
  if(up)up.outerHTML=tcUnplacedHTML();
  tcSort();
  tcMarkDups();
  if(tcMsgEl)tcMsgEl.textContent='lagret '+new Date().toLocaleTimeString();
};
window.tcLoad=async()=>{
  tcBook=(document.getElementById('tc_book').value||'').trim()||'LifeDemandedDeath';
  if(tcMsgEl)tcMsgEl.textContent='…';
  const d=await db();
  const{data,error}=await d.from('book_chapter').select('*').eq('book',tcBook).order('ord',{ascending:true});
  if(error){tcBoardEl.innerHTML=`<p class="exp">${error.message}</p>`;if(tcMsgEl)tcMsgEl.textContent='';return}
  tcRows=data||[];
  const{data:vars}=await d.from('book_variant').select('variant').eq('book',tcBook);
  tcChapters=await tcBookChapters();
  tcPool=tcPoolFrom();
  tcRender([...new Set([...(vars||[]).map(v=>v.variant),...tcRows.map(r=>r.variant)])].filter(Boolean));
  if(tcMsgEl)tcMsgEl.textContent=tcPool.length+' uplassert · Ctrl-dra = kopi';
};
tcBoardEl.addEventListener('blur',e=>{if(e.target.classList&&e.target.classList.contains('tcName'))tcSave()},true);
tcLoad();
