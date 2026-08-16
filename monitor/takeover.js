// On-demand takeover browser. A single REAL, headful Chromium on the
// container's Xvfb display (exposed via x11vnc + noVNC by start.sh), that
// ADOPTS the monitored instance's session so the site treats the human as the
// same visitor the monitor was — same cookies/storage (queue token, login,
// cart). The promote-one-on-demand takeover for the 100-instance scale fleet.
//
// Control API (internal, not published):
//   POST /adopt   body {url, storageState}  recreate the context from the
//                 monitor's session, then navigate the visible browser there
//   POST /release                           return the human's FINAL session
//                 (storageState) so the monitor can adopt it back, then reset
//   GET  /current                           the URL currently shown
//
// Env: TAKEOVER_URL (initial), TAKEOVER_CONTROL_PORT (default 7300); DISPLAY
// is set by start.sh.

const http = require('http');
const { chromium } = require('playwright');

const CONTROL_PORT = parseInt(process.env.TAKEOVER_CONTROL_PORT || '7300', 10);
const START_URL = process.env.TAKEOVER_URL || 'about:blank';

let browser = null, ctx = null, page = null, current = 'about:blank';

async function showContext(storageState, url) {
  const old = ctx;
  ctx = await browser.newContext({ viewport: null, ...(storageState ? { storageState } : {}) });
  page = await ctx.newPage();
  if (old) { try { await old.close(); } catch (e) {} } // close the previous session view
  current = url || 'about:blank';
  if (url) { try { await page.bringToFront(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (e) { console.error('[takeover] goto:', e.message); } }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

(async () => {
  browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-position=0,0', '--window-size=1280,900'],
  });
  await showContext(null, START_URL);

  http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && url === '/adopt') {
      const body = await readBody(req);
      await showContext(body.storageState || null, body.url || 'about:blank');
      return json(200, { ok: true, current });
    }
    if (req.method === 'POST' && url === '/release') {
      let storageState = null;
      try { storageState = await ctx.storageState(); } catch (e) {}
      await showContext(null, 'about:blank'); // drop the human's view
      return json(200, { ok: true, storageState });
    }
    if (url === '/current') return json(200, { current });
    res.writeHead(404); res.end('not found');
  }).listen(CONTROL_PORT, () => console.log(`[takeover] control on :${CONTROL_PORT}, showing ${START_URL} on ${process.env.DISPLAY}`));
})().catch((e) => { console.error('[takeover] fatal:', e); process.exit(1); });
