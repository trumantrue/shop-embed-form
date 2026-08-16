// Blind detection test. Spins up ONE test-site, then for every variant loads
// the page (?variant=N) in a headless browser and runs the SAME generic
// detectProgress() the watcher uses — with zero per-variant configuration —
// and compares its reading against the site's own /status ground truth.
//
// "Blind" = the harness never tells the detector which variant it is looking
// at, which signal to use, or where the bar is. A pass means the generic
// detector recovered progress within tolerance across every layout/plumbing.
//
//   node blindtest.js            # default: all variants, tolerance 0.03
//   TOLERANCE=0.02 node blindtest.js
//
// Exits non-zero if any variant fails, so it can gate CI / a deploy.

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const { detectProgress } = require('./lib/detect');
const { variantIds } = require('../test-site/variants');

const TOLERANCE = parseFloat(process.env.TOLERANCE || '0.03');
const PORT = parseInt(process.env.TEST_PORT || '8099', 10);
const BASE = `http://localhost:${PORT}`;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Big queue so progress moves slowly and truth is stable during a read.
  const site = spawn('node', [path.join(__dirname, '..', 'test-site', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), QUEUE_SIZE: '100000' },
    stdio: 'ignore',
  });
  const cleanup = () => { try { site.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  // Wait for the server.
  for (let i = 0; i < 40; i++) {
    try { await getJson(`${BASE}/status`); break; } catch (e) { await sleep(100); }
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  const ids = variantIds();

  for (const id of ids) {
    // Re-arm to a fresh random position so variants sit at different progress
    // values (a more convincing spread than all reading the same number).
    await getJson(`${BASE}/reset`).catch(() => {});
    // /reset is POST in the server; hit it properly.
    await new Promise((resolve) => {
      const req = http.request(`${BASE}/reset`, { method: 'POST' }, (r) => { r.resume(); r.on('end', resolve); });
      req.on('error', resolve); req.end();
    });

    const truth = await getJson(`${BASE}/status`);
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
    await page.goto(`${BASE}/?variant=${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const read = await page.evaluate(detectProgress);
    const tagged = await page.evaluate(() => !!document.querySelector('[data-mon-bar]'));
    await page.close();

    const truthP = truth.progress;
    const readP = read ? read.progress : null;
    const delta = readP === null ? null : Math.abs(readP - truthP);
    const pass = readP !== null && delta <= TOLERANCE && tagged;
    results.push({ id, method: read ? read.method : 'NONE', truthP, readP, delta, tagged, pass });
  }

  await browser.close();
  cleanup();

  console.log('\nBLIND DETECTION TEST  (tolerance ±' + TOLERANCE + ', detector had no per-variant hints)\n');
  console.log('  variant  method       truth    read     Δ        tagged  result');
  for (const r of results) {
    console.log(
      '  V' + r.id + '       ' +
      (r.method + '           ').slice(0, 12) +
      (r.truthP != null ? (r.truthP * 100).toFixed(1) + '%' : '  -  ').padStart(7) + '  ' +
      (r.readP != null ? (r.readP * 100).toFixed(1) + '%' : '  -  ').padStart(7) + '  ' +
      (r.delta != null ? (r.delta * 100).toFixed(2) + 'pp' : '  -  ').padStart(7) + '  ' +
      (r.tagged ? ' yes ' : ' NO  ') + '   ' +
      (r.pass ? 'PASS' : 'FAIL'));
  }
  const failed = results.filter((r) => !r.pass);
  console.log('\n  ' + (results.length - failed.length) + '/' + results.length + ' variants passed\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
