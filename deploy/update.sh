#!/bin/bash
# Self-update (run via systemd-run by "Update App"). Optional arg: branch name.
set -euo pipefail
APP=/home/pi/TILTpi-v3
BRANCH="${1:-main}"
cd "$APP"
sudo -u pi git fetch --depth 1 origin "$BRANCH"
sudo -u pi git checkout -B "$BRANCH" FETCH_HEAD
cd server && sudo -u pi npm ci --omit=dev --no-audit --no-fund
# Pick up changes to the service unit too.
cp "$APP/deploy/tiltpi.service" /etc/systemd/system/tiltpi.service
systemctl daemon-reload
systemctl restart tiltpi
