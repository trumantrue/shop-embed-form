// Fleet dashboard: one page showing every monitor instance's progress,
// state, last change, and live thumbnail, with links into each noVNC.
//
// Progress shown is what each WATCHER read off its rendered page (screen
// truth). The target site's own /status is fetched too, as a cross-check —
// a mismatch > 5% is flagged, because it means the monitor is mis-reading
// the screen, which is exactly what this fleet exists to test.
//
// Env:
//   FLEET   JSON array: [{ "label": "inst-1",
//                          "watcher": "http://mon-1:7100",
//                          "site": "http://site-1:8080",
//                          "novnc": "http://mini:6080/vnc.html" }, ...]
//   PORT    default 7000

const http = require('http');

const PORT = parseInt(process.env.PORT || '7000', 10);
let FLEET = [];
try {
  FLEET = JSON.parse(process.env.FLEET || '[]');
} catch (e) {
  console.error('[dashboard] FLEET env is not valid JSON:', e.message);
  process.exit(1);
}
if (!FLEET.length) console.warn('[dashboard] FLEET is empty — nothing to show');

async function fetchJson(url, timeoutMs = 2500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fleetState() {
  return Promise.all(FLEET.map(async (inst) => {
    const [watcher, site] = await Promise.all([
      fetchJson(`${inst.watcher}/status.json`),
      fetchJson(`${inst.site}/status`),
    ]);
    // Compare the watcher's screen-read against site truth AT THE MOMENT the
    // watcher read it (the fill is linear: (t - startAt) / fillSeconds), not
    // truth now — the read is up to one check-interval stale, which would
    // otherwise register as a false mismatch on fast fills.
    let mismatch = false;
    if (watcher && site && watcher.progress !== null && site.state === 'progress' &&
        watcher.lastCheckAt && site.startAt && site.fillSeconds) {
      const atRead = Math.min(1, Math.max(0,
        (new Date(watcher.lastCheckAt) - new Date(site.startAt)) / (site.fillSeconds * 1000)));
      mismatch = Math.abs(watcher.progress - atRead) > 0.05;
    }
    return { label: inst.label, novnc: inst.novnc, watcher, site, mismatch };
  }));
}

// Minimal proxy: stream a watcher's latest screenshot / act on a site.
function proxyShot(label, res) {
  const inst = FLEET.find((i) => i.label === label);
  if (!inst) { res.writeHead(404); return res.end(); }
  fetch(`${inst.watcher}/shot.png`, { signal: AbortSignal.timeout(4000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
    })
    .catch(() => { res.writeHead(502); res.end(); });
}

async function siteAction(label, path, method, res) {
  const inst = FLEET.find((i) => i.label === label);
  if (!inst) { res.writeHead(404); return res.end('unknown instance'); }
  try {
    const r = await fetch(`${inst.site}${path}`, { method, signal: AbortSignal.timeout(4000) });
    const body = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(String(e.message));
  }
}

const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor fleet</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #1c1c1e;
         color: #eee; margin: 0; padding: 1rem; }
  h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 1rem; color: #bbb; }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.8rem; }
  .card { background: #2a2a2c; border-radius: 10px; padding: 0.9rem 1rem; }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
  .label { font-weight: 700; }
  .badge { font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 99px; background: #444; }
  .badge.ok { background: #1f5c3d; } .badge.form { background: #7a5b16; }
  .badge.down { background: #7a2727; } .badge.warn { background: #7a2727; }
  .track { background: #3f3f3f; border-radius: 4px; padding: 5px 6px; margin: 0.4rem 0; }
  .segs { display: flex; gap: 2px; height: 18px; }
  .seg { flex: 1 1 0; background: #2ecc80; border-radius: 1px; }
  .seg.off { background: transparent; }
  .meta { font-size: 0.75rem; color: #999; line-height: 1.5; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.55rem; }
  a.btn, button.btn { font-size: 0.75rem; padding: 0.3rem 0.7rem; border-radius: 6px;
    background: #3a3a3c; color: #ddd; text-decoration: none; border: 0; cursor: pointer; }
  a.btn.primary { background: #2d5f3f; color: #fff; }
  img.thumb { width: 100%; border-radius: 6px; margin-top: 0.55rem; border: 1px solid #3a3a3c; }
</style>
</head>
<body>
<h1>Monitor fleet</h1>
<div id="grid">loading…</div>
<script>
const SEGS = 33;
function bar(p) {
  let h = '<div class="track"><div class="segs">';
  const filled = Math.round((p || 0) * SEGS);
  for (let i = 0; i < SEGS; i++) h += '<div class="seg' + (i < filled ? '' : ' off') + '"></div>';
  return h + '</div></div>';
}
function card(i) {
  const w = i.watcher, s = i.site;
  let badge = '<span class="badge down">watcher down</span>';
  if (w) {
    if (w.state === 'unreachable') badge = '<span class="badge down">site unreachable</span>';
    else if (s && s.state === 'form') badge = '<span class="badge form">FORM — complete</span>';
    else badge = '<span class="badge ok">running</span>';
  }
  if (i.mismatch) badge += ' <span class="badge warn">screen≠truth</span>';
  const p = w && w.progress !== null ? w.progress : (s && s.state === 'form' ? 1 : 0);
  const pct = Math.round(p * 100);
  return '<div class="card">' +
    '<div class="head"><span class="label">' + i.label + '</span>' + badge + '</div>' +
    bar(p) +
    '<div class="meta">screen-read: ' + (w && w.progress !== null ? pct + '% (' + (w.progressSegments || '') + ')' : '—') +
      ' · site truth: ' + (s ? Math.round((s.progress || 0) * 100) + '%' : '—') +
      ' · submissions: ' + (s ? s.submissions : '—') + '<br>' +
      'checks: ' + (w ? w.checks : '—') +
      ' · last change: ' + (w && w.lastChangeAt ? new Date(w.lastChangeAt).toLocaleTimeString() : 'none') + '</div>' +
    '<div class="row">' +
      '<a class="btn primary" href="' + i.novnc + '" target="_blank">Open browser</a>' +
      '<button class="btn" onclick="fetch(\\'/api/reset/' + i.label + '\\',{method:\\'POST\\'}).then(refresh)">Reset</button>' +
      '<a class="btn" href="/api/submissions/' + i.label + '" target="_blank">Submissions</a>' +
    '</div>' +
    '<img class="thumb" src="/api/shot/' + i.label + '?t=' + Date.now() + '" onerror="this.style.display=\\'none\\'">' +
  '</div>';
}
async function refresh() {
  try {
    const fleet = await (await fetch('/api/fleet', { cache: 'no-store' })).json();
    document.getElementById('grid').innerHTML = fleet.map(card).join('');
  } catch (e) { /* retry next tick */ }
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'GET' && url === '/api/fleet') {
    const state = await fleetState();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(state));
  }
  let m;
  if (req.method === 'GET' && (m = url.match(/^\/api\/shot\/([\w-]+)$/))) return proxyShot(m[1], res);
  if (req.method === 'POST' && (m = url.match(/^\/api\/reset\/([\w-]+)$/))) return siteAction(m[1], '/reset', 'POST', res);
  if (req.method === 'GET' && (m = url.match(/^\/api\/submissions\/([\w-]+)$/))) return siteAction(m[1], '/submissions', 'GET', res);
  if (req.method === 'GET' && url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`[dashboard] listening on :${PORT} (${FLEET.length} instances)`));
