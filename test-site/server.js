// Simulated target site for testing the monitor's alert + takeover flow.
//
// The page shows a segmented progress bar (styled after the reference
// screenshot: dark track, green segments, partial last segment) that fills
// at a per-instance random rate: a full fill takes a random duration in
// [PROGRESS_MIN_SECONDS, PROGRESS_MAX_SECONDS], chosen at start/reset.
// When the bar reaches 100% the page flips to a data-input form.
// Submissions are recorded in memory so you can verify that remote browser
// control actually worked.
//
//   GET  /            progress page or form, depending on state
//   POST /submit      records the form submission
//   GET  /status      JSON: state, progress, fill duration, submission count
//   GET  /submissions JSON: everything submitted so far
//   POST /reset       back to 0%, picks a new random fill duration
//   GET  /healthz     ok
//
// Progress is computed from wall-clock (startAt + fillSeconds), not a timer,
// so it survives any pause and needs no interval. The page updates itself
// by polling /status every 2s and re-rendering the bar client-side (no page
// reload, so a watcher's screenshot and a noVNC viewer both see it live).

const http = require('http');
const { URLSearchParams } = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROGRESS_MIN_SECONDS = parseInt(process.env.PROGRESS_MIN_SECONDS || '600', 10);
const PROGRESS_MAX_SECONDS = parseInt(process.env.PROGRESS_MAX_SECONDS || '2400', 10);
// Segment count measured from the reference screenshot (~33 full segments
// assuming uniform track padding at both ends). Override if re-measured.
const TOTAL_SEGMENTS = parseInt(process.env.TOTAL_SEGMENTS || '33', 10);

let fillSeconds = 0;
let startAt = 0;
let flipLogged = false;
const submissions = [];

function arm() {
  fillSeconds = Math.round(
    PROGRESS_MIN_SECONDS + Math.random() * Math.max(0, PROGRESS_MAX_SECONDS - PROGRESS_MIN_SECONDS));
  startAt = Date.now();
  flipLogged = false;
  console.log(`[test-site] armed: full fill in ${fillSeconds}s ` +
    `(completes ~${new Date(startAt + fillSeconds * 1000).toISOString()})`);
}

function progressNow() {
  if (!startAt) return 0;
  return Math.min(1, (Date.now() - startAt) / (fillSeconds * 1000));
}

function stateNow() {
  const done = progressNow() >= 1;
  if (done && !flipLogged) {
    flipLogged = true;
    console.log(`[test-site] progress complete — flipped to FORM at ${new Date().toISOString()}`);
  }
  return done ? 'form' : 'progress';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pageShell(body) {
  // Static text only — the only text change the monitor should ever see is
  // the flip to the form. The bar itself carries no text (progress numbers
  // live in data attributes), so bar growth is a pixel-only change that the
  // watcher masks out.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Monitor test target</title>
<style>
  body { font-family: Georgia, serif; background: #f5f2ea; color: #222; margin: 0; }
  main { max-width: 720px; margin: 8vh auto; background: #fff; border: 1px solid #ddd;
         border-radius: 8px; padding: 2.5rem 3rem; }
  h1 { margin-top: 0; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: bold; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 0.5rem;
                    border: 1px solid #bbb; border-radius: 4px; font-size: 1rem; }
  button { margin-top: 1.25rem; padding: 0.6rem 1.5rem; font-size: 1rem;
           background: #2d5f3f; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  /* Segmented progress bar, after the reference screenshot: dark uniform
     track, green segments with a small gap, partial last segment. */
  #bar-wrap { background: #3f3f3f; border-radius: 5px; padding: 14px 16px;
              width: fit-content; max-width: 100%; overflow: hidden; }
  #bar { display: flex; gap: 4px; height: 56px; }
  .seg { width: 14px; flex: none; background: #2ecc80; border-radius: 2px; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function progressPage() {
  return pageShell(`
  <h1>Work in progress</h1>
  <p>This page is filling a progress bar at its own pace. When it completes,
     it will turn into a data-input form, and the monitor watching it should
     raise an alert.</p>
  <div id="bar-wrap"><div id="bar" data-progress="0" data-segments="${TOTAL_SEGMENTS}"></div></div>
<script>
  const TOTAL = ${TOTAL_SEGMENTS};
  const bar = document.getElementById('bar');
  function render(p) {
    bar.setAttribute('data-progress', p.toFixed(4));
    const filled = p * TOTAL;
    const full = Math.floor(filled);
    const frac = filled - full;
    let html = '';
    for (let i = 0; i < full; i++) html += '<div class="seg"></div>';
    if (full < TOTAL && frac > 0.02) {
      html += '<div class="seg" style="width:' + Math.round(frac * 14) + 'px"></div>';
    }
    // Invisible spacers keep the track its full width from 0%.
    for (let i = Math.ceil(filled); i < TOTAL; i++) html += '<div class="seg" style="background:transparent"></div>';
    bar.innerHTML = html;
  }
  async function tick() {
    try {
      const s = await (await fetch('/status', { cache: 'no-store' })).json();
      if (s.state === 'form') { location.reload(); return; }
      render(s.progress);
    } catch (e) { /* transient; try again next tick */ }
  }
  render(0);
  tick();
  setInterval(tick, 2000);
</script>
`);
}

const formPage = pageShell(`
  <h1>We need your input</h1>
  <p>The page has changed. If you are seeing this through the remote browser,
     take control and fill in the form to prove the takeover works.</p>
  <form method="POST" action="/submit">
    <label for="name">Name</label>
    <input id="name" name="name" required>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required>
    <label for="note">Note</label>
    <textarea id="note" name="note" rows="3"></textarea>
    <button type="submit">Submit</button>
  </form>
`);

const server = http.createServer((req, res) => {
  const send = (code, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  if (req.method === 'GET' && req.url === '/') {
    return send(200, stateNow() === 'form' ? formPage : progressPage());
  }

  if (req.method === 'POST' && req.url === '/submit') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(raw);
      const entry = {
        name: p.get('name') || '',
        email: p.get('email') || '',
        note: p.get('note') || '',
        at: new Date().toISOString(),
      };
      submissions.push(entry);
      console.log(`[test-site] submission received:`, entry);
      send(200, pageShell(`
        <h1>Thanks, recorded</h1>
        <p>Submission #${submissions.length} stored:</p>
        <p><b>${esc(entry.name)}</b> &lt;${esc(entry.email)}&gt;</p>
        <p>${esc(entry.note)}</p>
        <p><a href="/">Back</a></p>
      `));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    return send(200, JSON.stringify({
      state: stateNow(),
      progress: Number(progressNow().toFixed(4)),
      fillSeconds,
      startAt: startAt ? new Date(startAt).toISOString() : null,
      totalSegments: TOTAL_SEGMENTS,
      submissions: submissions.length,
    }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/submissions') {
    return send(200, JSON.stringify(submissions, null, 2), 'application/json');
  }

  if (req.method === 'POST' && req.url === '/reset') {
    arm();
    return send(200, JSON.stringify({ ok: true, fillSeconds }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    return send(200, 'ok', 'text/plain');
  }

  send(404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`[test-site] listening on :${PORT} (segments=${TOTAL_SEGMENTS}, ` +
    `fill range ${PROGRESS_MIN_SECONDS}-${PROGRESS_MAX_SECONDS}s)`);
  arm();
});
