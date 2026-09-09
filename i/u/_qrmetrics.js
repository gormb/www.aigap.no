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
// SIZES handled: version 1 (21), 2 (25), 3 (29) — every RS block has equal
// data and equal EC counts, so the interleave is a simple round-robin.

// RS_BLOCK_TABLE[version-1] => [L,M,Q,H], each entry [count,total,data]
var RS = {
  1: {L:[1,26,19],M:[1,26,16],Q:[1,26,13],H:[1,26,9]},
  2: {L:[1,44,34],M:[1,44,28],Q:[1,44,22],H:[1,44,16]},
  3: {L:[1,70,55],M:[1,70,44],Q:[2,35,17],H:[2,35,13]}
};
var ALIGN = {1:[],2:[6,18],3:[6,22]};

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
  // (version info only exists for v>=7, not here)

  // mapData placement order
  var rs=RS[v][ec], nb=rs[0], total=rs[1];  // per-table-entry total codewords
  var totalCW=nb*total;                     // total codewords (data+ec) across blocks
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
  var dataTotal=rs[2]*nb;
  return {cells:cells, nb:nb, dataTotal:dataTotal, ecPer:total-rs[2], totalCW:totalCW, remainder:cells.length-totalCW*8};
}

// Measure how many codewords of each RS block a centred square hole of side
// `hole` modules erases (a codeword counts as erased if ANY of its modules is
// inside the hole).
function qrHoleErase(N, ec, hole){
  var L=dataCells(N,ec), nb=L.nb, ecPer=L.ecPer, maxBit=L.totalCW*8;
  var lo=(N-hole)>>1, hi=lo+hole;   // [lo,hi)
  var hit={};                        // cw -> block (only real codeword bits)
  for(var i=0;i<L.cells.length;i++){
    var cl=L.cells[i];
    if(cl.seq>=maxBit) continue;     // remainder bits carry no codeword
    if(cl.r>=lo&&cl.r<hi&&cl.c>=lo&&cl.c<hi){ var cw=(cl.seq/8)|0; hit[cw]=1; }
  }
  var perBlock=[];for(var b=0;b<nb;b++)perBlock.push(0);
  for(var cw in hit) perBlock[cw%nb]++;   // equal data/ec => block = cw % nb
  var worst=0;for(var b2=0;b2<nb;b2++)if(perBlock[b2]>worst)worst=perBlock[b2];
  // guaranteed decode <= ecPer/2 (random errors); erasure-only <= ecPer; else fail
  var col;
  if(worst*2<=ecPer)col='g';
  else if(worst<=ecPer)col='y';
  else col='r';
  return {erased:worst, ecPer:ecPer, col:col, perBlock:perBlock};
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
async function palettePngBytes(N, hole, isDark){
  var rowBytes=Math.ceil(N/8),raw=(rowBytes+1)*N,rawB=new Uint8Array(raw),rp=0;
  var lo=(N-hole)>>1,hi=lo+hole;
  for(var y=0;y<N;y++){
    rawB[rp++]=0;
    var acc=0,nb2=0;
    for(var x=0;x<N;x++){
      var inHole=y>=lo&&y<hi&&x>=lo&&x<hi;
      var dark=inHole?false:isDark(y,x);   // 1 => black
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
