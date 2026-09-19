// QR helpers (window.qr)
window.qr = {
  //todo: centralize qr code generation here for easy generation for all of www.aigap.no 
  // Tables + drawing rules are the ones from i/u/qr.js and i/u/qrgen.py, so what g()
  // returns at qr.S px per module is i/<id>.<token>.png (and its transparent twin).
  // The page loads qrcode-generator (window.qrcode) and i/u/qrmetrics.js (keep
  // keepHole qrErasure qrHoleErase keyArt); nothing here touches the DOM but its canvas.
  GS:[21,25,29],
  EC:['L','M','Q','H'],
  HOLES:[0,3,5,7,9,11,13],                                    // the holes that exist (i/u/qr.js + i/u/qr.sql)
  EB:{L:7,M:15,Q:25,H:30},                                  // EC error budget (% codewords)
  REC_EC:['MMLLL','QMMMLLL','HHHQQQQMMMMLLLLLLL'],          // recommended EC per size and id length
  REC_HOLE:[[5,5,5,5,5],[7,7,7,7,5,5,5],[9,9,9,7,7,7,7,5,5,5,5,5,5,5,5,5,5]],
  KEYTOL:1,                                                 // per-channel slack of the colour key
  KEYSHR:0.20,                                              // key only if one colour covers this share
  S:40,                                                     // px per module (i/u/qr.js renderHi)
  MAR:4,                                                    // quiet zone in modules (renderHi default)
  // g(text|id, art name|url|null, size, transparent, hole, error %) -> canvas
  // iHole is any whole number of modules (0 = no hole, clamped to the code); an empty hole
  // takes the one recommended for that id length (REC_HOLE). EC is REC_EC, or
  // the strongest level within `error` when the table has no entry (or it cannot hold the text).
  // .t = token (i/<id>.<token>.png), .u = encoded text, .e = {erased,ecPer,col}.
  g:async (t=null,img=null,iSz=21,iTrans=true,iHole=0,error=20)=>{
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
     ,fit=qr.EC.filter(e=>{try{qr._mx(N,e,s);return true}catch(_){return false}});
    if(!fit.length)return null;
    const want=(qr.REC_EC[gi]||'')[c]
     ,ec=fit.indexOf(want)>=0?want:(fit.filter(e=>qr.EB[e]<=em).pop()||fit[0])
     ,h=isFinite(hi)?Math.min(Math.max(0,Math.round(hi)),N-1):(qr.REC_HOLE[gi]||[])[c]||0
     ,A=img&&String(img).trim()?await qr._art(String(img).trim()):null
     ,cv=qr._draw(qr._mx(N,ec,s),h,iTrans?true:false,A);
    cv.t=N+ec+h+(h>0&&iTrans?'t':'');
    cv.u=s;
    cv.e=qr._met(N,ec,h,iTrans?true:false,A);
    return cv;
  },
  // id|url -> the art image (name -> /i/<name>.png); missing art or blocked pixels -> null
  _art:async v=>{
    const i=new Image();
    i.src=/^\w+:|\//.test(v)?v:'/i/'+(/\.\w+$/.test(v)?v:v+'.png');
    try{await i.decode();return i}catch(e){return null}
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
    try{return keyArt(A,qr.KEYTOL,qr.KEYSHR)||A}catch(e){return A}
  },
  _cov:(A,h)=>{   // per-module alpha of the keyed art inside the hole (i/u/qr.js coverageAlpha)
    const K=qr._key(A);
    if(!K)return null;
    const c=document.createElement('canvas');c.width=c.height=h;
    const g=c.getContext('2d'),f=qr._fit(h,K.naturalWidth||K.width,K.naturalHeight||K.height,true);
    g.drawImage(K,f.sx,f.sy,f.sw,f.sh,f.x,f.y,f.w,f.h);
    try{const d=g.getImageData(0,0,h,h).data,al=new Array(h*h);
      for(let i=0;i<h*h;i++)al[i]=d[i*4+3];
      return al;}catch(e){return null}
  },
  _met:(N,ec,h,tr,A)=>{   // i/u/qr.js metricFor: transparent counts the keyed art, opaque the square
    if(tr&&h>0){
      const al=qr._cov(A,h);
      if(al){const lo=(N-h)>>1;
        return qrErasure(N,ec,(r,c)=>r>=lo&&r<lo+h&&c>=lo&&c<lo+h&&al[(r-lo)*h+(c-lo)]>=128);}
    }
    return qrHoleErase(N,ec,h);
  },
  _fit:(side,aW,aH,tr)=>{   // i/u/qr.js artFit: opaque crops to the square, transparent contains
    if(!(aW&&aH))return {sx:0,sy:0,sw:1,sh:1,x:0,y:0,w:side,h:side};
    if(!tr){const s=Math.min(aW,aH);return {sx:aW>aH?(aW-s)/2:0,sy:aH>aW?(aH-s)/2:0,sw:s,sh:s,x:0,y:0,w:side,h:side};}
    const r=Math.min(side/aW,side/aH),w=aW*r,h=aH*r;
    return {sx:0,sy:0,sw:aW,sh:aH,x:(side-w)/2,y:(side-h)/2,w:w,h:h};
  },
  _keep:(g,M,h,S,mar)=>{   // i/u/qr.js repaint: the kept cells go back on top of the art
    const N=M.length,lo=(N-h)>>1,off=(mar||0)*S;
    for(let r=0;r<h;r++)for(let c=0;c<h;c++)if(keep(h,r,c)){
      g.fillStyle=M[lo+r][lo+c]?'#000':'#fff';
      g.fillRect(off+(lo+c)*S,off+(lo+r)*S,S,S);}
  },
  _draw:(M,h,tr,A)=>{   // i/u/qr.js renderHi(): hole whites, then the art, then the kept cells
    const N=M.length,S=qr.S,mar=qr.MAR,D=(N+2*mar)*S
     ,cv=document.createElement('canvas');cv.width=cv.height=D;
    const g=cv.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,D,D);
    g.fillStyle='#000';
    for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(M[r][c])g.fillRect((mar+c)*S,(mar+r)*S,S,S);
    if(h>0&&h<N){
      const lo=(N-h)>>1,p=(mar+lo)*S,size=h*S,bar=keepHole(N,h),al=tr?qr._cov(A,h):null;
      for(let r=0;r<h;r++)for(let c=0;c<h;c++){
        if(bar&&keep(h,r,c))continue;
        if(tr&&al&&al[r*h+c]<128)continue;
        g.fillStyle='#fff';g.fillRect(p+c*S,p+r*S,S,S);}
      const K=tr?qr._key(A):A;
      if(K){const f=qr._fit(size,K.naturalWidth||K.width,K.naturalHeight||K.height,tr);
        g.save();g.beginPath();g.rect(p,p,size,size);g.clip();
        g.drawImage(K,f.sx,f.sy,f.sw,f.sh,p+f.x,p+f.y,f.w,f.h);g.restore();}
      if(bar)qr._keep(g,M,h,S,mar);}
    return cv;
  }
};