# Remote country-based site monitor

Watches a URL from a **real Chromium browser** routed through a **Bright Data
residential proxy** in a country of your choice. When the content on screen
changes, you get an **ntfy** push notification with a screenshot — and a
one-tap link into a **live noVNC view of that exact browser**, where you can
take the mouse and keyboard and drive it yourself.

This repo currently contains Phase 1: **one instance**, plus a simulated
target site for end-to-end testing of the alert + takeover flow.

```
test-site/     simulated target: "Hello World" that flips to a form at a random time
monitor/       the watcher (Playwright + pixel/text diff + ntfy alerts)
docker/        monitor container: Chromium + Xvfb + x11vnc + noVNC
docker-compose.yml
```

## Quick start (local test, no proxy, no cost)

1. Install the [ntfy app](https://ntfy.sh/) on your phone and subscribe to an
   unguessable topic name (e.g. `shop-monitor-x7k2m9`).
2. `cp .env.example .env` and set at least `NTFY_TOPIC` and `VNC_PASSWORD`.
   Leave the `BRD_*` variables empty — the browser connects directly.
3. `docker compose up --build`

What happens:

- The test site starts on <http://localhost:8080> showing **Hello World**, and
  silently schedules a flip to a **data-input form** at a random moment
  between `FLIP_MIN_SECONDS` and `FLIP_MAX_SECONDS` (default 1–10 min).
- The monitor captures a baseline, then re-checks every `checkIntervalSeconds`.
- When the flip happens, your phone gets a push with the after-screenshot.
  Tap **Open live browser** → noVNC opens (password = `VNC_PASSWORD`) → you're
  looking at the monitored browser. Take control, fill in the form, submit.
- Verify the takeover worked: `curl localhost:8080/submissions` shows what you
  typed. `POST /reset` re-arms the test with a new random flip time.

## Pointing it at a real site through Bright Data

1. In the Bright Data dashboard create a **residential proxy zone** (KYC /
   use-case approval is required for the residential network — monitoring
   your own site is an easy approval).
2. Fill in `BRD_CUSTOMER`, `BRD_ZONE`, `BRD_PASSWORD` in `.env`.
3. Edit `monitor/config.json`:

```json
{
  "label": "de-1",
  "url": "https://your-site.example/page",
  "checkIntervalSeconds": 300,
  "pixelThreshold": 0.02,
  "confirmChecks": 2,
  "blockAssets": true,
  "country": "de"
}
```

The watcher **re-reads config.json every cycle** — URL, interval, and
thresholds are editable at runtime with no restart (the URL change resets the
baseline silently). `country` takes effect on the next container restart,
since the proxy session is bound at browser launch.

On startup with a proxy configured, the watcher logs its exit geo via
Bright Data's own `geo.brdtest.com` endpoint so you can confirm the country.

## How change detection works

Two signals per check, both against the last baseline:

- **Visible text hash** — any change in `document.body.innerText` counts.
- **Pixel diff** — fraction of differing viewport pixels must exceed
  `pixelThreshold` (default 2%).

A change must persist for `confirmChecks` consecutive checks before alerting
(filters one-frame rendering noise). Navigation failures alert once
("Site unreachable"), and recovery alerts + silently re-baselines. Before and
after screenshots of every confirmed change are kept in the `monitor-data`
volume (`/app/data`).

Tuning tips for real pages: carousels, cookie/geo banners, and lazy-loaded
images all move pixels. Raise `pixelThreshold`, rely on the text hash for
"real" changes, and keep `confirmChecks` ≥ 2.

## Bandwidth = budget

Residential proxies bill **per GB**, so cost is (page weight) × (checks/month):

| Setup | GB/mo per instance | @ $8.4/GB PAYG | @ $3.5/GB committed |
|---|---|---|---|
| Full page every 5 min (~2.5 MB) | ~22 | ~$180 | ~$76 |
| `blockAssets: true` every 5 min (~0.4 MB) | ~3.5 | ~$29 | ~$12 |
| `blockAssets: true` every 15 min | ~1.2 | ~$10 | ~$4 |

`blockAssets: true` aborts image/font/media requests during routine checks —
the text diff still works and layout pixels still diff. Note the live view
will also show the page without images while it's on. Verify current rates in
your Bright Data dashboard; they change.

## Scaling to multiple countries (Phase 2)

Each instance is one `monitor` container with its own config file, noVNC port,
and label. Duplicate the service block in `docker-compose.yml` per country
(`de-1` on 6080, `us-1` on 6081, …) — a dashboard that manages instances,
shows live thumbnails, and edits URLs in one place is the planned Phase 2.

## Security notes (do these before real deployment)

- noVNC is password-protected (`VNC_PASSWORD`) but **unencrypted HTTP** as
  shipped. On a public VPS put it behind a reverse proxy with HTTPS + basic
  auth, or keep port 6080 closed and reach it over a VPN/SSH tunnel. Anyone
  who gets in is driving a real browser on bandwidth you pay for.
- Use an unguessable ntfy topic (topics are world-publishable on ntfy.sh) or
  a self-hosted/authenticated ntfy server (`NTFY_TOKEN`).
- The monitor's traffic looks like real visitors from its proxy country —
  tag/exclude it in your site analytics, and allowlist it in any bot
  protection rather than letting it get challenged.
