#!/bin/bash
# Configure the local display for this OS flavor. Idempotent.
#  - Desktop (labwc session present): ~/.config/labwc/autostart → desktop_kiosk.sh
#    (Tkinter on <=600 MB RAM, else Chromium)
#  - Lite: console autologin on tty1 → launch_kiosk.sh (Tkinter on <=600 MB RAM, else Chromium)
# Run as pi (uses sudo), or as root with TILTPI_USER=<user> (the image build: sudo as a normal
# user doesn't work under the armhf emulator there, so root does it all and chowns the user's files).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MARK="# tiltpi-kiosk"

if [ "$(id -u)" = 0 ]; then
  TARGET_USER="${TILTPI_USER:-${SUDO_USER:-pi}}"
  as_root() { SUDO_USER="$TARGET_USER" "$@"; } # raspi-config uses SUDO_USER for the autologin user
else
  TARGET_USER="$(id -un)"
  as_root() { sudo "$@"; }
fi
USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"

if [ -f /usr/share/wayland-sessions/rpd-labwc.desktop ]; then
  as_root apt-get install -y --no-install-recommends python3-tk || echo "WARN: could not install python3-tk"
  AUTOSTART="$USER_HOME/.config/labwc/autostart"
  mkdir -p "$(dirname "$AUTOSTART")"
  touch "$AUTOSTART"
  sed -i "/$MARK/d" "$AUTOSTART"
  echo "$DIR/desktop_kiosk.sh & $MARK" >> "$AUTOSTART"
  OWNED=("$USER_HOME/.config/labwc")
  as_root raspi-config nonint do_boot_behaviour B4 || echo "WARN: could not set desktop autologin"
  MSG="Desktop kiosk configured."
else
  as_root apt-get install -y --no-install-recommends xserver-xorg xinit openbox unclutter x11-xserver-utils python3-tk
  # gldriver-test (part of the full Raspberry Pi OS images, not Lite): its glamor-test.service turns
  # X's glamor acceleration off on boards before the Pi 4 (Zero W, Zero 2 W, 3). With glamor on, X
  # drew the dashboard but HDMI stayed blank on a Zero 2 W, and X failed on a Zero W.
  as_root apt-get install -y --no-install-recommends gldriver-test || echo "WARN: could not install gldriver-test"
  # As on the legacy Tilt Pi image: X drives the vc4 display device (matters on a Pi 5).
  as_root mkdir -p /etc/X11/xorg.conf.d
  printf '%s\n' 'Section "OutputClass"' '  Identifier "vc4"' '  MatchDriver "vc4"' '  Driver "modesetting"' \
    '  Option "PrimaryGPU" "true"' 'EndSection' | as_root tee /etc/X11/xorg.conf.d/99-v3d.conf >/dev/null
  TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
  if [ "$TOTAL_RAM" -gt 600 ]; then
    # Bookworm-era Raspbian archives may only have the older package name.
    as_root apt-get install -y --no-install-recommends chromium ||
      as_root apt-get install -y --no-install-recommends chromium-browser
  fi
  PROFILE="$USER_HOME/.bash_profile"
  touch "$PROFILE"
  sed -i "/$MARK/d" "$PROFILE"
  echo "[ -z \"\$DISPLAY\" ] && [ \"\$(tty)\" = /dev/tty1 ] && exec $DIR/launch_kiosk.sh $MARK" >> "$PROFILE"
  OWNED=("$PROFILE")
  as_root raspi-config nonint do_boot_behaviour B2 || echo "WARN: could not set console autologin"
  MSG="Console kiosk configured."
fi
if [ "$(id -u)" = 0 ] && [ "$TARGET_USER" != root ]; then
  [ -d "$USER_HOME/.config" ] && chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config"
  chown -R "$TARGET_USER:$TARGET_USER" "${OWNED[@]}"
fi
echo "$MSG"
