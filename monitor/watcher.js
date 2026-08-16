// Site monitor: drives a real Chromium through an (optional) Bright Data
// residential proxy, re-checks the target URL on an interval, and detects
// "the content on screen changed" via two signals:
//   1. visible DOM text hash (any change triggers)
//   2. screenshot pixel diff (must exceed pixelThreshold fraction)
// A change must persist for `confirmChecks` consecutive checks before an
// ntfy alert fires (kills one-frame rendering noise). Navigation failures
// and recoveries alert too.
//
// config.json is re-read every cycle, so the URL (and interval/thresholds)
// are editable at runtime without a restart. Screenshots land in data/.
//
// Env (secrets & deployment wiring — everything else lives in config.json):
//   BRD_CUSTOMER / BRD_ZONE / BRD_PASSWORD  Bright Data credentials (omit all → direct connection)
//   NTFY_SERVER / NTFY_TOPIC / NTFY_TOKEN   see lib/ntfy.js
//   LIVE_VIEW_URL   public noVNC URL included in alerts, e.g. http://host:6080/vnc.html
//   CHROME_PATH     explicit Chromium binary (else Playwright's own resolution)
//   HEADLESS=1      run headless (local testing without a display)
//   CONFIG_PATH     alternative config file (default ./config.json)
//   STATUS_PORT     serve /status.json + /shot.png for the fleet dashboard (0/unset = off)

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const ntfy = require('./lib/ntfy');
const { detectProgress } = require('./lib/detect');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LIVE_VIEW_URL = process.env.LIVE_VIEW_URL || '';
const HEADLESS = process.env.HEADLESS === '1';

const DEFAULTS = {
  label: 'monitor-1',
  url: 'http://localhost:8080',
  checkIntervalSeconds: 60,
  pixelThreshold: 0.02,     // fraction of viewport pixels that must differ
  confirmChecks: 2,         // consecutive changed checks before alerting
  blockAssets: false,       // abort images/fonts/media requests to save proxy GB
  country: null,            // two-letter code for Bright Data geo, e.g. "de"
  viewport: { width: 1280, height: 900 },
  navTimeoutMs: 45000,
  // Read a 0..1 progress value off the rendered page: the selected element's
  // data-progress attribute, cross-checked against its filled .seg count.
  // null = no progress tracking.
  progressSelector: null,
  // Selectors masked out of screenshots before the pixel diff — for regions
  // that legitimately change without meaning "the content changed" (the
  // progress bar, carousels, tickers). Masked areas can never trigger.
  maskSelectors: [],
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...raw, viewport: { ...DEFAULTS.viewport, ...(raw.viewport || {}) } };
  } catch (err) {
    console.error(`[watcher] cannot read ${CONFIG_PATH} (${err.message}); using defaults`);
    return { ...DEFAULTS };
  }
}

function proxySettings(cfg) {
  const { BRD_CUSTOMER, BRD_ZONE, BRD_PASSWORD } = process.env;
  if (!BRD_CUSTOMER || !BRD_ZONE || !BRD_PASSWORD) return null;
  const session = crypto.randomBytes(4).toString('hex');
  let username = `brd-customer-${BRD_CUSTOMER}-zone-${BRD_ZONE}`;
  if (cfg.country) username += `-country-${cfg.country}`;
  username += `-session-${session}`;
  return {
    server: process.env.BRD_PROXY_HOST || 'http://brd.superproxy.io:33335',
    username,
    password: BRD_PASSWORD,
  };
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function pixelDiffFraction(bufA, bufB) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) return 1; // treat size change as full change
  const differing = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  return differing / (a.width * a.height);
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Live state served to the fleet dashboard. `progress` is what this watcher
// read off the rendered page (screen truth), not what the site claims.
const status = {
  label: null, url: null, state: 'starting',
  progress: null, progressMethod: null,
  checks: 0, lastCheckAt: null, lastChangeAt: null,
  pixelDiffPct: null, textChanged: null,
};
let latestShot = null;

function startStatusServer() {
  const port = parseInt(process.env.STATUS_PORT || '0', 10);
  if (!port) return;
  http.createServer((req, res) => {
    if (req.url === '/status.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(status));
    }
    if (req.url === '/shot.png' && latestShot) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(latestShot);
    }
    res.writeHead(404); res.end('not found');
  }).listen(port, () => console.log(`[watcher] status server on :${port}`));
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let cfg = loadConfig();
  const proxy = proxySettings(cfg);
  status.label = cfg.label;
  status.url = cfg.url;
  startStatusServer();

  console.log(`[watcher] label=${cfg.label} url=${cfg.url} interval=${cfg.checkIntervalSeconds}s ` +
    `proxy=${proxy ? `bright-data (country=${cfg.country || 'any'})` : 'DIRECT (no BRD_* env set)'} headless=${HEADLESS}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROME_PATH || undefined,
    proxy: proxy || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${cfg.viewport.width},${cfg.viewport.height}`],
  });
  const context = await browser.newContext({ viewport: cfg.viewport, ignoreHTTPSErrors: false });
  const page = await context.newPage();

  if (proxy) {
    // brdtest.com is Bright Data's own check endpoint; log the exit geo once
    // so alerts can be sanity-checked against IP churn.
    try {
      const geo = await context.request.get('https://geo.brdtest.com/mygeo.json', { timeout: 15000 });
      console.log(`[watcher] exit geo: ${(await geo.text()).slice(0, 300)}`);
    } catch (err) {
      console.warn(`[watcher] exit-geo check failed: ${err.message}`);
    }
  }

  let assetBlockingOn = false;
  async function syncAssetBlocking() {
    if (cfg.blockAssets && !assetBlockingOn) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media'].includes(type)) return route.abort();
        return route.continue();
      });
      assetBlockingOn = true;
    } else if (!cfg.blockAssets && assetBlockingOn) {
      await page.unroute('**/*');
      assetBlockingOn = false;
    }
  }

  let baseline = null;          // { shot: Buffer, textHash: string, url: string }
  let pendingChange = 0;        // consecutive changed checks
  let lastNavError = false;

  async function alert({ title, message, shot }) {
    return ntfy.publish({
      title: `[${cfg.label}] ${title}`,
      message,
      clickUrl: LIVE_VIEW_URL || cfg.url,
      actionLabel: LIVE_VIEW_URL ? 'Open live browser' : 'Open site',
      attachment: shot,
      filename: shot ? `${cfg.label}-${ts()}.png` : undefined,
    });
  }

  async function check() {
    const fresh = loadConfig();
    const urlChanged = fresh.url !== cfg.url;
    cfg = fresh;
    await syncAssetBlocking();
    if (urlChanged) {
      console.log(`[watcher] url changed in config → ${cfg.url}; resetting baseline`);
      baseline = null;
      pendingChange = 0;
    }

    status.label = cfg.label;
    status.url = cfg.url;
    try {
      await page.goto(cfg.url, { waitUntil: 'networkidle', timeout: cfg.navTimeoutMs });
    } catch (err) {
      console.error(`[watcher] navigation failed: ${err.message}`);
      status.state = 'unreachable';
      status.lastCheckAt = new Date().toISOString();
      if (!lastNavError) {
        lastNavError = true;
        await alert({ title: 'Site unreachable', message: `${cfg.url}\n${err.message.split('\n')[0]}` });
      }
      return;
    }
    if (lastNavError) {
      lastNavError = false;
      baseline = null; // page may legitimately differ after an outage; rebaseline
      await alert({ title: 'Site reachable again', message: cfg.url });
    }

    await page.waitForTimeout(500); // small settle for late paints

    // Detect progress GENERICALLY first — no per-page selector. This also tags
    // the bar element with data-mon-bar so we can mask exactly that region.
    const detected = await page.evaluate(detectProgress).catch(() => null);
    status.progress = detected ? Number(detected.progress.toFixed(4)) : null;
    status.progressMethod = detected ? detected.method : null;

    // Two screenshots per check with different jobs:
    //   shot     — the REAL page (thumbnail, alerts, saved before/after).
    //   diffShot — the detected bar region masked with a constant color, so its
    //              movement can never trip the pixel diff. Used ONLY for the
    //              comparison. With no bar detected the two are identical.
    const shot = await page.screenshot({ type: 'png' });
    const diffShot = detected
      ? await page.screenshot({ type: 'png', mask: [page.locator('[data-mon-bar]')], maskColor: '#3f3f3f' })
      : shot;
    latestShot = shot;
    const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const textHash = sha256(text);

    status.state = 'ok';
    status.checks += 1;
    status.lastCheckAt = new Date().toISOString();

    if (!baseline) {
      baseline = { shot, diffShot, textHash, url: cfg.url };
      fs.writeFileSync(path.join(DATA_DIR, 'baseline.png'), shot);
      console.log(`[watcher] baseline captured (${text.length} chars of text)`);
      return;
    }

    const pixFrac = pixelDiffFraction(baseline.diffShot, diffShot);
    const textChanged = textHash !== baseline.textHash;
    const changed = textChanged || pixFrac > cfg.pixelThreshold;
    status.pixelDiffPct = Number((pixFrac * 100).toFixed(2));
    status.textChanged = textChanged;
    console.log(`[watcher] check: pixelDiff=${(pixFrac * 100).toFixed(2)}% textChanged=${textChanged} ` +
      `progress=${status.progress === null ? '-' : status.progress}${status.progressMethod ? `(${status.progressMethod})` : ''} ` +
      `pending=${changed ? pendingChange + 1 : 0}/${cfg.confirmChecks}`);

    if (!changed) {
      pendingChange = 0;
      return;
    }
    pendingChange += 1;
    if (pendingChange < cfg.confirmChecks) return;

    const stamp = ts();
    const beforePath = path.join(DATA_DIR, `${stamp}-before.png`);
    const afterPath = path.join(DATA_DIR, `${stamp}-after.png`);
    fs.writeFileSync(beforePath, baseline.shot);
    fs.writeFileSync(afterPath, shot);
    console.log(`[watcher] CHANGE CONFIRMED — screenshots: ${beforePath} / ${afterPath}`);

    status.lastChangeAt = new Date().toISOString();
    await alert({
      title: 'Content changed',
      message: `${cfg.url}\npixel diff ${(pixFrac * 100).toFixed(1)}%, text ${textChanged ? 'changed' : 'unchanged'}. ` +
        `Tap to open the live browser and take control.`,
      shot,
    });

    baseline = { shot, diffShot, textHash, url: cfg.url };
    pendingChange = 0;
  }

  // Startup notice so a freshly deployed instance announces itself.
  await alert({ title: 'Monitor started', message: `Watching ${cfg.url} every ${cfg.checkIntervalSeconds}s` });

  for (;;) {
    const started = Date.now();
    try {
      await check();
    } catch (err) {
      console.error(`[watcher] check crashed: ${err.message}`);
    }
    const elapsed = Date.now() - started;
    const waitMs = Math.max(1000, cfg.checkIntervalSeconds * 1000 - elapsed);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

main().catch((err) => {
  console.error('[watcher] fatal:', err);
  process.exit(1);
});
