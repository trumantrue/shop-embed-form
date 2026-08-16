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
const TAKEOVER_CTRL = (process.env.TAKEOVER_CTRL || '').replace(/\/+$/, '');
const TAKEOVER_VNC = process.env.TAKEOVER_VNC || '';

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
 .takeover{outline:2px solid #2d6f9f;} .takeover .h{color:#7db8e8;}
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
let CFG={takeover:false,takeoverVnc:''};
fetch('/api/config').then(r=>r.json()).then(c=>{CFG=c;}).catch(function(){});
async function takeover(id,btn){
  if(!CFG.takeover){alert('Takeover not configured');return;}
  btn.disabled=true;const t=btn.textContent;btn.textContent='…';
  try{
    const r=await fetch('/api/takeover/'+id,{method:'POST'});
    if(!r.ok){alert('Takeover failed');return;}
    const j=await r.json();
    window.open(CFG.takeoverVnc,'_blank');
    console.log('takeover #'+id+' adopted '+j.adoptedCookies+' cookie(s) from the monitor session');
  }finally{btn.disabled=false;btn.textContent=t;}
}
async function release(id,btn){
  btn.disabled=true;btn.textContent='…';
  try{await fetch('/api/release/'+id,{method:'POST'});await refresh();}
  finally{btn.disabled=false;}
}
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
   const cls='cell'+(x.state==='form'?' form':'')+(x.state==='unreachable'?' unreachable':'')+(x.state==='takeover'?' takeover':'');
   return '<div class="'+cls+'"><div class="h"><span>#'+x.id+' V'+x.variant+'</span><span class="m">'+(x.method||x.state||'')+'</span></div>'+
     '<div class="bar"><div class="fill" style="width:'+Math.round(p*100)+'%"></div></div>'+
     '<div class="ctl">'+
       (CFG.takeover?(x.state==='takeover'
          ? '<button onclick="release('+x.id+',this)" title="hand the session back to the monitor" style="background:#7a5b16;color:#fff">Release</button>'
          : '<button onclick="takeover('+x.id+',this)" title="VNC into this instance, sharing its monitored session">VNC</button>')
        :'')+
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
  if (req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ takeover: !!(TAKEOVER_CTRL && TAKEOVER_VNC), takeoverVnc: TAKEOVER_VNC }));
  }
  // Takeover: (1) pause monitoring of :id and export its session from the
  // watcher, (2) have the takeover browser adopt that session and navigate.
  // The human then drives the SAME session the monitor established.
  if (req.method === 'POST' && (m = req.url.match(/^\/api\/takeover\/(\d+)$/))) {
    if (!TAKEOVER_CTRL) { res.writeHead(503); return res.end('takeover not configured'); }
    const id = m[1];
    try {
      const t = await (await fetch(`${MW}/takeover/${id}`, { method: 'POST', signal: AbortSignal.timeout(15000) })).json();
      const r = await fetch(`${TAKEOVER_CTRL}/adopt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: t.url || `${SITE}/q/${id}`, storageState: t.storageState || null }),
        signal: AbortSignal.timeout(25000),
      });
      const body = await r.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: !!body.ok, id: +id, current: body.current, adoptedCookies: (t.storageState && t.storageState.cookies ? t.storageState.cookies.length : 0) }));
    } catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain' }); return res.end(String(e.message)); }
  }
  // Release: pull the human's final session out of the takeover browser and
  // hand it back to the watcher, which resumes monitoring with it.
  if (req.method === 'POST' && (m = req.url.match(/^\/api\/release\/(\d+)$/))) {
    if (!TAKEOVER_CTRL) { res.writeHead(503); return res.end('takeover not configured'); }
    const id = m[1];
    try {
      const rel = await (await fetch(`${TAKEOVER_CTRL}/release`, { method: 'POST', signal: AbortSignal.timeout(15000) })).json();
      await fetch(`${MW}/release/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageState: rel.storageState || null }), signal: AbortSignal.timeout(15000),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, id: +id }));
    } catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain' }); return res.end(String(e.message)); }
  }
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`[multi-dashboard] :${PORT} -> ${MW}`));
