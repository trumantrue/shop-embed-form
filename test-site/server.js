// Simulated target site for testing the monitor's alert + takeover flow.
//
// The page is a virtual waiting-room QUEUE. It shows the segmented queue bar
// from the front-end handover: a full row of fixed green segments is laid
// across the track from first paint, and a grey mask anchored to the right
// retracts as the queue position falls, uncovering segments left-to-right.
// (Mask, track and border are the same grey, so the mask reads as empty
// track — it is a REVEAL, not a fill.)
//
// Per the handover's §10 architectural note, the component does NOT own the
// countdown: the server is the source of truth (needed so the monitor can
// cross-check what it reads off the screen), and the page renders the
// position it is given. Position is derived from a start timestamp, so it is
// drift-free and survives a reload.
//
//   Queue size ...... QUEUE_SIZE (default 1000), configurable
//   Start position .. random 1..QUEUE_SIZE at start/reset
//   Decrement ....... 1 per second, floored at 0
//   Admit ........... position reaches 0 -> flip to the data-input form
//                     (admit at 0, not <=1, so the bar visibly completes)
//
//   GET  /            queue page or form, depending on state
//   POST /submit      records the form submission
//   GET  /status      JSON: state, progress, position, startPosition, queueSize
//   GET  /submissions JSON: everything submitted so far
//   POST /reset       re-arm with a new random start position
//   GET  /healthz     ok

const http = require('http');
const { URLSearchParams } = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const QUEUE_SIZE = parseInt(process.env.QUEUE_SIZE || '1000', 10);

let startPosition = 0;
let startAt = 0;
let admitLogged = false;
const submissions = [];

function arm() {
  startPosition = Math.floor(Math.random() * QUEUE_SIZE) + 1; // 1..QUEUE_SIZE
  startAt = Date.now();
  admitLogged = false;
  console.log(`[test-site] armed: queue position ${startPosition}/${QUEUE_SIZE} ` +
    `(admits in ~${startPosition}s)`);
}

function positionNow() {
  if (!startAt) return QUEUE_SIZE;
  const elapsedSec = Math.floor((Date.now() - startAt) / 1000);
  return Math.max(0, startPosition - elapsedSec);
}

function progressFrom(position) {
  return (QUEUE_SIZE - position) / QUEUE_SIZE; // 0..1
}

function stateNow() {
  const admitted = positionNow() <= 0;
  if (admitted && !admitLogged) {
    admitLogged = true;
    console.log(`[test-site] admitted — flipped to FORM at ${new Date().toISOString()}`);
  }
  return admitted ? 'form' : 'progress';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pageShell(body) {
  // Handover colours: page ground dark, card #fff, body copy + track #4d4d4d.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor test target</title>
<style>
  body { font-family: Georgia, serif; background: #1c1c1e; color: #4d4d4d; margin: 0; }
  main { max-width: 960px; width: 100%; box-sizing: border-box; margin: 6vh auto;
         background: #fff; border-radius: 4px; padding: 32px; }
  h1 { margin-top: 0; color: #333; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: bold; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 0.5rem;
                    border: 1px solid #bbb; border-radius: 4px; font-size: 1rem; }
  button { margin-top: 1.25rem; padding: 0.6rem 1.5rem; font-size: 1rem;
           background: #35be86; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }

  /* Queue bar — verbatim from the handover §7. Track, border and mask share
     #4d4d4d so the mask is seamless. Segment is 24 tall in a 24 channel with
     2px vertical margins; its 28px margin-box is clipped by overflow:hidden,
     so segments meet the border top and bottom with no vertical gap. */
  .qbar {
    position: relative;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    height: 32px;
    width: 100%;
    margin: 32px 0;
    overflow: hidden;
    border: 4px solid #4d4d4d;
    background: #4d4d4d;
    box-sizing: border-box;
  }
  .qbar-seg {
    margin: 2px;
    height: 24px;
    width: 16px;
    background: #35be86;
    flex: none;
  }
  .qbar-mask {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    background: #4d4d4d;
    transition: width 1000ms linear;
  }
  @media (prefers-reduced-motion: reduce) {
    .qbar-mask { transition: none; }
  }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function queuePage() {
  const position = positionNow();
  const progress = progressFrom(position);
  const maskWidth = ((1 - progress) * 100).toFixed(2);
  // Server-render the mask at its true width (handover gotcha 1 & 3): no
  // one-second sweep-up on load, and the bar is meaningful before hydration.
  return pageShell(`
  <h1>You're in the queue</h1>
  <p>Please wait — you'll be admitted automatically when it's your turn.
     When you reach the front, this page becomes a data-input form and the
     monitor watching it should raise an alert.</p>
  <div class="qbar" role="progressbar" aria-label="Queue position"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(progress * 100).toFixed(0)}"
       data-progress="${progress.toFixed(4)}">
    <div class="qbar-mask" style="width:${maskWidth}%"></div>
  </div>
<script>
  const PITCH = 20; // 16px segment + 2px margin each side
  const bar = document.querySelector('.qbar');
  const mask = bar.querySelector('.qbar-mask');

  function fillSegments() {
    bar.querySelectorAll('.qbar-seg').forEach((el) => el.remove());
    const width = bar.offsetWidth;
    if (!width) return;
    const count = Math.ceil(width / PITCH) + 1; // +1 overfills the right edge
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const seg = document.createElement('div');
      seg.className = 'qbar-seg';
      frag.appendChild(seg);
    }
    bar.insertBefore(frag, mask);
  }

  function render(progress) {
    mask.style.width = ((1 - progress) * 100) + '%';
    bar.setAttribute('data-progress', progress.toFixed(4));
    bar.setAttribute('aria-valuenow', (progress * 100).toFixed(0));
  }

  async function tick() {
    try {
      const s = await (await fetch('/status', { cache: 'no-store' })).json();
      if (s.state === 'form') { location.reload(); return; }
      render(s.progress);
    } catch (e) { /* transient; try again next tick */ }
  }

  fillSegments();
  // Poll at the tick interval; transition duration matches (1000ms) so the
  // mask retracts continuously rather than in visible steps.
  setInterval(tick, 1000);

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(fillSegments, 150);
  });
</script>
`);
}

const formPage = pageShell(`
  <h1>We need your input</h1>
  <p>You've reached the front of the queue. If you are seeing this through the
     remote browser, take control and fill in the form to prove the takeover
     works.</p>
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
    return send(200, stateNow() === 'form' ? formPage : queuePage());
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
    const position = positionNow();
    return send(200, JSON.stringify({
      state: stateNow(),
      progress: Number(progressFrom(position).toFixed(4)),
      position,
      startPosition,
      queueSize: QUEUE_SIZE,
      startAt: startAt ? new Date(startAt).toISOString() : null,
      submissions: submissions.length,
    }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/submissions') {
    return send(200, JSON.stringify(submissions, null, 2), 'application/json');
  }

  if (req.method === 'POST' && req.url === '/reset') {
    arm();
    return send(200, JSON.stringify({ ok: true, startPosition, queueSize: QUEUE_SIZE }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    return send(200, 'ok', 'text/plain');
  }

  send(404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`[test-site] listening on :${PORT} (queue size ${QUEUE_SIZE})`);
  arm();
});
