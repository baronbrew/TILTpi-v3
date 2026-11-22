#!/bin/bash -e
# Host side: copy the TILTpi-v3 checkout (placed in files/ by the workflow) into the image.
install -d "${ROOTFS_DIR}/home/${FIRST_USER_NAME}"
cp -a files/TILTpi-v3 "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/TILTpi-v3"

# SETUP.html (+ logo and mdl/ styles) on the boot partition, so users can open it on a PC/Mac to
# make wpa_supplicant.conf and cloud_log_<color>.json and save them back onto the card.
cp -r files/TILTpi-v3/legacy/SETUP/. "${ROOTFS_DIR}/boot/firmware/"
