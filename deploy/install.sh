#!/bin/bash
# First-time install on Raspberry Pi OS. Run as pi from the repo checkout: bash deploy/install.sh
# Also configures the local display (deploy/kiosk/setup.sh).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  sudo apt-get update && sudo apt-get install -y nodejs npm
fi
sudo apt-get install -y bluetooth bluez rfkill libbluetooth-dev libudev-dev build-essential git
# Fresh Pi OS images soft-block Bluetooth until unblocked once (state persists).
sudo rfkill unblock bluetooth
cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund
sudo cp "$APP/deploy/tiltpi.service" /etc/systemd/system/tiltpi.service
sudo systemctl daemon-reload
sudo systemctl enable --now tiltpi
bash "$APP/deploy/kiosk/setup.sh"
echo "Tilt Pi running at http://$(hostname).local:1880/ui"
