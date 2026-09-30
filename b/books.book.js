(function(){
window.books=window.books||{};
const book=window.books.book={
                s:async(pdf,src,pno=1)=>{
                    nav.DisButtons();
                    book.pdf=pdf;
                    book.src=src;
                    uishow(_fBook, !uishow(_cBook, pdf))
                    nav.UpdButtons();
                    if(pdf){_iBook.src=book.srcBase()+".jpg"; uishow(_iBook, pno==1);} // the poster is page 1 – only show it when page 1 is what opens
                    return pdf ? await book.sPdf(src,pno) : book.sExt(src);
                }
                ,sExt:src=>_fBook.src=src
                ,sPdf:async(src,pno=1)=>await window.cBook.DoShow(src, pno, false) // load without render – uisz() renders once after
                ,aRatio:(2*4.13)/5.83 // Golden ratio
                ,szWH:(w,h)=>{
                    if(nMt.innerText!='⏶') 
                        _cBook.style.top = _fBook.style.top = (window.innerHeight-h)/2+'px';
                    _fBook.style.width = w+'px';
                    _fBook.style.height = h+'px';
                    const cw=Math.round(w), ch=Math.round(h); // only set when changed – else canvas clears (blink)
                    if(_cBook.width!=cw)_cBook.width=cw;
                    if(_cBook.height!=ch)_cBook.height=ch;
                    book.whole = h <= window.innerHeight; // whole sheet fits → left/right page nav
                    _dBook.style.paddingTop = book.whole ? Math.max(0,(window.innerHeight-h)/2)+'px' : ''; // whole sheet → centered in the middle
                    book.hAlign.Scroll();
                }
                ,szW:w=>book.szWH(w,w/book.aRatio)
                ,sz:(w,h)=>{
                    w*=2; // Adjust so double as wide as needed (so that iframe and canvas only show half!)
                    book.szWH(w,w/book.aRatio);
                    if(book.pdf) return window.cBook.Width(w,true); // re-render at new size – return promise for load chain
                }
                ,hAlign:{
                    _:true
                    ,L:l=>{
                        book.hAlign._=l;
                        nav.memSet('lang', l);
                        nLg.innerText=l?'🇳🇴':'🇬🇧';
                        _fBook.style.left=(l?0:(_dBook.clientWidth-_fBook.offsetWidth))+'px';
                        book.hAlign.Scroll();
                        _dTocList.innerHTML=''; // invalidate TOC cache (rebuilt with new language on open)
                    }
                    ,Load:async()=>{
                        let v=(await nav.memGet('lang', new String(book.hAlign._))=="true") ;
                        if (book.hAlign._!=v)
                            book.hAlign.L(v);
                    }
                    ,Scroll:()=>_dBook.scrollLeft=book.hAlign._?0:_dBook.scrollWidth-_dBook.clientWidth
                }
                ,prem:{
                    _:false // true=premium, false=freemium
                    ,ui:(l=book.prem._)=>{ // button-only UI, no re-render / TOC work (used at load, before first paint)
                        nPr.innerText=l?'👑':'🔓';
                        if(nMt.innerText=='⏷')nPr.style.display=l?'none':'inline'; // floating 🔓 only in freemium (outside menu)
                        return l;
                    }
                    ,L:async l=>{
                        book.prem._=l;
                        nav.memSet('prem', l);
                        book.prem.ui(l);
                        if(_dToc.style.display!='none')_dTocList.innerHTML=await nav.Toc(); // TOC open → rebuild with new mode
                        else _dTocList.innerHTML=''; // invalidate cache → rebuilt on next open
                        if(_dToc.style.display!='none')nFdTxt.value=''; // the box is a filter only in the TOC – clear it there (list was rebuilt unfiltered)
                        nav.UpdButtons();
                        window.cBook&&window.cBook.pdf&&window.cBook.Page(window.cBook.pn, true); // re-render in new mode (PDF must be loaded)
                    }
                    ,Load:async()=>{
                        // Re-validate stored code against server in background (never blocks first view); revoke if over device limit.
                        const code=await nav.memGet('code','');
                        if(!code)return; // no stored code – keep current mode (backward compatible)
                        const r=await nav.StillValid(code); // "still OK?" – rolling window / limit
                        if(r===undefined||r===null)return; // db.js unavailable – don't conclude
                        const ok=r===true||!!(r&&r.ok); // supports old bool and new {ok} object
                        if(ok){if(!book.prem._)book.prem.L(true);} // still OK → premium (silent)
                        else if(book.prem._){ // not OK (over limit / expired) → revoke + ask for code again
                            if(r.reason!=='error'&&r.reason!=='connection'&&r.reason!=='noconfig')
                                nav.memSet('code',''); // revoke stored code → must re-enter (network errors don't punish user)
                            book.prem.L(false);
                            nav.PinOpen();
                        }
                    }
                }
                ,Page:async pn=>{                    
                    nGoTxt.value = pn;
                    await cBook.Page(pn, true);
                }
                ,src:"b/LifeDemandedDeath/b.pdf"
                ,srcBase:()=>{ return book.src.replace(/\.pdf$/i,"");} // keep folder (b/...) so sidecars (.jpg/.png) sit next to the book
                ,name:()=>{const p=book.src.split("/");return p.length>2?p[p.length-2]:p[p.length-1].replace(/\.pdf$/i,"")} // nested: identity = parent folder
                ,pn:()=>window.cBook?.pn||1
                ,np:()=>window.cBook?.pdf?Math.max(1,window.cBook.pdf.numPages-4):1 // last 4 pages are template slides – hidden (min 1 for small PDFs)
            };
})();