#!/bin/bash
# Local display launcher for the console-autologin (Lite) image, started from ~/.bash_profile on tty1.
# <= 600 MB RAM (Pi Zero W, Pi 3A+): native Tkinter dashboard. Otherwise: Chromium kiosk on /ui.
DIR="$(cd "$(dirname "$0")" && pwd)"

# On a Pi Zero W, tty1 autologin runs before the display driver is ready: X then failed with
# "open /dev/dri/card0: Permission denied ... no screens found" and only the next login worked.
# Wait (up to 60 s) until the display device is usable and the glamor check has run.
for _ in $(seq 1 120); do
  if [ -r /dev/dri/card0 ] && [ -w /dev/dri/card0 ] &&
    { ! systemctl cat glamor-test.service >/dev/null 2>&1 || systemctl is-active --quiet glamor-test.service; }; then
    break
  fi
  sleep 0.5
done

TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
echo "Detected Total RAM: ${TOTAL_RAM}MB"
if [ "$TOTAL_RAM" -le 600 ]; then
  echo "Low memory detected. Launching Tkinter dashboard..."
  exec xinit "$DIR/xinitrc_tkinter.sh" -- vt1
else
  echo "Launching Chromium kiosk..."
  exec xinit "$DIR/xinitrc_chromium.sh" -- vt1
fi
