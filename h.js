const f=document.querySelector('iframe'),p=document.getElementById('p');
document.querySelectorAll('nav a.sec').forEach(a=>a.onclick=()=>{
  document.querySelector('.on')?.classList.remove('on');a.classList.add('on');
  if(a.dataset.u){p.hidden=1;f.hidden=0;f.src=a.dataset.u}
  else{f.hidden=1;p.hidden=0;p.textContent=a.dataset.n+' — coming soon'}
})
