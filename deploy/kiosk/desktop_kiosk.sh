#!/bin/bash
# Desktop image (Raspberry Pi OS with desktop, labwc/Wayland): started from ~/.config/labwc/autostart.
# Screen settings come from /home/pi/kiosk.conf written by the Tilt Pi app.
DIR="$(cd "$(dirname "$0")" && pwd)"
ZOOM=1
SCREEN_OFF=0
[ -f /home/pi/kiosk.conf ] && . /home/pi/kiosk.conf

if [ "${SCREEN_OFF:-0}" -gt 0 ]; then
  swayidle -w timeout "$SCREEN_OFF" 'wlopm --off \*' resume 'wlopm --on \*' &
fi

rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --ozone-platform=wayland --force-device-scale-factor="$ZOOM" --kiosk --no-first-run \
  --noerrdialogs --hide-scrollbars --disable-infobars --password-store=basic \
  --allow-file-access-from-files "file://$DIR/tiltpi.html"
