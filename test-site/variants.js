// Five queue-page variants. All share the same reveal mechanism (a row of
// green segments with a right-anchored grey mask that retracts) and the same
// server-driven queue engine, but they differ in:
//   - WHERE the bar sits (main / header band / fixed footer / sidebar / nested)
//   - HOW progress is exposed to a blind observer:
//       * ARIA  — role="progressbar" + aria-valuenow (on the bar, a wrapper,
//                 or a deeply-nested node)
//       * STRUCTURAL ONLY — no aria, no data-progress; progress is only
//         recoverable from the mask geometry (mask width vs track width)
//   - class names, segment colour and sizing (so a detector can't overfit)
//
// The page's OWN inline script may target its own classes freely — only the
// WATCHER must be blind. This module exists to prove the watcher's generic
// detector reads progress correctly regardless of these differences.

// Reveal-bar CSS for one variant's class set. Segment colour/size vary.
function barCss(b, seg, mask, opts = {}) {
  const green = opts.color || '#35be86';
  const grey = opts.grey || '#4d4d4d';
  const segW = opts.segW || 16;
  const h = opts.h || 32;
  const ch = h - 8;
  return `
  .${b}{position:relative;display:flex;flex-wrap:nowrap;align-items:center;height:${h}px;width:100%;
        overflow:hidden;border:4px solid ${grey};background:${grey};box-sizing:border-box;}
  .${seg}{margin:2px;height:${ch}px;width:${segW}px;background:${green};}
  .${mask}{position:absolute;right:0;top:0;height:100%;background:${grey};transition:width 1000ms linear;}
  @media (prefers-reduced-motion:reduce){.${mask}{transition:none;}}`;
}

// The bar element markup. `aria` controls whether role/aria-* live on the bar.
function barHtml(b, mask, progress, { aria = false } = {}) {
  const maskW = ((1 - progress) * 100).toFixed(2);
  const ariaAttrs = aria
    ? ` role="progressbar" aria-label="Queue position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(progress * 100).toFixed(0)}"`
    : '';
  return `<div class="${b}"${ariaAttrs}><div class="${mask}" style="width:${maskW}%"></div></div>`;
}

// Per-variant inline animation script. Targets the variant's own classes and,
// if `aria`, keeps aria-valuenow live. DIVISOR 18 per the handover.
function barScript(barSel, seg, maskSel, aria) {
  return `<script>(function(){
  var bar=document.querySelector(${JSON.stringify(barSel)});
  var mask=bar.querySelector(${JSON.stringify(maskSel)});
  function fill(){bar.querySelectorAll(${JSON.stringify('.' + seg)}).forEach(function(e){e.remove();});
    var w=bar.offsetWidth;if(!w)return;var n=Math.floor(w/18)+1,f=document.createDocumentFragment();
    for(var i=0;i<n;i++){var s=document.createElement('div');s.className=${JSON.stringify(seg)};f.appendChild(s);}
    bar.insertBefore(f,mask);}
  function render(p){mask.style.width=((1-p)*100)+'%';${aria ? "bar.setAttribute('aria-valuenow',(p*100).toFixed(0));" : ''}}
  async function tick(){try{var s=await(await fetch('/status',{cache:'no-store'})).json();
    if(s.state==='form'){location.reload();return;}render(s.progress);}catch(e){}}
  fill();setInterval(tick,1000);var rt;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(fill,150);});
  })();</script>`;
}

const intro = `<p>Please wait — you'll be admitted automatically when it's your turn. When you
   reach the front, this page becomes a data-input form and the monitor watching it should
   raise an alert.</p>`;

// Each variant: { name, css, body } given progress.
const VARIANTS = {
  // V1 — ARIA on the bar, centred in main content. Baseline realistic case.
  1: (p) => ({
    name: 'aria-main',
    css: barCss('pbar', 'pbar-s', 'pbar-m'),
    body: `<h1>You're in the queue</h1>${intro}
      <div class="pbar" role="progressbar" aria-label="Queue position"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(p * 100).toFixed(0)}">
        <div class="pbar-m" style="width:${((1 - p) * 100).toFixed(2)}%"></div>
      </div>
      ${barScript('.pbar', 'pbar-s', '.pbar-m', true)}`,
  }),

  // V2 — STRUCTURAL ONLY, in a full-width header band above the content. No
  // aria, no data-progress. Different class names. Detector must use geometry.
  2: (p) => ({
    name: 'structural-header',
    css: `header.top{background:#111;padding:14px 24px;margin:-32px -32px 24px;border-radius:4px 4px 0 0;}`
      + barCss('wait', 'wait-c', 'wait-cov'),
    body: `<header class="top">${barHtml('wait', 'wait-cov', p)}</header>
      <h1>You're in the queue</h1>${intro}
      ${barScript('.wait', 'wait-c', '.wait-cov', false)}`,
  }),

  // V3 — ARIA on a WRAPPER around the bar, fixed to a footer strip. Different
  // classes again; the progressbar role is not on the element with the mask.
  3: (p) => ({
    name: 'aria-wrapper-footer',
    css: `.foot{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #ddd;
      padding:16px 24px;box-shadow:0 -2px 8px rgba(0,0,0,.08);}`
      + barCss('q3bar', 'q3s', 'q3msk'),
    body: `<h1>You're in the queue</h1>${intro}
      <div class="foot"><div role="progressbar" aria-label="Queue position"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(p * 100).toFixed(0)}">
        <div class="q3bar"><div class="q3msk" style="width:${((1 - p) * 100).toFixed(2)}%"></div></div>
      </div></div>
      ${barScript('.q3bar', 'q3s', '.q3msk', false)}
      <script>setInterval(async function(){try{var s=await(await fetch('/status',{cache:'no-store'})).json();
        var pb=document.querySelector('[role=progressbar]');if(pb)pb.setAttribute('aria-valuenow',(s.progress*100).toFixed(0));}catch(e){}},1000);</script>`,
  }),

  // V4 — STRUCTURAL ONLY, in a right-hand sidebar, BLUE segments and a taller
  // bar with wider segments. Proves geometry detection isn't tied to the
  // reference colour or pixel sizes.
  4: (p) => ({
    name: 'structural-sidebar-blue',
    css: `.wrap{display:flex;gap:24px;align-items:flex-start;}.side{flex:1 1 40%;}`
      + barCss('sbar', 'sbs', 'sbm', { color: '#3b82f6', segW: 22, h: 40 }),
    body: `<div class="wrap">
        <div style="flex:1 1 60%"><h1>You're in the queue</h1>${intro}</div>
        <div class="side"><p style="margin-top:0">Your place</p>
          ${barHtml('sbar', 'sbm', p)}</div>
      </div>
      ${barScript('.sbar', 'sbs', '.sbm', false)}`,
  }),

  // V5 — ARIA, but the progressbar is nested several wrappers deep with noise
  // classes around it, mid-content. Depth/clutter must not defeat detection.
  5: (p) => ({
    name: 'aria-nested-deep',
    css: barCss('n5', 'n5s', 'n5m'),
    body: `<h1>You're in the queue</h1>${intro}
      <section class="panel"><div class="row"><div class="col"><div class="widget">
        <div class="n5" role="progressbar" aria-label="Queue position"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(p * 100).toFixed(0)}">
          <div class="n5m" style="width:${((1 - p) * 100).toFixed(2)}%"></div>
        </div>
      </div></div></div></section>
      ${barScript('.n5', 'n5s', '.n5m', true)}`,
  }),
};

function variantIds() { return Object.keys(VARIANTS).map(Number); }
function renderVariant(id, progress) {
  const v = VARIANTS[id] || VARIANTS[1];
  return v(progress);
}

module.exports = { renderVariant, variantIds };
