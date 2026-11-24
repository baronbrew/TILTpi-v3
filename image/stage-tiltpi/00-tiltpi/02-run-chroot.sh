#!/bin/bash -e
# Inside the image: install Node.js and the server dependencies (builds noble's native module),
# enable the service and configure the local display for this flavor (desktop or console).
APP="/home/${FIRST_USER_NAME}/TILTpi-v3"

# Node.js. armhf (the Lite image, Pi Zero W and newer): Node.js's ARMv6 build from
# unofficial-builds.nodejs.org, pinned to the version running on the known-good bookworm Tilt Pi
# (installed by Node-RED's installer); the Zero W never started the server with Node 20/22.
# It runs on every 32-bit Pi. arm64: Debian's nodejs.
NODE_ARMV6_VERSION=v18.20.8
if [ "$(dpkg --print-architecture)" = armhf ]; then
  DIST=https://unofficial-builds.nodejs.org/download/release
  VER=$NODE_ARMV6_VERSION
  TARBALL="node-$VER-linux-armv6l.tar.xz"
  TMP=$(mktemp -d)
  curl -fsSL --retry 3 -o "$TMP/$TARBALL" "$DIST/$VER/$TARBALL"
  curl -fsSL --retry 3 -o "$TMP/SHASUMS256.txt" "$DIST/$VER/SHASUMS256.txt"
  (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$TMP/$TARBALL" -C /usr/local --strip-components=1 --no-same-owner \
    --exclude='*/CHANGELOG.md' --exclude='*/LICENSE' --exclude='*/README.md' --exclude='*/share/doc'
  rm -rf "$TMP"
  # The service runs /usr/bin/node.
  ln -sf /usr/local/bin/node /usr/bin/node
  echo "Installed Node.js $VER (linux-armv6l)"
else
  apt-get install -y --no-install-recommends nodejs npm
fi
node -v

chown -R "${FIRST_USER_NAME}:${FIRST_USER_NAME}" "$APP"
sudo -u "${FIRST_USER_NAME}" -H bash -c "cd '$APP/server' && npm ci --omit=dev --no-audit --no-fund"
sed "s#/home/pi#/home/${FIRST_USER_NAME}#g; s#^User=pi#User=${FIRST_USER_NAME}#" "$APP/deploy/tiltpi.service" > /etc/systemd/system/tiltpi.service
systemctl enable tiltpi.service
# Same passwordless sudo the app needs for System tab controls (pi-gen normally adds this too).
echo "${FIRST_USER_NAME} ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/010_pi-nopasswd
chmod 0440 /etc/sudoers.d/010_pi-nopasswd
# As root: on the armhf build (qemu emulation) sudo from a normal user fails with "effective uid
# is not 0", so setup.sh does the system parts directly and chowns the user's files.
TILTPI_USER="${FIRST_USER_NAME}" bash "$APP/deploy/kiosk/setup.sh"
