// Verifies the proxy credential formats without any network / bandwidth spend.
//   node monitor/proxytest.js
const assert = require('assert');
const { buildProxy, describeProxy } = require('./lib/proxy');

// IPRoyal: routing rides in the password; server is geo.iproyal.com:12321.
const ip = buildProxy(
  { IPROYAL_USER: 'myuser', IPROYAL_PASS: 'mypass' },
  { country: 'us', stickyLifetime: '30m' },
  'a1b2c3d4',
);
assert.strictEqual(ip.provider, 'iproyal');
assert.strictEqual(ip.server, 'http://geo.iproyal.com:12321');
assert.strictEqual(ip.username, 'myuser');
assert.strictEqual(ip.password, 'mypass_country-us_session-a1b2c3d4_lifetime-30m');

// No country -> no _country segment; default lifetime 30m.
const ip2 = buildProxy({ IPROYAL_USER: 'u', IPROYAL_PASS: 'p' }, {}, 'zzzz0000');
assert.strictEqual(ip2.password, 'p_session-zzzz0000_lifetime-30m');

// Session id is 8 chars (IPRoyal requirement) when sourced from 4 random bytes.
assert.strictEqual(require('crypto').randomBytes(4).toString('hex').length, 8);

// Bright Data: routing rides in the username.
const brd = buildProxy(
  { BRD_CUSTOMER: 'hl_x', BRD_ZONE: 'resi', BRD_PASSWORD: 'pw' },
  { country: 'de' },
  'sess1234',
);
assert.strictEqual(brd.provider, 'brightdata');
assert.strictEqual(brd.username, 'brd-customer-hl_x-zone-resi-country-de-session-sess1234');
assert.strictEqual(brd.password, 'pw');

// Explicit provider override wins.
assert.strictEqual(buildProxy({ PROXY_PROVIDER: 'iproyal', IPROYAL_USER: 'u', IPROYAL_PASS: 'p' }, {}, 's').provider, 'iproyal');

// No creds -> direct (null).
assert.strictEqual(buildProxy({}, {}, ''), null);

// Redaction keeps the routing suffix but hides the secret.
assert.ok(describeProxy(ip).includes('_country-us_session-a1b2c3d4_lifetime-30m'));
assert.ok(!describeProxy(ip).includes('mypass'));

console.log('proxytest: all assertions passed');
console.log('  iproyal example :', describeProxy(ip));
console.log('  brightdata ex.  :', describeProxy(brd));
