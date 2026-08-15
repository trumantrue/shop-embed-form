#!/bin/bash
set -euo pipefail

: "${VNC_PASSWORD:?Set VNC_PASSWORD — never expose an unauthenticated noVNC}"

SCREEN="${SCREEN_GEOMETRY:-1280x900x24}"

Xvfb :99 -screen 0 "$SCREEN" -nolisten tcp &
sleep 1

x11vnc -display :99 -forever -shared -passwd "$VNC_PASSWORD" -rfbport 5900 \
       -quiet -bg -o /tmp/x11vnc.log

# noVNC web client on :6080 → open http://<host>:6080/vnc.html
websockify --web=/usr/share/novnc 6080 localhost:5900 &

exec node watcher.js
