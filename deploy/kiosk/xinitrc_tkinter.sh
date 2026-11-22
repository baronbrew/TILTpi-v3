#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/kiosk_common.sh"
exec python3 "$DIR/../../dashboard/tiltpi_dashboard.py"
