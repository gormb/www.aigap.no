const fs = require('fs');
const t = fs.readFileSync(process.cwd() + '/db.js', 'utf8');
const U = t.match(/url:"([^"]+)"/)[1];
const K = t.match(/publishableKey:"([^"]+)"/)[1];
(async () => {
  const q = 'id=in.(' + ['bgda','bgdaqra','bmd','bmdqra','ldd','lddqra','chat','b20km','ldi','ldiqra'].map(e => '"' + e + '"').join(',') + ')';
  const r = await fetch(U + '/rest/v1/redir?select=id,url,group,sort&' + q, {
    headers: { apikey: K, Authorization: 'Bearer ' + K }
  });
  console.log(JSON.stringify(await r.json(), null, 2));
})().catch(e => { console.error(e); process.exit(1); });
