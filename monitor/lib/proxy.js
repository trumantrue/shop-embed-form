// Provider-aware proxy config for Playwright. Returns a { server, username,
// password } object (or null for a direct connection). Kept pure and testable
// so the exact IPRoyal / Bright Data credential formats can be asserted
// without spending bandwidth.
//
// Selection: PROXY_PROVIDER=iproyal|brightdata, else inferred from which env
// vars are present, else direct.
//
//   IPRoyal residential (docs: geo.iproyal.com:12321, routing in the password):
//     IPROYAL_USER, IPROYAL_PASS   credentials from the dashboard
//     IPROYAL_HOST                 default http://geo.iproyal.com:12321
//     password = <pass>[_country-<cc>]_session-<8hex>_lifetime-<N>
//     cfg.country (2-letter), cfg.stickyLifetime (default 30m)
//
//   Bright Data residential (routing in the username):
//     BRD_CUSTOMER, BRD_ZONE, BRD_PASSWORD, BRD_PROXY_HOST

function pick(env) {
  const p = (env.PROXY_PROVIDER || '').toLowerCase();
  if (p === 'iproyal') return 'iproyal';
  if (p === 'brightdata' || p === 'brd') return 'brightdata';
  if (env.IPROYAL_USER && env.IPROYAL_PASS) return 'iproyal';
  if (env.BRD_CUSTOMER && env.BRD_ZONE && env.BRD_PASSWORD) return 'brightdata';
  return null;
}

// `session` is an 8-char alphanumeric sticky-session id (IPRoyal requires
// exactly 8). Pass a stable value per monitored instance so its exit IP holds.
function buildProxy(env, cfg = {}, session = '') {
  const provider = pick(env);
  if (!provider) return null;

  if (provider === 'iproyal') {
    if (!env.IPROYAL_USER || !env.IPROYAL_PASS) throw new Error('IPROYAL_USER/IPROYAL_PASS required for iproyal');
    let password = env.IPROYAL_PASS;
    if (cfg.country) password += `_country-${cfg.country}`;
    if (session) password += `_session-${session}`;
    password += `_lifetime-${cfg.stickyLifetime || '30m'}`;
    return {
      provider,
      server: env.IPROYAL_HOST || 'http://geo.iproyal.com:12321',
      username: env.IPROYAL_USER,
      password,
    };
  }

  // brightdata
  let username = `brd-customer-${env.BRD_CUSTOMER}-zone-${env.BRD_ZONE}`;
  if (cfg.country) username += `-country-${cfg.country}`;
  if (session) username += `-session-${session}`;
  return {
    provider,
    server: env.BRD_PROXY_HOST || 'http://brd.superproxy.io:33335',
    username,
    password: env.BRD_PASSWORD,
  };
}

// Redacts the credential portion for logging (keeps the routing suffix visible
// so country/session/lifetime can be sanity-checked).
function describeProxy(p) {
  if (!p) return 'DIRECT (no proxy)';
  // Show only the routing tokens (base password may itself contain '_').
  const at = [/(_country-)/, /(_session-)/, /(_lifetime-)/]
    .map((re) => p.password.search(re)).filter((i) => i >= 0);
  const pwSuffix = at.length ? p.password.slice(Math.min(...at)) : '';
  return `${p.provider} via ${p.server} user=${p.username.slice(0, 6)}… pass=***${pwSuffix}`;
}

module.exports = { buildProxy, describeProxy, pick };
