#!/bin/bash -e
# Inside the image: install server dependencies (builds noble's native module), enable the
# service and configure the local display for this flavor (desktop or console).
APP="/home/${FIRST_USER_NAME}/TILTpi-v3"
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
