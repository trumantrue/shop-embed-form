// Pooled multi-target watcher: ONE headless Chromium drives a bounded pool of
// pages that round-robin over N target URLs, so memory is capped by the pool
// size, not the target count — the only way 100+ instances fit a small host.
//
// Detection is the same generic detectProgress() the single watcher and blind
// test use (ARIA / structural, no per-page selector). Change detection is the
// same masked-pixel-diff + text-hash with a confirm count (counted in sweeps).
// No screenshots are served — the dashboard is text/numeric at this scale.
// Admissions (queue -> form) are batched into periodic summary ntfy pushes
// instead of one push per instance, so 100 completions don't mean 100 alerts.
//
// Env:
//   MULTI_BASE      base URL of the multi-queue site, e.g. http://test-site:8080
//   COUNT           number of instances (default 100) -> /q/1 .. /q/COUNT
//   POOL_SIZE       concurrent pages (default 12) — the memory knob
//   SETTLE_MS       post-nav settle before reading (default 400)
//   CONFIRM_CHECKS  consecutive changed sweeps before alerting (default 2)
//   PIXEL_THRESHOLD fraction of pixels that must differ (default 0.02)
//   STATUS_PORT     serves /status.json (array of all instances) (default 7100)
//   NTFY_* + ALERT_FLUSH_MS (default 60000) for batched admission alerts

const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const ntfy = require('./lib/ntfy');
const { detectProgress } = require('./lib/detect');

const BASE = (process.env.MULTI_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const COUNT = parseInt(process.env.COUNT || '100', 10);
const POOL = parseInt(process.env.POOL_SIZE || '12', 10);
const SETTLE_MS = parseInt(process.env.SETTLE_MS || '400', 10);
const CONFIRM = parseInt(process.env.CONFIRM_CHECKS || '2', 10);
const PIXEL_THRESHOLD = parseFloat(process.env.PIXEL_THRESHOLD || '0.02');
const STATUS_PORT = parseInt(process.env.STATUS_PORT || '7100', 10);
const FLUSH_MS = parseInt(process.env.ALERT_FLUSH_MS || '60000', 10);
const LIVE_VIEW_URL = process.env.LIVE_VIEW_URL || '';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function pixelDiffFraction(a, b) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  return pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.1 }) / (A.width * A.height);
}

// Per-instance state, keyed by id.
const S = new Map();
for (let id = 1; id <= COUNT; id++) {
  S.set(id, { id, variant: ((id - 1) % 5) + 1, url: `${BASE}/q/${id}`, progress: null, method: null,
    state: 'pending', checks: 0, lastCheckAt: null, changeAt: null, _baseline: null, _pending: 0, _sweeps: 0 });
}

const admittedBatch = [];
let admittedTotal = 0;

async function checkOne(page, st) {
  try {
    await page.goto(st.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    st.state = 'unreachable'; st.lastCheckAt = new Date().toISOString(); return;
  }
  await page.waitForTimeout(SETTLE_MS);
  const detected = await page.evaluate(detectProgress).catch(() => null);
  st.progress = detected ? Number(detected.progress.toFixed(4)) : null;
  st.method = detected ? detected.method : null;

  const shot = await page.screenshot({ type: 'png' });
  const diffShot = detected
    ? await page.screenshot({ type: 'png', mask: [page.locator('[data-mon-bar]')], maskColor: '#3f3f3f' })
    : shot;
  const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  const textHash = sha256(text);
  const isForm = !detected && /input|email|name/i.test(text); // bar gone + form-ish text

  st.checks += 1; st._sweeps += 1;
  st.lastCheckAt = new Date().toISOString();
  st.state = detected ? 'ok' : (isForm ? 'form' : 'ok');

  if (!st._baseline) { st._baseline = { diffShot, textHash }; return; }
  const pix = pixelDiffFraction(st._baseline.diffShot, diffShot);
  const changed = textHash !== st._baseline.textHash || pix > PIXEL_THRESHOLD;
  if (!changed) { st._pending = 0; return; }
  st._pending += 1;
  if (st._pending < CONFIRM) return;

  st.changeAt = new Date().toISOString();
  st._baseline = { diffShot, textHash };
  st._pending = 0;
  if (isForm) { st.state = 'form'; admittedBatch.push(st.id); admittedTotal += 1; }
}

async function worker(context, cursor) {
  const page = await context.newPage();
  for (;;) {
    const id = cursor.next();
    await checkOne(page, S.get(id));
  }
}

function startStatusServer() {
  http.createServer((req, res) => {
    if (req.url === '/status.json') {
      const arr = [...S.values()].map(({ _baseline, _pending, _sweeps, ...pub }) => pub);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ count: COUNT, pool: POOL, admittedTotal, instances: arr }));
    }
    res.writeHead(404); res.end('not found');
  }).listen(STATUS_PORT, () => console.log(`[multi-watcher] status on :${STATUS_PORT}`));
}

function startAlertFlush() {
  setInterval(async () => {
    if (!admittedBatch.length) return;
    const ids = admittedBatch.splice(0, admittedBatch.length);
    const msg = `${ids.length} instance(s) admitted (form): ${ids.slice(0, 30).join(', ')}${ids.length > 30 ? '…' : ''}` +
      `\n${admittedTotal} total so far.`;
    await ntfy.publish({ title: `[fleet] ${ids.length} admitted`, message: msg,
      clickUrl: LIVE_VIEW_URL || undefined, actionLabel: LIVE_VIEW_URL ? 'Open dashboard' : undefined });
  }, FLUSH_MS);
}

async function main() {
  console.log(`[multi-watcher] ${COUNT} targets, pool ${POOL}, base ${BASE}`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  startStatusServer();
  startAlertFlush();

  // Shared round-robin cursor over 1..COUNT.
  let n = 0;
  const cursor = { next: () => { n = (n % COUNT) + 1; return n; } };

  await ntfy.publish({ title: '[fleet] multi-watcher started', message: `Watching ${COUNT} instances, pool ${POOL}` });
  await Promise.all(Array.from({ length: Math.min(POOL, COUNT) }, () => worker(context, cursor)));
}

main().catch((e) => { console.error('[multi-watcher] fatal:', e); process.exit(1); });
