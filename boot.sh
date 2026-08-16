#!/bin/bash
# Brings the site-monitor fleet up at login. colima (the Docker VM) does not
# autostart; once it is up the 21 containers restore via restart:unless-stopped.
# Installed as LaunchAgent com.sitemonitor.fleet (RunAtLoad). Idempotent.
export PATH="$HOME/bin:$PATH"
REPO="$HOME/dev/site-monitor"
LOG="$REPO/boot.log"
echo "[boot $(date '+%Y-%m-%d %H:%M:%S')] fired" >> "$LOG"

# Start colima, retrying — at boot the disk/vz stack may not be ready first try.
for i in 1 2 3 4 5 6; do
  if colima status >/dev/null 2>&1; then
    echo "[boot] colima already running" >> "$LOG"; break
  fi
  echo "[boot] colima start attempt $i" >> "$LOG"
  colima start >> "$LOG" 2>&1 && { echo "[boot] colima started" >> "$LOG"; break; }
  sleep 10
done

# Wait for the Docker socket to answer before compose.
for i in $(seq 1 12); do
  docker info >/dev/null 2>&1 && break
  sleep 5
done

cd "$REPO" || { echo "[boot] repo missing" >> "$LOG"; exit 1; }
docker compose -f docker-compose.fleet.yml up -d >> "$LOG" 2>&1
echo "[boot $(date '+%H:%M:%S')] done: $(docker ps -q | wc -l | tr -d ' ') containers up" >> "$LOG"
