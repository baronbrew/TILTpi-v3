# Shared X session setup. Screen settings come from the Tilt Pi app (System tab → Raspberry Pi),
# which writes /home/pi/kiosk.conf: ZOOM=<scale>  SCREEN_OFF=<seconds, 0 = never>.
export DISPLAY=:0
ZOOM=1
SCREEN_OFF=0
[ -f /home/pi/kiosk.conf ] && . /home/pi/kiosk.conf
xhost +local: >/dev/null
if [ "${SCREEN_OFF:-0}" -gt 0 ]; then
  xset s "$SCREEN_OFF" "$SCREEN_OFF"
  xset +dpms
  xset dpms "$SCREEN_OFF" "$SCREEN_OFF" "$SCREEN_OFF"
else
  xset s off
  xset s noblank
  xset -dpms
fi
unclutter -idle 0.5 -root &
openbox-session &
sleep 1
