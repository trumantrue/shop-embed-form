// On-demand takeover browser. A single REAL, headful Chromium running on the
// container's Xvfb display (exposed via x11vnc + noVNC by start.sh), that can
// be re-pointed at any monitored instance on demand. The user VNCs in and
// drives it — the promote-one-on-demand model for the 100-instance scale
// fleet, where running 100 headful browsers with VNC is infeasible.
//
// Control API (internal, not published):
//   POST /goto?url=<target>   navigate the visible browser to <target>
//   GET  /current             the URL currently shown
//
// Env: TAKEOVER_URL (initial page), TAKEOVER_CONTROL_PORT (default 7300),
//      plus DISPLAY set by start.sh.

const http = require('http');
const { chromium } = require('playwright');

const CONTROL_PORT = parseInt(process.env.TAKEOVER_CONTROL_PORT || '7300', 10);
const START_URL = process.env.TAKEOVER_URL || 'about:blank';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-position=0,0', '--window-size=1280,900'],
  });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  let current = START_URL;
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/goto') {
      const target = u.searchParams.get('url');
      let ok = false;
      if (target) {
        try { await page.bringToFront(); await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }); current = target; ok = true; }
        catch (e) { console.error('[takeover] goto failed:', e.message); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok, current }));
    }
    if (u.pathname === '/current') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ current }));
    }
    res.writeHead(404); res.end('not found');
  }).listen(CONTROL_PORT, () => console.log(`[takeover] control on :${CONTROL_PORT}, showing ${START_URL} on ${process.env.DISPLAY}`));
})().catch((e) => { console.error('[takeover] fatal:', e); process.exit(1); });
