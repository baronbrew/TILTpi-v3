#!/bin/bash -e
# Host side: copy the TILTpi-v3 checkout (placed in files/ by the workflow) into the image.
install -d "${ROOTFS_DIR}/home/${FIRST_USER_NAME}"
cp -a files/TILTpi-v3 "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/TILTpi-v3"
