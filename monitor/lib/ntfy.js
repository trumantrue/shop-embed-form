// Minimal ntfy publisher. Sends a screenshot as the attachment body with
// title/message/click/action headers so the phone notification carries the
// before/after context and a one-tap link into the live (noVNC) browser.
//
// Env:
//   NTFY_SERVER  base URL, default https://ntfy.sh
//   NTFY_TOPIC   topic to publish to (required for alerts to actually send)
//   NTFY_TOKEN   optional access token for protected topics / self-hosted

const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_TOKEN = process.env.NTFY_TOKEN || '';

// ntfy header values must be latin1-safe; strip anything exotic.
// ntfy renders a literal backslash-n in message headers as a line break.
function headerSafe(s) {
  return String(s).replace(/\n/g, '\\n').replace(/[^\x20-\x7e]/g, '?').slice(0, 700);
}

async function publish({ title, message, priority = 'high', tags = 'rotating_light', clickUrl, actionLabel, attachment, filename }) {
  if (!NTFY_TOPIC) {
    console.warn('[ntfy] NTFY_TOPIC not set — alert NOT sent. Alert was:', title, '|', message);
    return false;
  }
  const headers = {
    'X-Title': headerSafe(title),
    'X-Priority': priority,
    'X-Tags': tags,
  };
  if (NTFY_TOKEN) headers['Authorization'] = `Bearer ${NTFY_TOKEN}`;
  if (clickUrl) headers['X-Click'] = headerSafe(clickUrl);
  if (clickUrl && actionLabel) {
    headers['X-Actions'] = headerSafe(`view, ${actionLabel}, ${clickUrl}`);
  }

  let body;
  if (attachment) {
    headers['X-Filename'] = headerSafe(filename || 'screenshot.png');
    if (message) headers['X-Message'] = headerSafe(message);
    body = attachment;
  } else {
    body = message || '';
  }

  try {
    const res = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, {
      method: attachment ? 'PUT' : 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[ntfy] publish failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      return false;
    }
    console.log(`[ntfy] alert sent to ${NTFY_SERVER}/${NTFY_TOPIC}`);
    return true;
  } catch (err) {
    console.error(`[ntfy] publish error: ${err.message}`);
    return false;
  }
}

module.exports = { publish };
