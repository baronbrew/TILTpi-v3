#!/bin/bash
# Desktop image (Raspberry Pi OS with desktop, labwc/Wayland): started from ~/.config/labwc/autostart.
# <= 600 MB RAM (512 MB boards: Pi Zero 2 W, Pi 3A+; they report ~430 MB, 1 GB boards ~900 MB):
# native Tkinter dashboard (an X11 app, shown through Xwayland). Otherwise: Chromium kiosk.
# Optional argument "tkinter" or "chromium" forces a mode (for testing).
# Screen settings come from /home/pi/kiosk.conf written by the Tilt Pi app.
DIR="$(cd "$(dirname "$0")" && pwd)"
ZOOM=1
SCREEN_OFF=0
[ -f /home/pi/kiosk.conf ] && . /home/pi/kiosk.conf

if [ "${SCREEN_OFF:-0}" -gt 0 ]; then
  swayidle -w timeout "$SCREEN_OFF" 'wlopm --off \*' resume 'wlopm --on \*' &
fi

MODE="${1:-auto}"
if [ "$MODE" = auto ]; then
  TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
  if [ "$TOTAL_RAM" -le 600 ]; then MODE=tkinter; else MODE=chromium; fi
  echo "Detected Total RAM: ${TOTAL_RAM}MB -> $MODE"
fi

if [ "$MODE" = tkinter ]; then
  exec python3 "$DIR/../../dashboard/tiltpi_dashboard.py"
fi

rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --ozone-platform=wayland --force-device-scale-factor="$ZOOM" --kiosk --no-first-run \
  --noerrdialogs --hide-scrollbars --disable-infobars --password-store=basic \
  --allow-file-access-from-files "file://$DIR/tiltpi.html"
