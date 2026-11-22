#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/kiosk_common.sh"
rm -f ~/.config/chromium/SingletonLock ~/.config/chromium/SingletonCookie
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --force-device-scale-factor="$ZOOM" --kiosk --no-first-run --noerrdialogs --hide-scrollbars \
  --disable-infobars --disable-gpu --disable-software-rasterizer --ignore-gpu-blocklist \
  --allow-file-access-from-files "file://$DIR/tiltpi.html"
