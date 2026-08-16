// Text/numeric dashboard for the pooled multi-watcher (100+ instances). No
// thumbnails, no per-instance noVNC — at this scale reporting is numeric.
// Reads MULTI_WATCHER/status.json (one call, array of all instances) and
// renders a summary bar, a leaderboard, and a dense grid of numeric bars.
//
// Env: MULTI_WATCHER (e.g. http://mon:7100), PORT (default 7000).

const http = require('http');
const PORT = parseInt(process.env.PORT || '7000', 10);
const MW = (process.env.MULTI_WATCHER || 'http://localhost:7100').replace(/\/+$/, '');
const SITE = (process.env.MULTI_SITE || 'http://localhost:8080').replace(/\/+$/, '');

async function fetchStatus() {
  try {
    const r = await fetch(`${MW}/status.json`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Proxy a request through to the multi-queue site (reset / submissions /
// the actual queue page). The dashboard is the only tailnet-exposed service,
// so it fronts the site's controls the way 7300 fronts the fleet's.
async function proxySite(pathAndMethod, res, contentType) {
  try {
    const r = await fetch(`${SITE}${pathAndMethod.path}`, { method: pathAndMethod.method, signal: AbortSignal.timeout(5000) });
    const body = await r.text();
    res.writeHead(r.status, { 'Content-Type': contentType || r.headers.get('content-type') || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(String(e.message));
  }
}

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Fleet (scale)</title>
<style>
 body{font-family:-apple-system,Helvetica,Arial,sans-serif;background:#1c1c1e;color:#eee;margin:0;padding:1rem;}
 h1{font-size:1.05rem;color:#bbb;margin:0 0 .8rem;}
 .sum{display:flex;gap:1.5rem;flex-wrap:wrap;background:#2a2a2c;border-radius:10px;padding:.8rem 1.1rem;margin-bottom:1rem;font-size:.85rem;}
 .sum b{color:#2ecc80;font-size:1.1rem;}
 .lead{background:#2a2a2c;border-radius:10px;padding:.7rem 1.1rem;margin-bottom:1rem;font-size:.8rem;color:#ccc;}
 .lead .who{color:#2ecc80;font-weight:700;}
 #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.5rem;}
 .cell{background:#2a2a2c;border-radius:6px;padding:.45rem .55rem;font-size:.72rem;}
 .cell .h{display:flex;justify-content:space-between;color:#aaa;margin-bottom:.3rem;}
 .cell .h .m{font-size:.62rem;color:#777;}
 .bar{background:#4d4d4d;border-radius:2px;height:10px;overflow:hidden;}
 .fill{background:#35be86;height:100%;}
 .form .fill{background:#7a5b16;} .form{outline:1px solid #7a5b16;}
 .unreachable{outline:1px solid #7a2727;} .unreachable .h{color:#e88;}
 .ctl{display:flex;gap:.3rem;margin-top:.4rem;}
 .ctl a,.ctl button{font-size:.6rem;padding:.15rem .35rem;border-radius:4px;background:#3a3a3c;color:#ccc;border:0;text-decoration:none;cursor:pointer;}
 .topbar{display:flex;justify-content:space-between;align-items:center;}
 button.reset-all{font-size:.8rem;padding:.45rem .9rem;border-radius:7px;border:0;background:#7a2727;color:#fff;cursor:pointer;}
</style></head><body>
<div class="topbar"><h1>Monitor fleet — scale mode</h1>
  <button class="reset-all" onclick="resetAll(this)">Reset all</button></div>
<div class="sum" id="sum">loading…</div>
<div class="lead" id="lead"></div>
<div id="grid"></div>
<script>
async function refresh(){
 let d; try{ d=await (await fetch('/api/status',{cache:'no-store'})).json(); }catch(e){ return; }
 if(!d||!d.instances){ document.getElementById('sum').textContent='multi-watcher unreachable'; return; }
 const xs=d.instances;
 const ok=xs.filter(x=>x.state==='ok'||x.state==='form').length;
 const forms=xs.filter(x=>x.state==='form').length;
 const down=xs.filter(x=>x.state==='unreachable').length;
 const detected=xs.filter(x=>x.progress!=null).length;
 const methods={}; xs.forEach(x=>{if(x.method)methods[x.method]=(methods[x.method]||0)+1;});
 document.getElementById('sum').innerHTML=
   '<div><b>'+d.count+'</b> instances</div><div>pool <b>'+d.pool+'</b></div>'+
   '<div>detecting <b>'+detected+'</b></div><div>admitted <b>'+d.admittedTotal+'</b></div>'+
   '<div>at form <b>'+forms+'</b></div>'+(down?'<div>unreachable <b>'+down+'</b></div>':'')+
   '<div>methods: '+Object.entries(methods).map(m=>m[0]+' '+m[1]).join(', ')+'</div>';
 const ranked=xs.map(x=>({id:x.id,p:x.state==='form'?1:(x.progress||0)})).sort((a,b)=>b.p-a.p);
 const win=ranked[0];
 document.getElementById('lead').innerHTML='🏆 Currently winning: <span class="who">#'+win.id+'</span> at '+Math.round(win.p*100)+'% — top 5: '+
   ranked.slice(0,5).map(r=>'#'+r.id+' '+Math.round(r.p*100)+'%').join(' · ');
 document.getElementById('grid').innerHTML=xs.map(function(x){
   const p=x.state==='form'?1:(x.progress||0);
   const cls='cell'+(x.state==='form'?' form':'')+(x.state==='unreachable'?' unreachable':'');
   return '<div class="'+cls+'"><div class="h"><span>#'+x.id+' V'+x.variant+'</span><span class="m">'+(x.method||x.state||'')+'</span></div>'+
     '<div class="bar"><div class="fill" style="width:'+Math.round(p*100)+'%"></div></div>'+
     '<div class="ctl">'+
       '<button onclick="resetOne('+x.id+',this)">Reset</button>'+
       '<a href="/api/page/'+x.id+'" target="_blank">Open</a>'+
       '<a href="/api/submissions/'+x.id+'" target="_blank">Subs</a>'+
     '</div></div>';
 }).join('');
}
async function resetAll(btn){
  if(!confirm('Reset ALL instances? Every queue restarts at a new random position.'))return;
  btn.disabled=true;btn.textContent='Resetting…';
  try{await fetch('/api/reset-all',{method:'POST'});await refresh();}finally{btn.disabled=false;btn.textContent='Reset all';}
}
async function resetOne(id,btn){btn.disabled=true;try{await fetch('/api/reset/'+id,{method:'POST'});await refresh();}finally{btn.disabled=false;}}
refresh(); setInterval(refresh,5000);
</script></body></html>`;

http.createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
  if (req.url === '/api/status') {
    const s = await fetchStatus();
    res.writeHead(s ? 200 : 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(s || { error: 'multi-watcher unreachable' }));
  }
  let m;
  if (req.method === 'POST' && req.url === '/api/reset-all') return proxySite({ path: '/reset-all', method: 'POST' }, res, 'application/json');
  if (req.method === 'POST' && (m = req.url.match(/^\/api\/reset\/(\d+)$/))) return proxySite({ path: `/q/${m[1]}/reset`, method: 'POST' }, res, 'application/json');
  if (req.method === 'GET' && (m = req.url.match(/^\/api\/submissions\/(\d+)$/))) return proxySite({ path: `/q/${m[1]}/submissions`, method: 'GET' }, res, 'application/json');
  if (req.method === 'GET' && (m = req.url.match(/^\/api\/page\/(\d+)$/))) return proxySite({ path: `/q/${m[1]}`, method: 'GET' }, res, 'text/html; charset=utf-8');
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`[multi-dashboard] :${PORT} -> ${MW}`));
