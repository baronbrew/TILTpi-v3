#!/bin/bash
# Configure the local display for this OS flavor. Run as pi (uses sudo). Idempotent.
#  - Desktop (labwc session present): Chromium kiosk from ~/.config/labwc/autostart
#  - Lite: console autologin on tty1 → launch_kiosk.sh (Tkinter on <=600 MB RAM, else Chromium)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MARK="# tiltpi-kiosk"

if [ -f /usr/share/wayland-sessions/rpd-labwc.desktop ]; then
  mkdir -p ~/.config/labwc
  touch ~/.config/labwc/autostart
  sed -i "/$MARK/d" ~/.config/labwc/autostart
  echo "$DIR/desktop_kiosk.sh & $MARK" >> ~/.config/labwc/autostart
  sudo raspi-config nonint do_boot_behaviour B4   # desktop autologin
  echo "Desktop kiosk configured."
else
  sudo apt-get install -y --no-install-recommends xserver-xorg xinit openbox unclutter x11-xserver-utils python3-tk
  TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
  if [ "$TOTAL_RAM" -gt 600 ]; then sudo apt-get install -y --no-install-recommends chromium; fi
  touch ~/.bash_profile
  sed -i "/$MARK/d" ~/.bash_profile
  echo "[ -z \"\$DISPLAY\" ] && [ \"\$(tty)\" = /dev/tty1 ] && exec $DIR/launch_kiosk.sh $MARK" >> ~/.bash_profile
  sudo raspi-config nonint do_boot_behaviour B2   # console autologin
  echo "Console kiosk configured."
fi
