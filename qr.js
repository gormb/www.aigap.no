// QR helpers (window.qr)
window.qr = {
  //todo: centralize qr code generation here for easy generation for all of www.aigap.no 
  // Tables + drawing rules are the ones from i/u/qr.js and i/u/qrgen.py, so what g()
  // returns at qr.S px per module is i/<id>.<token>.gif (and its transparent twin).
  // The page loads qrcode-generator (window.qrcode) and i/u/qrmetrics.js (keep
  // keepHole qrErasure qrHoleErase keyArt); nothing here touches the DOM but its canvas.
  GS:[21,25,29,37,49,65,85,109,141,177],                    // QR versions 1,2,3,5,8,12,17,23,31,40 modules
  EC:['L','M','Q','H'],
  EB:{L:7,M:15,Q:25,H:30},                                  // EC error budget (% codewords)
  // Recommended EC / hole per size and id length.  Rows exist for the three sizes the served
  // codes use (21/25/29); where a size has no row there is no recommendation, so an empty
  // iHole means 0 and the EC comes from the error % budget alone.
  REC_EC:['MMLLL','QMMMLLL','HHHQQQQMMMMLLLLLLL'],
  REC_HOLE:[[5,5,5,5,5],[7,7,7,7,5,5,5],[9,9,9,7,7,7,7,5,5,5,5,5,5,5,5,5,5]],
  KEYTOL:1,                                                 // per-channel slack of the colour key
  KEYSHR:0.20,                                              // key only if one colour covers this share
  S:40,                                                     // px per module (i/u/qr.js renderHi)
  MAR:4,                                                    // quiet zone in modules (renderHi default)
  _i:{},                                                    // art src -> decoded image
  _k:{},                                                    // art src -> keyed canvas (i/u/qr.js KEYED)
  _f:{},                                                    // "size|text" -> the EC levels that hold it (i/u/qr.js FIT)
  _c:{},                                                    // art|hole|tr|phase -> the covered modules (sub-module)
  _s:{},                                                    // art|hole|tr -> the art at KSUB px per module
  _l:{},                                                    // "size|ec" -> dataCells(): the codeword layout
  KSUB:10,                                                  // subpixels per module for the >=half coverage rule
  // g(text|id, art name|url|null, size, transparent, hole, error %, offsetX, offsetY) -> canvas
  // iHole is any whole number of modules up to the code size (0 = no hole, clamped to the
  // code); an empty hole takes the one recommended for that id length (REC_HOLE).
  // offsetX/offsetY move the hole off centre, in modules (1/10 is the step) -- for art that sits
  // a little off middle.  The hole may run past the edge: only the part inside the code is drawn.
  // The code is painted first and the art is drawn on top of it at the art's OWN resolution, so
  // the art stays sharp however coarse the module grid is.  The erasure (.e) stays whole modules:
  // a module the art covers at least half of counts, by the same >=128 coverage rule.
  // .t = token (i/<id>.<token>.gif, always the centred code), .u = encoded text,
  // .e = {erased,ecPer,col}, .o = the offsets actually used.
  g:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20,offsetX=0,offsetY=0)=>{
    const o=await qr._o(t,img,iSz,iTrans,iHole,error,offsetX,offsetY);
    if(!o)return null;
    const cv=qr._draw(qr._mx(o.N,o.ec,o.s),o.h,o.tr,o.A,o.lx,o.ly,o.fx,o.fy);
    cv.t=o.N+o.ec+o.h+(o.h>0&&o.tr?'t':'');
    cv.u=o.s;
    cv.e=qr._met(o.N,o.ec,o.h,o.tr,o.A,o.fx,o.fy);
    cv.o=[o.fx-o.cx,o.fy-o.cy];
    return cv;
  },
  // the same variant without drawing it: the i/u/qrmetrics.js erasure numbers alone, so a
  // caller can walk the holes itself and draw only the one it picks.
  met:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20,offsetX=0,offsetY=0)=>{
    const o=await qr._o(t,img,iSz,iTrans,iHole,error,offsetX,offsetY);
    return o?qr._met(o.N,o.ec,o.h,o.tr,o.A,o.fx,o.fy):null;
  },
  // The offset (in modules, from centre) that erases the fewest codewords, so the art can be
  // placed instead of nudged by hand, at sub-module precision -- a module counts only when the art
  // covers at least half of it (_cover), which is true or not depending on the fractional offset.
  // One coarse grid across the whole range, then 1-module steps around its twenty best, then
  // 0.1-module steps around those, keeping twenty each time -- so a search reads a few thousand
  // placements, never every one, even on the largest codes.  A placement that would hide a
  // finder pattern's middle row/column is rejected, so the finder keeps its 1:1:3:1:1 scan lines;
  // ties go to the offset nearest the centre.  When (nearX,nearY) is given, placements closer than
  // sqrt(2) modules to it are skipped, so asking twice keeps moving.  Returns {x,y} in modules
  // (fractional) plus per (the error % there), or null when there is no art to place.
  best:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20,nearX=null,nearY=null)=>{
    const o=await qr._o(t,img,iSz,iTrans,iHole,error,0,0);
    return o?qr._best(o,nearX,nearY):null;
  },
  _best:(o,nearX,nearY)=>{
    const N=o.N,ec=o.ec,h=o.h,A=o.A;
    if(!(h>0&&A))return null;
    const L=qr._l[N+'|'+ec]||(qr._l[N+'|'+ec]=dataCells(N,ec))
     ,nb=L.blk.length,cwN=L.totalCW,R=N-h,cx=(N-h)>>1;   // R = furthest whole-module top-left
    const cw=new Int32Array(N*N).fill(-1),prot=new Uint8Array(N*N);
    for(let i=0;i<L.cells.length;i++){const cl=L.cells[i],k=(cl.seq/8)|0;if(k<cwN)cw[cl.r*N+cl.c]=k;}
    [[0,0],[0,N-7],[N-7,0]].forEach(p=>{for(let i=0;i<7;i++){    // each finder's middle row + column
      prot[(p[0]+3)*N+p[1]+i]=1;prot[(p[0]+i)*N+p[1]+3]=1;}});
    const stamp=new Int32Array(cwN).fill(-1),cnt=new Int32Array(nb);
    let gen=0;
    // score the art with the hole's top-left at (fx,fy) (may be fractional): the worst-block erased
    // share and how many finder modules it would hide, or null when the hole leaves the code.
    const score=(fx,fy,soft)=>{
      if(fx<0||fy<0||fx>R||fy>R)return null;
      if(nearX!=null&&!soft){const ax=fx-cx-nearX,ay=fy-cx-nearY;if(ax*ax+ay*ay<2-1e-9)return null;}   // keep sqrt(2)
      const Bx=Math.floor(fx+1e-9),By=Math.floor(fy+1e-9)
       ,C=qr._cover(A,h,o.tr,Math.min(9,Math.max(0,Math.round((fx-Bx)*10))),Math.min(9,Math.max(0,Math.round((fy-By)*10))));
      gen++;let cross=0;
      for(let i=0;i<C.M;i++)for(let j=0;j<C.M;j++)if(C.m[i*C.M+j]){
        const r=By+i,c=Bx+j;if(r>=N||c>=N)continue;
        if(prot[r*N+c]){cross++;continue;}
        const k=cw[r*N+c];
        if(k>=0&&stamp[k]!==gen){stamp[k]=gen;cnt[L.bmap[k]]++;}}
      let worst=0;                                          // _met: the RS block that loses the most
      for(let b=0;b<nb;b++){const s=cnt[b]/L.blk[b].ec;if(s>worst)worst=s;cnt[b]=0;}
      return {fx:fx,fy:fy,per:worst,cross:cross,d:Math.abs(fx-cx)+Math.abs(fy-cx)};};
    const rank=(a,b)=>a.cross-b.cross||a.per-b.per||a.d-b.d;
    const keep=a=>(a.sort(rank),a.slice(0,20));   // the twenty placements worth keeping
    const c0=qr._cover(A,h,o.tr,0,0);
    let any=false;for(let i=0;i<c0.M*c0.M&&!any;i++)if(c0.m[i])any=true;
    if(!any)return {x:0,y:0,per:0};               // fully transparent: nothing is ever erased
    // Three grids, ten kept at each: a coarse one across the whole range, then 1-module steps
    // around those ten, then 0.1-module steps.  Every step's window covers the spacing of the
    // step above, so the search never reads a position the grid above could have pointed at.
    const s0=Math.max(1,Math.round(R/9));         // ~10 points across; adapts to a small range
    const grid=(step,soft)=>{const out=[];
      for(let y=0;y<=R;y+=step)for(let x=0;x<=R;x+=step){const s=score(x,y,soft);if(s)out.push(s);}
      for(let x=0;x<=R;x+=step){const s=score(x,R,soft);if(s)out.push(s);}
      for(let y=0;y<=R;y+=step){const s=score(R,y,soft);if(s)out.push(s);}
      return out;};
    const around=(pts,step,n,soft)=>{const out=[];
      for(const q of pts)for(let i=-n;i<=n;i++)for(let j=-n;j<=n;j++){
        const s=score(q.fx+i*step,q.fy+j*step,soft);if(s)out.push(s);}
      return out;};
    let pts=keep(grid(s0,false));
    const soft=!pts.length;                       // nothing survived the sqrt(2) rule: ignore it
    if(soft)pts=keep(grid(s0,true));
    if(!pts.length)return null;
    if(s0>1)pts=keep(around(pts,1,Math.max(1,Math.ceil(s0/2)),soft));   // 1x1 grid over each cell
    const prev=pts;
    const fine=keep(around(pts,0.1,5,soft));      // 0.1x0.1 grid
    const b=(fine.length?fine:prev)[0];
    if(!b)return null;
    return {x:+(b.fx-cx).toFixed(1),y:+(b.fy-cx).toFixed(1),per:100*b.per};
  },
  // The sizes in GS that can hold this id/url, so a caller only offers those.  Same string and
  // same mode rule as _o (21 is the bare www. host, the rest https://), and the header+payload
  // bits are matched against dataBits(), so the list is exactly what g() can build.
  sizes:t=>{
    t=(t||'').trim();
    if(!t)return qr.GS.slice();
    const F=/^(https?:\/\/|www\.)/i.test(t)
     ,B=F?t.replace(/^https?:\/\//i,'').replace(/^www\./i,''):'aigap.no/'+t;
    return qr.GS.filter(N=>{
      const s=(N===21?'www.':'https://')+B,v=(N-17)/4
       ,A=/^[0-9A-Z $%*+\-./:]+$/.test(s),n=s.length
       ,pay=A?11*((n/2)|0)+(n%2?6:0):8*n     // alphanumeric pairs pack 2 chars into 11 bits
       ,hdr=4+(A?(v<=9?9:v<=26?11:13):(v<=9?8:16));
      return qr.EC.some(e=>dataBits(N,e)>=hdr+pay);
    });
  },
  _o:async (t,img,iSz,iTrans,iHole,error,offsetX,offsetY)=>{   // one variant: text, size, EC, hole, art, offsets
    t=(t||'').trim();
    if(!t)return null;
    const N=qr.GS.indexOf(+iSz)>=0?+iSz:21
     ,gi=qr.GS.indexOf(N)
     ,F=/^(https?:\/\/|www\.)/i.test(t)
     ,B=F?t.replace(/^https?:\/\//i,'').replace(/^www\./i,''):'aigap.no/'+t
     ,s=(N===21?'www.':'https://')+B
     ,c=(F?B:t).length
     ,em=+error>=0?+error:20
     ,hi=iHole==null||iHole===''?NaN:+iHole
     ,fk=N+'|'+s
     ,fit=qr._f[fk]||(qr._f[fk]=qr.EC.filter(e=>{try{qr._mx(N,e,s);return true}catch(_){return false}}));
    if(Object.keys(qr._f).length>200)qr._f={};   // a caller typing text must not grow this forever
    if(!fit.length)return null;
    const want=(qr.REC_EC[gi]||'')[c]
     ,ec=fit.indexOf(want)>=0?want:(fit.filter(e=>qr.EB[e]<=em).pop()||fit[0])
     ,h=isFinite(hi)?Math.min(Math.max(0,Math.round(hi)),N):(qr.REC_HOLE[gi]||[])[c]||0
     ,cx=h>0?(N-h)>>1:0
     ,cy=cx
     ,fx=h>0?cx+(+offsetX||0):0       // the art may sit at a fraction of a module
     ,fy=h>0?cy+(+offsetY||0):0
     ,lx=Math.round(fx)               // the cleared modules (and the erasure) stay whole
     ,ly=Math.round(fy);
    return {N:N,ec:ec,h:h,tr:iTrans?true:false,s:s,cx:cx,cy:cy,lx:lx,ly:ly,fx:fx,fy:fy,
      A:img&&String(img).trim()?await qr._art(String(img).trim()):null};
  },
  // id|url -> the art image (name -> /i/<name>.png); missing art or blocked pixels -> null
  _art:v=>{
    const u=/^\w+:|\//.test(v)?v:'/i/'+(/\.\w+$/.test(v)?v:v+'.png'),cr=/^https?:\/\//i.test(v);
    if(!(u in qr._i))qr._i[u]=(async()=>{      // decode each art once (a hidden tab may never
      const l=x=>new Promise(res=>{const i=new Image();   // decode(), so wait for load instead)
        if(x)i.crossOrigin='anonymous';   // i/u/qr.js loadArt: ask for CORS so the pixels can be read
        i.onload=()=>res(i);
        i.onerror=()=>res(null);
        i.src=u});
      return await l(cr)||(cr?await l(false):null);   // no CORS header -> draw it anyway, pixel read stays blocked
    })();
    return qr._i[u];
  },
  _mx:(N,ec,s)=>{   // i/u/qr.js matrixFor + modeFor
    const q=qrcode((N-17)/4,ec);
    q.addData(s,/^[0-9A-Z $%*+\-./:]+$/.test(s)?'Alphanumeric':'Byte');
    q.make();
    const n=q.getModuleCount(),M=[];
    for(let r=0;r<n;r++){const row=[];for(let c=0;c<n;c++)row.push(q.isDark(r,c));M.push(row);}
    return M;
  },
  _key:A=>{   // the keyed art (i/u/qrmetrics.js keyArt); null when there is nothing to draw
    if(!A||!(A.naturalWidth||A.width))return null;
    if(!(A.src in qr._k)){                 // keying reads every pixel -- do it once per art
      try{qr._k[A.src]=keyArt(A,qr.KEYTOL,qr.KEYSHR)||A}catch(e){qr._k[A.src]=A}   // blocked pixels -> the raw art
    }
    return qr._k[A.src];
  },
  _scan:(A,h,tr)=>{   // the art rendered once at KSUB px per module (hole at local [0,h]);
    const k=((A&&A.src)||'')+'|'+h+'|'+tr;       // every sub-module phase is an integer sub-pixel
    let s=qr._s[k];                              // shift of this one image, so it is drawn once
    if(!s){
      const K=qr.KSUB,M0=Math.ceil(h)+4,S0=M0*K
       ,cv=document.createElement('canvas');cv.width=cv.height=S0;
      const g=cv.getContext('2d',{willReadFrequently:true});
      if(tr){const Z=qr._key(A),aW=Z.naturalWidth||Z.width,aH=Z.naturalHeight||Z.height
         ,r=Math.min(h/aW,h/aH),w=aW*r,hh=aH*r;   // the art contained in the hole (i/u/qr.js artFit)
        g.drawImage(Z,0,0,aW,aH,(1+(h-w)/2)*K,(1+(h-hh)/2)*K,w*K,hh*K);
      }else g.fillRect(K,K,h*K,h*K);              // opaque art covers the whole hole
      s=qr._s[k]={K:K,S0:S0,M0:M0,d:g.getImageData(0,0,S0,S0).data};
      if(Object.keys(qr._s).length>16)qr._s={};    // one entry is a whole ImageData: keep the last few
    }
    return s;
  },
  _cover:(A,h,tr,pi,pj)=>{   // the modules the art covers (>= half, i/u/qr.js coverageAlpha) for the
    const base=((A&&A.src)||'')+'|'+h+'|'+tr,t=pi*10+pj;   // sub-module phase (pi,pj)/10; local
    let a=qr._c[base];if(!a)a=qr._c[base]=[];              // (i,j) is the code module (floor+i,floor+j)
    if(a[t])return a[t];
    const px=pi/10,py=pj/10
     ,s=qr._scan(A,h,tr),K=s.K,M=Math.ceil(h)+3,m=new Uint8Array(M*M)
     ,x0=Math.round((1-px)*K),y0=Math.round((1-py)*K);   // KSUB makes px*K whole, so this is exact
    for(let i=0;i<M;i++)for(let j=0;j<M;j++){let sm=0;
      for(let y=0;y<K;y++){const dy=(y0+i*K+y)*s.S0;
        for(let x=0;x<K;x++)sm+=s.d[(dy+x0+j*K+x)*4+3];}
      m[i*M+j]=sm*2>=K*K*255?1:0;}               // >= half of the module is covered
    a[t]={M:M,m:m};
    if(Object.keys(qr._c).length>24)qr._c={};     // each entry is a small mask: keep the last few arts
    return a[t];
  },
  _met:(N,ec,h,tr,A,fx,fy)=>{   // i/u/qr.js metricFor, at the true sub-module placement (fx,fy)
    if(h>0){
      const Bx=Math.floor(fx+1e-9),By=Math.floor(fy+1e-9)
       ,pi=Math.min(9,Math.max(0,Math.round((fx-Bx)*10))),pj=Math.min(9,Math.max(0,Math.round((fy-By)*10)))
       ,C=qr._cover(A,h,tr,pi,pj);
      return qrErasure(N,ec,(r,c)=>{const i=r-By,j=c-Bx;return i>=0&&j>=0&&i<C.M&&j<C.M&&C.m[i*C.M+j]===1;});
    }
    return qrErasure(N,ec,()=>false);
  },
  _fit:(side,aW,aH,tr)=>{   // i/u/qr.js artFit: opaque crops to the square, transparent contains
    if(!(aW&&aH))return {sx:0,sy:0,sw:1,sh:1,x:0,y:0,w:side,h:side};
    if(!tr){const s=Math.min(aW,aH);return {sx:aW>aH?(aW-s)/2:0,sy:aH>aW?(aH-s)/2:0,sw:s,sh:s,x:0,y:0,w:side,h:side};}
    const r=Math.min(side/aW,side/aH),w=aW*r,h=aH*r;
    return {sx:0,sy:0,sw:aW,sh:aH,x:(side-w)/2,y:(side-h)/2,w:w,h:h};
  },
  _keep:(g,M,h,S,mar,lx,ly)=>{   // i/u/qr.js repaint: the kept cells go back on top of the art
    const N=M.length,off=(mar||0)*S;
    for(let r=0;r<h;r++)for(let c=0;c<h;c++)if(keep(h,r,c)){
      if(ly+r<0||ly+r>=N||lx+c<0||lx+c>=N)continue;      // the hole may hang off the code
      g.fillStyle=M[ly+r][lx+c]?'#000':'#fff';
      g.fillRect(off+(lx+c)*S,off+(ly+r)*S,S,S);}
  },
  _draw:(M,h,tr,A,lx,ly,fx,fy)=>{   // i/u/qr.js renderHi(): the code, then the art, then the kept cells
    const N=M.length,S=qr.S,mar=qr.MAR,D=(N+2*mar)*S
     ,cv=document.createElement('canvas');cv.width=cv.height=D;
    const g=cv.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,D,D);
    g.fillStyle='#000';
    for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(M[r][c])g.fillRect((mar+c)*S,(mar+r)*S,S,S);
    if(h>0){
      const size=h*S,bar=keepHole(N,h),K=tr?qr._key(A):A
       ,x0=Math.max(0,fx),y0=Math.max(0,fy),x1=Math.min(N,fx+h),y1=Math.min(N,fy+h);
      if(K&&x1>x0&&y1>y0){   // the code stays underneath; the art keeps its own resolution
        const f=qr._fit(size,K.naturalWidth||K.width,K.naturalHeight||K.height,tr);
        g.save();g.beginPath();g.rect((mar+x0)*S,(mar+y0)*S,(x1-x0)*S,(y1-y0)*S);g.clip();
        g.drawImage(K,f.sx,f.sy,f.sw,f.sh,(mar+fx)*S+f.x,(mar+fy)*S+f.y,f.w,f.h);g.restore();}
      if(bar)qr._keep(g,M,h,S,mar,lx,ly);}
    return cv;
  }
};