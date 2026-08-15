# Project handoff brief

This file transfers ownership of the project to a new development session.
The cloud session that built Phase 1 is retired; all further work happens
here, on this branch (`claude/remote-browser-bright-data-t41hjo`).

## The project

A fleet of real Chromium browsers, each exiting through a **Bright Data
residential proxy in a chosen country**, each watching an editable URL
(ultimately the owner's shop pages). When the content on a browser's screen
changes, the owner gets an **ntfy** push with a screenshot and a one-tap link
into a **live noVNC view** of that exact browser, where they take the mouse
and keyboard and drive it themselves. Start with one instance, then scale to
several countries.

## State as of handoff (2026-08-15)

Phase 1 is complete and pushed on this branch. See README.md for operation.

- `monitor/watcher.js` — Playwright watcher. Change detection = visible-text
  hash (any change triggers) + screenshot pixel diff (> `pixelThreshold`),
  requiring `confirmChecks` consecutive changed checks. Alerts on change,
  startup, site-unreachable, and recovery. `config.json` is re-read every
  cycle → URL/interval/thresholds editable at runtime; URL change re-baselines
  silently. Bright Data proxy is wired but optional (BRD_* env unset = direct).
  Country goes into the proxy username (`-country-xx-session-<rand>`); exit
  geo is logged at startup via geo.brdtest.com.
- `monitor/lib/ntfy.js` — publishes with screenshot as attachment body,
  X-Title/X-Message/X-Click/X-Actions headers ("Open live browser" button).
- `test-site/` — simulated target: "Hello World" flips to a data-input form at
  a random time in [FLIP_MIN_SECONDS, FLIP_MAX_SECONDS]; records submissions
  (`GET /submissions`) to prove takeover worked; `POST /reset` re-arms.
- `docker/` + `docker-compose.yml` — monitor container: headful Chromium on
  Xvfb + x11vnc + noVNC (:6080), VNC password mandatory.

**Verified end-to-end** (headless, direct connection, mock ntfy endpoint):
baseline stable at 0.00% diff, flip detected (text + 1.4% pixels), confirmed
on second check, alert delivered with PNG attachment and correct headers;
runtime URL edit re-baselined without restart; form submission recorded.

**Not yet exercised anywhere:** the Docker build itself, real noVNC
interaction, real ntfy.sh delivery, and any Bright Data traffic.

## Roadmap

### Next: Tailscale local test (MacBook Pro + Mac mini)

Browsers run on the **Mac mini**; alerts and control happen on the
**MacBook** (and phone). No code changes expected:

1. MacBook-only smoke test first: run `test-site` natively, run the monitor
   natively (`npm install && npx playwright install chromium`, macOS display
   so headful just works, no VNC layer), real `NTFY_TOPIC`, confirm the push
   arrives with screenshot.
2. Then mini as browser host: Docker/OrbStack on the mini,
   `docker compose up --build`, `.env` with
   `LIVE_VIEW_URL=http://<mini-magicdns-name>:6080/vnc.html`.
   Success = alert lands on the phone/MacBook → click → noVNC over the
   tailnet → fill the test form from the MacBook → submission appears in
   `curl http://<mini>:8080/submissions`.
3. Prefer binding noVNC/test-site to the Tailscale interface only; the
   tailnet replaces the README's HTTPS-reverse-proxy hardening for now.

### Phase 2: scale + dashboard

- One `monitor` service per country instance (distinct config file, label,
  noVNC port: de-1 → 6080, us-1 → 6081, …).
- Small dashboard: all instances with live screenshot thumbnails, per-instance
  URL editing (writes the config files), status, last-change time, links to
  each noVNC. Central place to see the fleet.

### Phase 3: Bright Data + production hardening

- Create a residential zone in the BD dashboard (KYC/use-case review required;
  "monitoring my own site" is an easy approval). Fill BRD_CUSTOMER/ZONE/
  PASSWORD, set `country`, restart (country binds at browser launch).
- Turn on `blockAssets: true` for routine checks before scaling cadence —
  bandwidth is the entire budget (below).
- Decide final hosting (always-on box: the mini itself, or a small VPS),
  screenshot history retention, analytics exclusion + bot-protection
  allowlisting for the monitor's traffic.

## Budget (verify rates in the BD dashboard — approximate, Aug 2026)

Residential proxies bill per GB (~$5–8.4/GB PAYG, ~$3.5/GB at the $499/mo
tier, ~$2–3/GB enterprise; city/ZIP targeting +20–40%, country targeting
included). Browser API alternative ~$5.5–8/GB (rejected: ephemeral sessions,
no comfortable human takeover). Per instance per month:

| Setup | GB/mo | @ $8.4/GB | @ $3.5/GB |
|---|---|---|---|
| Full page every 5 min (~2.5 MB) | ~22 | ~$180 | ~$76 |
| blockAssets every 5 min (~0.4 MB) | ~3.5 | ~$29 | ~$12 |
| blockAssets every 15 min | ~1.2 | ~$10 | ~$4 |

## Known pitfalls (established in planning — don't relearn these)

- **Bandwidth is the budget.** Every retry/websocket/auto-refresh bills.
  Measure real per-check GB in week one before adding instances or cadence.
- **Residential IPs churn** — the `session` flag holds an IP only while that
  peer is online. Log exit IP per check eventually, so "content changed" can
  be told apart from "IP changed" artifacts.
- **False positives are the real engineering problem**: carousels, cookie/geo
  banners, lazy images, timestamps. Tools: pixelThreshold, text-hash primacy,
  confirmChecks ≥ 2, and (future) masking known-dynamic regions.
- **Analytics pollution**: monitor traffic looks like real foreign visitors —
  tag it and exclude in analytics; allowlist it in bot protection.
- **noVNC exposure**: an open port 6080 = strangers driving a paid-bandwidth
  browser. Tailnet-only or HTTPS+auth, always.
- **ntfy.sh topics are world-publishable** — unguessable topic name minimum,
  self-hosted ntfy + token preferred long-term.

## Housekeeping

- `shop-embed-form.html` at repo root predates this project (a Google Form
  embed). Untouched; leave it unless told otherwise.
- Commit style so far: descriptive messages on this branch. No PR exists and
  none was requested.
