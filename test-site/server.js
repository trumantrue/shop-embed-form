// Simulated target site for testing the monitor's alert + takeover flow.
//
// Serves a static "Hello World" page, then at a random time (between
// FLIP_MIN_SECONDS and FLIP_MAX_SECONDS after start/reset) switches to a
// data-input form. Submissions are recorded in memory so you can verify
// that remote browser control actually worked.
//
//   GET  /            hello page or form, depending on state
//   POST /submit      records the form submission
//   GET  /status      JSON: current state, flip time, submission count
//   GET  /submissions JSON: everything submitted so far
//   POST /reset       back to hello, schedules a new random flip
//   GET  /healthz     ok

const http = require('http');
const { URLSearchParams } = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const FLIP_MIN_SECONDS = parseInt(process.env.FLIP_MIN_SECONDS || '60', 10);
const FLIP_MAX_SECONDS = parseInt(process.env.FLIP_MAX_SECONDS || '600', 10);

let state = 'hello';
let flipAt = null;
let flipTimer = null;
const submissions = [];

function scheduleFlip() {
  if (flipTimer) clearTimeout(flipTimer);
  const delayMs =
    (FLIP_MIN_SECONDS + Math.random() * Math.max(0, FLIP_MAX_SECONDS - FLIP_MIN_SECONDS)) * 1000;
  flipAt = new Date(Date.now() + delayMs);
  state = 'hello';
  flipTimer = setTimeout(() => {
    state = 'form';
    console.log(`[test-site] flipped to FORM at ${new Date().toISOString()}`);
  }, delayMs);
  console.log(`[test-site] state=hello, will flip to form at ${flipAt.toISOString()} (${Math.round(delayMs / 1000)}s from now)`);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pageShell(body) {
  // Deliberately static: no timestamps, no external assets, no animation —
  // the only pixel/text changes the monitor should ever see are real ones.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Monitor test target</title>
<style>
  body { font-family: Georgia, serif; background: #f5f2ea; color: #222; margin: 0; }
  main { max-width: 620px; margin: 8vh auto; background: #fff; border: 1px solid #ddd;
         border-radius: 8px; padding: 2.5rem 3rem; }
  h1 { margin-top: 0; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: bold; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 0.5rem;
                    border: 1px solid #bbb; border-radius: 4px; font-size: 1rem; }
  button { margin-top: 1.25rem; padding: 0.6rem 1.5rem; font-size: 1rem;
           background: #2d5f3f; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

const helloPage = pageShell(`
  <h1>Hello World</h1>
  <p>This page is quiet. Nothing to see here yet.</p>
  <p>At some unannounced moment it will turn into a data-input form,
     and the monitor watching it should raise an alert.</p>
`);

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
    return send(200, state === 'form' ? formPage : helloPage);
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
      state,
      flipAt: flipAt ? flipAt.toISOString() : null,
      submissions: submissions.length,
    }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/submissions') {
    return send(200, JSON.stringify(submissions, null, 2), 'application/json');
  }

  if (req.method === 'POST' && req.url === '/reset') {
    scheduleFlip();
    return send(200, JSON.stringify({ ok: true, flipAt: flipAt.toISOString() }), 'application/json');
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    return send(200, 'ok', 'text/plain');
  }

  send(404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`[test-site] listening on :${PORT}`);
  scheduleFlip();
});
