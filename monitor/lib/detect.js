// Generic, page-agnostic progress detector. Runs in the browser context
// (injected via page.evaluate). Finds the queue/progress bar with NO per-page
// selector, trying realistic signals in order:
//
//   1. ARIA   — the first [role="progressbar"] with a numeric aria-valuenow
//               (respecting aria-valuemin/max). This is the honest, standard
//               signal a real accessible queue page would expose.
//   2. STRUCTURAL — the reveal signature: a wide, short "track" element whose
//               computed geometry contains a right-anchored, ~full-height
//               absolutely-positioned overlay (the mask). Progress is
//               1 - maskWidth/trackWidth. No colour or class assumptions.
//   3. FALLBACK — an explicit data-progress attribute anywhere.
//
// Whatever it finds it tags with data-mon-bar, so the caller can mask that
// exact region out of the pixel diff regardless of the page's own markup.
// Returns { progress: 0..1, method } or null. Kept dependency-free so the
// watcher and the blind-test harness can inject the same function verbatim.
function detectProgress() {
  var tagged = null, out = null;

  // 1. ARIA progressbar.
  var pbs = document.querySelectorAll('[role="progressbar"]');
  for (var i = 0; i < pbs.length && !out; i++) {
    var now = parseFloat(pbs[i].getAttribute('aria-valuenow'));
    if (isNaN(now)) continue;
    var min = parseFloat(pbs[i].getAttribute('aria-valuemin')); if (isNaN(min)) min = 0;
    var max = parseFloat(pbs[i].getAttribute('aria-valuemax')); if (isNaN(max)) max = 100;
    if (max <= min) continue;
    out = { progress: Math.max(0, Math.min(1, (now - min) / (max - min))), method: 'aria' };
    tagged = pbs[i];
  }

  // 2. Structural reveal geometry.
  if (!out) {
    var best = null, els = document.querySelectorAll('div, span, section');
    for (var j = 0; j < els.length; j++) {
      var t = els[j], tr = t.getBoundingClientRect();
      // A track is wide and short (a bar, not a block).
      if (tr.width < 60 || tr.height < 8 || tr.width < tr.height * 3) continue;
      for (var k = 0; k < t.children.length; k++) {
        var ov = t.children[k];
        if (getComputedStyle(ov).position !== 'absolute') continue;
        var orc = ov.getBoundingClientRect();
        if (Math.abs(orc.right - tr.right) > 8) continue;   // anchored to the right edge
        if (orc.height < tr.height * 0.55) continue;         // ~full height => it's the mask
        if (orc.width > tr.width) continue;
        var inner = Math.max(1, tr.width - 8);               // approx of the bordered channel
        var f = Math.max(0, Math.min(1, 1 - orc.width / inner));
        if (!best || tr.width > best.width) best = { progress: f, width: tr.width, el: t };
      }
    }
    if (best) { out = { progress: best.progress, method: 'structural' }; tagged = best.el; }
  }

  // 3. Fallback: an explicit data-progress attribute.
  if (!out) {
    var dp = document.querySelector('[data-progress]');
    if (dp) {
      var v = parseFloat(dp.getAttribute('data-progress'));
      if (!isNaN(v)) { out = { progress: Math.max(0, Math.min(1, v)), method: 'data-attr' }; tagged = dp; }
    }
  }

  if (out && tagged) { try { tagged.setAttribute('data-mon-bar', ''); } catch (e) {} }
  return out;
}

module.exports = { detectProgress };
