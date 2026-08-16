// Multi-queue test-site: ONE process serving N independent queue instances,
// so 100 targets cost one container instead of 100. Each instance i (1..N) has
// its own queue state and a rotating layout variant, reachable at:
//
//   GET  /q/:i            queue page (or form once admitted) for instance i
//   GET  /q/:i/status     that instance's JSON truth
//   POST /q/:i/reset      re-arm instance i
//   POST /q/:i/submit     record a submission for instance i
//   GET  /status          summary array of all instances (for the dashboard)
//   GET  /healthz         ok
//
// Same queue math and variants as the single-instance server; state is keyed
// by instance id instead of module globals.

const http = require('http');
const { URLSearchParams } = require('url');
const { renderVariant } = require('./variants');

const PORT = parseInt(process.env.PORT || '8080', 10);
const COUNT = parseInt(process.env.COUNT || '100', 10);
const QUEUE_SIZE = parseInt(process.env.QUEUE_SIZE || '1000', 10);

const rnd = require('crypto').randomBytes(4).readUInt32LE(0) / 2 ** 32; // seed-free jitter base
const inst = new Map(); // id -> { startPosition, startAt, admitLogged, submissions:[] }

function arm(id) {
  const q = inst.get(id) || { submissions: [] };
  q.startPosition = Math.floor(Math.random() * QUEUE_SIZE) + 1;
  q.startAt = Date.now();
  q.admitLogged = false;
  // A per-instance queue token — stands in for the session/cookie a real
  // waiting-room issues. It must survive a takeover (monitor -> human) or the
  // site would treat the takeover as a different visitor and lose the place.
  if (!q.token) q.token = `${id}-${require('crypto').randomBytes(6).toString('hex')}`;
  inst.set(id, q);
  return q;
}
function get(id) { return inst.get(id) || arm(id); }
function positionNow(q) {
  return Math.max(0, q.startPosition - Math.floor((Date.now() - q.startAt) / 1000));
}
function progressOf(q) { return (QUEUE_SIZE - positionNow(q)) / QUEUE_SIZE; }
function stateOf(q, id) {
  const admitted = positionNow(q) <= 0;
  if (admitted && !q.admitLogged) { q.admitLogged = true; console.log(`[multi] instance ${id} admitted (FORM)`); }
  return admitted ? 'form' : 'progress';
}
function variantOf(id) { return ((id - 1) % 5) + 1; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shell(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Queue</title>
<style>body{font-family:Georgia,serif;background:#1c1c1e;color:#4d4d4d;margin:0;}
main{max-width:960px;width:100%;box-sizing:border-box;margin:6vh auto;background:#fff;border-radius:4px;padding:32px;}
h1{margin-top:0;color:#333;}label{display:block;margin:1rem 0 .25rem;font-weight:bold;}
input,textarea{width:100%;box-sizing:border-box;padding:.5rem;border:1px solid #bbb;border-radius:4px;font-size:1rem;}
button{margin-top:1.25rem;padding:.6rem 1.5rem;font-size:1rem;background:#35be86;color:#fff;border:0;border-radius:4px;cursor:pointer;}</style>
</head><body><main>${body}</main></body></html>`;
}

function queuePage(id) {
  const q = get(id);
  const v = renderVariant(variantOf(id), progressOf(q));
  // The variant scripts poll /status (relative) — rewrite to this instance's path.
  const body = v.body.replace(/'\/status'/g, `'/q/${id}/status'`);
  return shell(`<style>${v.css}</style>\n${body}`);
}
function formPage(id) {
  return shell(`<h1>We need your input</h1>
    <p>You've reached the front of the queue. If you're seeing this through the remote browser,
       take control and fill in the form to prove the takeover works.</p>
    <form method="POST" action="/q/${id}/submit">
      <label for="name">Name</label><input id="name" name="name" required>
      <label for="email">Email</label><input id="email" name="email" type="email" required>
      <label for="note">Note</label><textarea id="note" name="note" rows="3"></textarea>
      <button type="submit">Submit</button>
    </form>`);
}

const server = http.createServer((req, res) => {
  const send = (code, b, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(b);
  };
  const url = req.url.split('?')[0];

  let m;
  if (req.method === 'GET' && (m = url.match(/^\/q\/(\d+)\/status$/))) {
    const id = +m[1]; const q = get(id); const pos = positionNow(q);
    return send(200, JSON.stringify({
      id, state: stateOf(q, id), progress: Number(progressOf(q).toFixed(4)),
      position: pos, startPosition: q.startPosition, queueSize: QUEUE_SIZE,
      startAt: new Date(q.startAt).toISOString(), variant: variantOf(id),
      submissions: q.submissions.length,
    }), 'application/json');
  }
  if (req.method === 'POST' && url === '/reset-all') {
    for (let id = 1; id <= COUNT; id++) arm(id);
    return send(200, JSON.stringify({ ok: true, reset: COUNT }), 'application/json');
  }
  if (req.method === 'POST' && (m = url.match(/^\/q\/(\d+)\/reset$/))) {
    const id = +m[1]; const q = arm(id);
    return send(200, JSON.stringify({ ok: true, id, startPosition: q.startPosition }), 'application/json');
  }
  if (req.method === 'GET' && (m = url.match(/^\/q\/(\d+)\/submissions$/))) {
    const id = +m[1]; const q = get(id);
    return send(200, JSON.stringify(q.submissions, null, 2), 'application/json');
  }
  if (req.method === 'POST' && (m = url.match(/^\/q\/(\d+)\/submit$/))) {
    const id = +m[1]; const q = get(id); let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(raw);
      q.submissions.push({ name: p.get('name') || '', email: p.get('email') || '', at: new Date().toISOString() });
      send(200, shell(`<h1>Thanks, recorded</h1><p>Submission #${q.submissions.length} for instance ${id}: <b>${esc(p.get('name') || '')}</b></p><p><a href="/q/${id}">Back</a></p>`));
    });
    return;
  }
  if (req.method === 'GET' && (m = url.match(/^\/q\/(\d+)\/?$/))) {
    const id = +m[1]; if (id < 1 || id > COUNT) return send(404, 'no such instance', 'text/plain');
    const q = get(id);
    // Issue the queue-token cookie (the session a takeover must inherit).
    res.setHeader('Set-Cookie', `qtoken=${q.token}; Path=/; SameSite=Lax`);
    return send(200, stateOf(q, id) === 'form' ? formPage(id) : queuePage(id));
  }
  if (req.method === 'GET' && url === '/status') {
    const out = [];
    for (let id = 1; id <= COUNT; id++) { const q = get(id); out.push({ id, variant: variantOf(id), state: stateOf(q, id), progress: Number(progressOf(q).toFixed(4)), submissions: q.submissions.length }); }
    return send(200, JSON.stringify(out), 'application/json');
  }
  if (req.method === 'GET' && url === '/healthz') return send(200, 'ok', 'text/plain');
  send(404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  for (let id = 1; id <= COUNT; id++) arm(id);
  console.log(`[multi] listening on :${PORT} — ${COUNT} queue instances, size ${QUEUE_SIZE}`);
});
