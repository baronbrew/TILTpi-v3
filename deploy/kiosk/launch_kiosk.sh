#!/bin/bash
# Local display launcher for the console-autologin (Lite) image, started from ~/.bash_profile on tty1.
# <= 600 MB RAM (Pi Zero W, Pi 3A+): native Tkinter dashboard. Otherwise: Chromium kiosk on /ui.
DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
echo "Detected Total RAM: ${TOTAL_RAM}MB"
if [ "$TOTAL_RAM" -le 600 ]; then
  echo "Low memory detected. Launching Tkinter dashboard..."
  exec xinit "$DIR/xinitrc_tkinter.sh" -- vt1
else
  echo "Launching Chromium kiosk..."
  exec xinit "$DIR/xinitrc_chromium.sh" -- vt1
fi
