// QR "how much of the hole really erases" metric — measured from the real
// codeword layout of the ISO/IEC 18004 standard, using the exact RS block table
// and placement order of the qrcode-generator lib (MIT) already on this page.
//
// A centre logo/overlay blanks a square of modules. In Reed-Solomon terms that
// damages *codewords* (each codeword = 8 consecutive data modules). A block with
// E error-correction codewords is GUARANTEED to decode if <= floor(E/2) of its
// codewords are damaged (random errors). It can *still* decode up to E damaged
// codewords only if those are known erasures. Above E it cannot decode.
//
// SIZES handled: versions 1, 2, 3, 5, 8, 12, 17, 23, 31, 40 -- 21, 25, 29, 37, 49,
// 65, 85, 109, 141, 177 modules.  From version 5 a level can need TWO block groups
// of different size, so every codeword is mapped to its own RS block and each block is
// judged against its own EC count.

// RS_BLOCK_TABLE[version-1] => [L,M,Q,H], a group list [count,total,data] or
// [count,total,data,count,total,data] -- the table qrcode-generator itself uses.
var RS = {
  1: {L:[1,26,19],M:[1,26,16],Q:[1,26,13],H:[1,26,9]},
  2: {L:[1,44,34],M:[1,44,28],Q:[1,44,22],H:[1,44,16]},
  3: {L:[1,70,55],M:[1,70,44],Q:[2,35,17],H:[2,35,13]},
  5: {L:[1,134,108],M:[2,67,43],Q:[2,33,15,2,34,16],H:[2,33,11,2,34,12]},
  8: {L:[2,121,97],M:[2,60,38,2,61,39],Q:[4,40,18,2,41,19],H:[4,40,14,2,41,15]},
  12: {L:[2,116,92,2,117,93],M:[6,58,36,2,59,37],Q:[4,46,20,6,47,21],H:[7,42,14,4,43,15]},
  17: {L:[1,135,107,5,136,108],M:[10,74,46,1,75,47],Q:[1,50,22,15,51,23],H:[2,42,14,17,43,15]},
  23: {L:[4,151,121,5,152,122],M:[4,75,47,14,76,48],Q:[11,54,24,14,55,25],H:[16,45,15,14,46,16]},
  31: {L:[13,145,115,3,146,116],M:[2,74,46,29,75,47],Q:[42,54,24,1,55,25],H:[23,45,15,28,46,16]},
  40: {L:[19,148,118,6,149,119],M:[18,75,47,31,76,48],Q:[34,54,24,34,55,25],H:[20,45,15,61,46,16]}
};
var ALIGN = {1:[],2:[6,18],3:[6,22],5:[6,30],8:[6,24,42],12:[6,32,58],17:[6,30,54,78],
  23:[6,30,54,78,102],31:[6,30,56,82,108,134],40:[6,30,58,86,114,142,170]};

// Bits a version/level leaves for the text: every block's data codewords.
function dataBits(N, ec){var L=RS[(N-17)/4][ec];if(!L)return -1;
  var b=0;for(var i=0;i<L.length;i+=3)b+=L[i]*L[i+2];return b*8;}

// Enumerate every data module (the modules that carry codeword bits) in the
// exact placement order the standard uses, assigning each its codeword index.
function dataCells(N, ec){
  var v=(N-17)/4, mod=N;
  var func=[]; for(var r=0;r<N;r++){func.push([]);for(var c=0;c<N;c++)func[r].push(false);}
  function set(r,c){if(r>=0&&r<N&&c>=0&&c<N)func[r][c]=true;}
  // 1) finder patterns + separators (like setupPositionProbePattern)
  [[0,0],[N-7,0],[0,N-7]].forEach(function(p){
    for(var r=-1;r<=7;r++)for(var c=-1;c<=7;c++){var rr=p[0]+r,cc=p[1]+c;
      if(rr>=0&&rr<N&&cc>=0&&cc<N)func[rr][cc]=true;}});
  // 2) alignment patterns (skip if centre already occupied)
  var pos=ALIGN[v];
  for(var i=0;i<pos.length;i++)for(var j=0;j<pos.length;j++){
    var ar=pos[i],ac=pos[j];
    if(func[ar][ac])continue;
    for(var r=-2;r<=2;r++)for(var c=-2;c<=2;c++)set(ar+r,ac+c);}
  // 3) timing (rows/col 6, from 8 .. N-9)
  for(var t=8;t<N-8;t++){if(!func[t][6])func[t][6]=true;if(!func[6][t])func[6][t]=true;}
  // 4) format info (15 bits) + fixed dark module
  for(var i2=0;i2<15;i2++){
    if(i2<6)set(i2,8);else if(i2<8)set(i2+1,8);else set(N-15+i2,8);
    if(i2<8)set(8,N-1-i2);else if(i2<9)set(8,15-i2);else set(8,14-i2);} // i2=8->col7
  set(N-8,8);
  // 5) version info (18 bits, a 6x3 block) -- only from version 7
  if(v>=7)for(var i3=0;i3<18;i3++){set((i3/3)|0,i3%3+N-11);set(i3%3+N-11,(i3/3)|0);}

  // 6) blocks + the interleave order: mapData walks the blocks round-robin (a shorter
  //    block drops out), so the k-th codeword belongs to block bmap[k]
  var raw=RS[v][ec], blk=[];
  for(var g=0;g<raw.length;g+=3)for(var gb=0;gb<raw[g];gb++)
    blk.push({data:raw[g+2],ec:raw[g+1]-raw[g+2]});
  var totalCW=0,maxD=0,maxE=0;
  blk.forEach(function(b){totalCW+=b.data+b.ec;if(b.data>maxD)maxD=b.data;if(b.ec>maxE)maxE=b.ec;});
  var bmap=[];
  for(var d=0;d<maxD;d++)for(var bd=0;bd<blk.length;bd++)if(d<blk[bd].data)bmap.push(bd);
  for(var e=0;e<maxE;e++)for(var be=0;be<blk.length;be++)if(e<blk[be].ec)bmap.push(be);

  // mapData placement order
  var cells=[]; // {r,c,seq} in placement order
  var inc=-1,row=N-1,bit=7,seq=0;
  for(var col=N-1;col>0;col-=2){
    if(col==6)col--;
    for(;;){
      for(var cc2=0;cc2<2;cc2++){
        if(!func[row][col-cc2]){
          cells.push({r:row,c:col-cc2,seq:seq++});
          if(--bit<0){bit=7;}
        }
      }
      row+=inc;
      if(row<0||row>=N){row-=inc;inc=-inc;break;}
    }
  }
  return {cells:cells, blk:blk, bmap:bmap, totalCW:totalCW, remainder:cells.length-totalCW*8};
}

// Measure how many codewords of each RS block are lost for a given erase set.
// `isErased(r,c)` decides whether a module is covered (damaged). A codeword
// counts as erased if ANY of its modules is erased.
function qrErasure(N, ec, isErased){
  var L=dataCells(N,ec), nb=L.blk.length, maxBit=L.totalCW*8;
  var hit={};                        // cw -> 1 when ANY of its modules is erased
  for(var i=0;i<L.cells.length;i++){
    var cl=L.cells[i];
    if(cl.seq>=maxBit) continue;     // remainder bits carry no codeword
    if(isErased(cl.r,cl.c)) hit[(cl.seq/8)|0]=1;
  }
  var hits=[];for(var b=0;b<nb;b++)hits.push(0);
  for(var cw in hit) hits[L.bmap[cw]]++;    // each codeword counts in its own block
  var w=0,worst=-1;                  // the block that loses the largest share of its EC
  for(var b2=0;b2<nb;b2++){var sh=hits[b2]/L.blk[b2].ec;if(sh>worst){worst=sh;w=b2;}}
  var erased=hits[w], ecPer=L.blk[w].ec, col;
  if(erased*2<=ecPer)col='g';
  else if(erased<=ecPer)col='y';
  else col='r';
  return {erased:erased, ecPer:ecPer, col:col, perBlock:hits};
}

// Predicate for the centred square hole of side `hole` modules.
function holeInside(N, hole){var lo=(N-hole)>>1,hi=lo+hole;return function(r,c){return r>=lo&&r<hi&&c>=lo&&c<hi;};}

// Measure how many codewords a centred square hole of side `hole` erases.
function qrHoleErase(N, ec, hole){ return qrErasure(N, ec, holeInside(N,hole)); }

// ---------------------------------------------------------------------------
// Shared rendering geometry -- used by i/u/qr.js (analysis) and /_/r.js (the
// homepage tiles) so both cut the artwork into the code the same way.
// ---------------------------------------------------------------------------

// The modules a hole keeps for the artwork: three 3-module bars -- the hole's
// left column (top three rows and bottom three rows) and its right column (top
// three rows).  Coordinates are LOCAL to the hole, so one function serves every
// hole size.
function keep(h,r,c){ return (c===0&&(r<3||r>=h-3))||(c===h-1&&r<3); }
// The holes that use it: 9x9 on 21, 13x13 on 25 and 29, 11x11 on 29.
function keepHole(N,h){ return (N===21&&h===9)||(N===25&&h===13)||(N===29&&(h===11||h===13)); }

// Artwork side as a fraction of the code side: a hole is `hole` modules wide on
// an NxN code, so the artwork covers (hole/N)^2 of the code area.
function artSide(N, hole){ return hole/N; }

// Colour-key an image: the single most-used opaque colour (within `tol` per
// channel) becomes transparent.  When there is nothing to key -- the art already
// carries transparency, or no colour covers `share` of the pixels -- the art's
// own alpha is kept, but binarised at the same >=128 threshold the metric uses.
// Throws if the browser blocks pixel access (file://); callers catch that.
function keyArt(a, tol, share){
  var w=a.naturalWidth||a.width,h=a.naturalHeight||a.height;
  if(!(w&&h))return null;
  var c=document.createElement('canvas');c.width=w;c.height=h;var g=c.getContext('2d');
  g.drawImage(a,0,0);
  var d=g.getImageData(0,0,w,h),p=d.data,cn=p.length,total=cn/4;
  var hist=new Map(),best=0,k=-1,hasAlpha=false;
  for(var i=0;i<cn;i+=4){
    if(p[i+3]<128){hasAlpha=true;continue;}      // art already carries transparency
    var rgb=(p[i]<<16)|(p[i+1]<<8)|p[i+2],n=(hist.get(rgb)||0)+1;hist.set(rgb,n);
    if(n>best){best=n;k=rgb;}}                   // ties keep the first seen colour
  var use=!hasAlpha&&k>=0&&best>=share*total;    // no dominant colour -> no colour key
  var kr=(k>>16)&255,kg=(k>>8)&255,kb=k&255;
  for(var j=0;j<cn;j+=4){
    var al=p[j+3];
    if(al<128||!use){p[j+3]=al<128?0:255;continue;}
    p[j+3]=(Math.abs(p[j]-kr)<=tol&&Math.abs(p[j+1]-kg)<=tol&&Math.abs(p[j+2]-kb)<=tol)?0:255;}
  g.putImageData(d,0,0);
  return c;
}

// ---------------------------------------------------------------------------
// Real 1-bit indexed PNG byte size (like the served .qr1.png files), computed
// from the actual dark module map. Uses the browser CompressionStream so the
// result matches what an optimized encoder produces (~150 B for 21, not ~450).
// ---------------------------------------------------------------------------
function crc32(u8){var c,tb=new Int32Array(256);for(var n=0;n<256;n++){c=n;
  for(var k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);tb[n]=c;}
  var crc=-1;for(var i=0;i<u8.length;i++)crc=(crc>>>8)^tb[(crc^u8[i])&0xFF];
  return (crc^-1)>>>0;}
function chunk(type,data){var len=data.length,out=new Uint8Array(len+12);
  var dv=new DataView(out.buffer);dv.setUint32(0,len);out.set(type,4);out.set(data,8);
  var crcIn=new Uint8Array(4+len);crcIn.set(type,0);crcIn.set(data,4);
  dv.setUint32(len+8,crc32(crcIn));return out;}
async function palettePngBytes(N, isDark, isWhite){
  var rowBytes=Math.ceil(N/8),raw=(rowBytes+1)*N,rawB=new Uint8Array(raw),rp=0;
  for(var y=0;y<N;y++){
    rawB[rp++]=0;
    var acc=0,nb2=0;
    for(var x=0;x<N;x++){
      var dark=isWhite(y,x)?false:isDark(y,x);   // 1 => black
      acc=(acc<<1)|(dark?1:0);nb2++;
      if(nb2==8){rawB[rp++]=acc;acc=0;nb2=0;}
    }
    if(nb2)rawB[rp++]=(acc<<(8-nb2));
  }
  var idat=await new Response(new Blob([rawB]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
  var ihdr=new Uint8Array(13);var dv=new DataView(ihdr.buffer);
  dv.setUint32(0,N);dv.setUint32(4,N);ihdr[8]=1;ihdr[9]=3;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  var plte=new Uint8Array([255,255,255, 0,0,0]);
  var sig=new Uint8Array([137,80,78,71,13,10,26,10]);
  var body=[sig,chunk([73,72,68,82],ihdr),chunk([80,76,84,69],plte),
    chunk([73,68,65,84],new Uint8Array(idat)),chunk([73,69,78,68],new Uint8Array(0))];
  var tot=0;body.forEach(function(b){tot+=b.length;});
  var all=new Uint8Array(tot),o=0;body.forEach(function(b){all.set(b,o);o+=b.length;});
  return all.length;
}
