#!/bin/bash
set -euo pipefail

: "${VNC_PASSWORD:?Set VNC_PASSWORD — never expose an unauthenticated noVNC}"

SCREEN="${SCREEN_GEOMETRY:-1280x900x24}"

# Clear any stale X lock/socket left in this container's writable layer by a
# previous run. Without this, a restarted container (restart:unless-stopped,
# or a host reboot) hits "Server is already active for display 99" and
# crash-loops forever — the lock outlives the Xvfb process that made it.
pkill -x Xvfb 2>/dev/null || true
rm -f /tmp/.X99-lock
rm -f /tmp/.X11-unix/X99 2>/dev/null || true

Xvfb :99 -screen 0 "$SCREEN" -nolisten tcp &
XVFB_PID=$!

# Wait for the display to actually accept connections before x11vnc/Chromium
# attach (a fixed sleep 1 loses the race on a loaded host). Fail fast if Xvfb
# dies, so restart:unless-stopped retries cleanly instead of a half-up stack.
for i in $(seq 1 30); do
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "start.sh: Xvfb exited during startup" >&2
    exit 1
  fi
  xdpyinfo -display :99 >/dev/null 2>&1 && break
  sleep 0.5
done

x11vnc -display :99 -forever -shared -passwd "$VNC_PASSWORD" -rfbport 5900 \
       -quiet -bg -o /tmp/x11vnc.log

# noVNC web client on :6080 → open http://<host>:6080/vnc.html
websockify --web=/usr/share/novnc 6080 localhost:5900 &

exec node watcher.js
