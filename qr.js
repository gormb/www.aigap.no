// QR helpers (window.qr)
window.qr = {
  //todo: centralize qr code generation here for easy generation for all of www.aigap.no 
  // Tables + drawing rules are the ones from i/u/qr.js and i/u/qrgen.py, so what g()
  // returns at qr.S px per module is i/<id>.<token>.png (and its transparent twin).
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
  _q:{},                                                    // art|hole|tr -> the art at one pixel per module
  // g(text|id, art name|url|null, size, transparent, hole, error %, offsetX, offsetY) -> canvas
  // iHole is any whole number of modules up to the code size (0 = no hole, clamped to the
  // code); an empty hole takes the one recommended for that id length (REC_HOLE).
  // offsetX/offsetY move the hole off centre, in modules (1/10 is the step) -- for art that sits
  // a little off middle.  The hole may run past the edge: only the part inside the code is drawn.
  // The code is painted first and the art is drawn on top of it at the art's OWN resolution, so
  // the art stays sharp however coarse the module grid is.  The erasure (.e) stays whole modules:
  // a module the art covers at least half of counts, by the same >=128 coverage rule.
  // .t = token (i/<id>.<token>.png, always the centred code), .u = encoded text,
  // .e = {erased,ecPer,col}, .o = the offsets actually used.
  g:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20,offsetX=0,offsetY=0)=>{
    const o=await qr._o(t,img,iSz,iTrans,iHole,error,offsetX,offsetY);
    if(!o)return null;
    const cv=qr._draw(qr._mx(o.N,o.ec,o.s),o.h,o.tr,o.A,o.lx,o.ly,o.fx,o.fy);
    cv.t=o.N+o.ec+o.h+(o.h>0&&o.tr?'t':'');
    cv.u=o.s;
    cv.e=qr._met(o.N,o.ec,o.h,o.tr,o.A,o.lx,o.ly);
    cv.o=[o.fx-o.cx,o.fy-o.cy];
    return cv;
  },
  // the same variant without drawing it: the i/u/qrmetrics.js erasure numbers alone, so a
  // caller can walk the holes itself and draw only the one it picks.
  met:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20,offsetX=0,offsetY=0)=>{
    const o=await qr._o(t,img,iSz,iTrans,iHole,error,offsetX,offsetY);
    return o?qr._met(o.N,o.ec,o.h,o.tr,o.A,o.lx,o.ly):null;
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
  _cov:(A,h)=>{   // per-module alpha of the keyed art inside the hole (i/u/qr.js coverageAlpha)
    const d=qr._quad(A,h,true);
    if(!d)return null;
    const al=new Array(h*h);
    for(let i=0;i<h*h;i++)al[i]=d[i*4+3];
    return al;
  },
  _quad:(A,h,tr)=>{   // the art averaged down to the module grid: one pixel per module, for the count
    const K=tr?qr._key(A):A;
    if(!K||!(K.naturalWidth||K.width))return null;
    const k=h+'|'+tr+'|'+((A&&A.src)||'');
    if(!(k in qr._q)){
      const c=document.createElement('canvas');c.width=c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});
      const f=qr._fit(h,K.naturalWidth||K.width,K.naturalHeight||K.height,tr);
      g.drawImage(K,f.sx,f.sy,f.sw,f.sh,f.x,f.y,f.w,f.h);
      try{qr._q[k]=g.getImageData(0,0,h,h).data}catch(e){qr._q[k]=null}
    }
    return qr._q[k];
  },
  _met:(N,ec,h,tr,A,lx,ly)=>{   // i/u/qr.js metricFor: transparent counts the keyed art, opaque the square
    if(tr&&h>0){
      const al=qr._cov(A,h);
      if(al)return qrErasure(N,ec,(r,c)=>r>=ly&&r<ly+h&&c>=lx&&c<lx+h&&al[(r-ly)*h+(c-lx)]>=128);
    }
    return qrErasure(N,ec,(r,c)=>r>=ly&&r<ly+h&&c>=lx&&c<lx+h);
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