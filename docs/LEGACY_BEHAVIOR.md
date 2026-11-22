# Legacy Tilt Pi behavior (parity contract)

This is the behavior of the Node-RED Tilt Pi (v.2.9.3, `legacy/flow.json`, identical to the
`flow-candidate.json` deployed on current Tilt Pis) that the Node.js/React port must reproduce.
Each item notes where it lives in the new code. Items marked **CHANGED** are deliberate
differences — everything else should be identical. `legacy/flow.json` is the source of truth;
`server/test/parity.test.js` executes the original function-node code and compares results.

## 1. Bluetooth scanning
- Legacy: `sudo python3 -u -m aioblescan -T` (spawned), one JSON line per advertisement whose
  manufacturer data starts with `4c000215a495` (Apple iBeacon + `a495` UUID prefix):
  `{uuid, major, minor, tx_power(int8), rssi, mac}`.
- Watchdogs: scanner restarted (kill, wait 5 s, start) after 30 s with no output, or 5 s after the
  last output/error line.
- New: `server/src/ble/` — noble with duplicates allowed, same object shape. Restart on 30 s of
  silence or on adapter errors. **CHANGED**: no more 5 s-gap restart churn (that existed to recover a
  stalled python process).

## 2. Raw scan fan-out (before any filtering)
- Every raw scan goes to the `/tiltscan` aggregator (§10) **and** to the processing pipeline.
- Scans fetched from range-booster Pis (§11) enter the pipeline only (not `/tiltscan`).

## 3. Processing pipeline (`server/src/tilt/`)
1. RSSI filter: drop if `rssi < minRSSI` (`minRSSI` default −105).
2. UUID filter: `/a495bb..c5b14b44b5121370f02d74de/` (unanchored).
3. Color: `a495bb10…`RED, `20`GREEN, `30`BLACK, `40`PURPLE, `50`ORANGE, `60`BLUE, `70`YELLOW,
   `80`PINK; anything else keeps the raw uuid as Color.
4. Enrich ("Add Parameter"): with *ID by MAC* on, `Color = COLOR:mac`, `displayColor = Color.split(':')`.
   Adds Beer, cal-point strings, `timeStamp`, `formatteddate` (`toLocaleString()`), `Timepoint`
   (Sheets serial date, local time), SG (`minor/1000`, or Tilt Pro when `minor > 2000`:
   `minor/10000`, `major/10`, `hd=true`), Temp, unit settings, cloud settings.
   A color seen for the first time is added to the sorted `options` list (Tilt dropdowns).
5. Settings backup ("Changed?"): when any persisted field differs from the last backup for that
   color, write the enriched payload (latest per color every 15 s) to `<data>/global.json` and
   `<data>/<Color>.json` (kept for `/data/` compatibility and downgrade).
6. Smoothing (if enabled and SG > 0.5): per-color sample every ≥5 s, moving window of
   `numberSamples*12` samples, output `SG*(1-α)+mean*α` (α = %/100). Defaults α=100 %, 0.5 min.
7. Calibration ("Interpolate"): piecewise-linear interpolation through the cal points plus
   sentinels (SG: −0.001 and MAX_VALUE; Temp: −999 and MAX_VALUE). Temp cal points are in display
   units (°C conversion uses `×0.5555`, back with `×1.8+32` — kept for identical numbers).
   Adds `uncalSG/Plato/Brix`, `Plato`, `Brix`, `ferm`/`uncalferm` (SG 3 dp or 4 dp HD;
   °P/°Bx 1 dp or 2 dp HD), `displayTemp`, `displayuncalTemp`, `Temp` (°F string, 1 dp).
8. Display slot: first index `i` where `Color.includes(options[i])` → slot `i` (max 25).

## 4. Display ("Tilt Pi" tab) — `web/src/tabs/TiltTab.jsx`
- Every second each occupied slot gets `clock = now`. If any slot is older than 120 s, **all**
  slots and `options` are cleared (they repopulate as readings arrive).
- 8 slot cards always shown (empty = blank grey card); slots 9–25 only when *ID by MAC* is on.
- Card: beer name; `TILT | COLOR mac[4] mac[5]` + " | View Cloud Log" link when known; color bar
  (PINK→DEEPPINK); "SG/Concentration: {uncalferm} (pre-calibrated)"; big `{ferm}{units}`; bar
  width `(SG−0.990)/0.0013 %`; "Temperature: {displayuncalTemp} (pre-calibrated)"; big
  `{displayTemp}{°F|°C}`; bar width `(Temp°F−30)/1.85 %`; date; "Received N.N seconds ago R dBm".
- Toggling *ID by MAC* resets the slots (legacy: temporary 5 s display timeout). **CHANGED**:
  cleared immediately instead of via the timeout trick.

## 5. Cloud logging (`server/src/logging/cloud.js`)
- On each 1 s tick per visible reading: if cloud logging on and
  `timeStamp − lastpost[color] > loggingInterval min`, POST
  `encodeURI("Timepoint=…&Temp=…&SG=…&Beer=…&Color=…&Comment=…")`
  (`application/x-www-form-urlencoded; charset=utf-8`). Beer = name, or `name,id` when the cloud
  returned an id. URL: default Google Script, or each comma-separated custom URL for that color.
- Posts are queued and sent at most one every 5 s. Status shows "Contacting Default Cloud URL…
  (allow up to 30 seconds)" / "Contacting Cloud URL n…"; then `result` (+ doc link when the
  response is for the selected Tilt); 30 s after the last activity: "Waiting for next time point...".
- Response with `beername` containing a comma → Beer = split, comment cleared, `doclongurl` saved
  as the "View Cloud Log" link. Network errors → toast "Alert: {message}".
- **CHANGED**: the response only updates the Beer Name box if it is for the Tilt currently selected
  (legacy overwrote the box regardless of selection).

## 6. Logging tab controls
- Quick Start: Tilt dropdown; Set Beer Name (`name` → `[name,true]` and clears link; `name,id`
  kept as given; toast "Beer name set for COLOR"); Enter GMAIL email → comment
  `{"template","email","gunits","tunits","Comment":""}` + immediate post (lastpost=0, lastlocalpost=0),
  toast "Sending: email", box cleared after 0.5 s; Cloud Status.
- Cloud Settings: Cloud URL box (default URL shown when "Use Default" on, else this color's custom
  URLs or "Not set for COLOR"; entering text sets this color's custom URLs, toast lists them);
  Use Default Cloud URL for All; Logging Template (v2=`B2` default / classic=`B1`); Start Logging to
  the Cloud (toast); Time Interval slider 5–60 step 5 + "Minutes: N"; Comment box (sets the comment
  sent with the next post; cleared after 0.5 s).
- Tilt Pi Settings: Start Logging to Tilt Pi; interval slider 0.1–60 + "Minimum Minutes: N";
  Download Log; USB status; "Size: N bytes"; Delete Log (rewrites header only).
- **CHANGED**: a non-JSON comment now shows a "Sending: …" toast (legacy threw an error after
  saving it and showed nothing).

## 7. Local CSV log (`server/src/logging/local.js`)
- `<data>/log.csv`, header `Time,Timepoint,Temp,SG,Beer,Color,Comment,RSSI,Uptime`.
- Per reading when local logging on and interval elapsed: line
  `{toLocaleString with first "," → " "},{Timepoint},{Temp},{SG},{Beer[0]},{Color},{Comment},{rssi},{tx_power as uint8}`.
  Written only if Temp/SG/Beer/Comment changed since the last line for that color or 15 min passed.
  If cloud logging is off, the comment is cleared after writing.
- `GET /log.csv` downloads it. USB: when `/dev/sdX` appears, mount `/dev/sdX1` on `/mnt/usb`
  (`uid=pi,gid=pi`), copy, unmount, "Success, remove USB drive." (status resets every 30 s).

## 8. Calibration tab
- Tilt dropdown (shared selection with Logging tab in legacy — **CHANGED**: selection is per browser,
  both tabs still share it).
- SG: Calibrate in Water (actual 1.0000), Pre-cal SG numeric (0.99–1.12 step .0001), Get Current SG
  switch (auto-fills both numerics every second; editing either numeric turns it off), Actual SG,
  Calibrate in Known SG, points table (≤5 rows, X deletes), Delete All. Points stored as strings
  (`toFixed(4)`), each list sorted independently.
  *Port change (requested):* when the gravity unit is Plato or Brix, the group, labels, numerics
  (2 decimals, step .01) and points table use that unit; values are converted to SG in the browser
  (`web/src/units.js`, same formulas as the server) before `addSGPoint`, so points are still stored
  in SG and stay valid when the unit changes. Numerics can be typed again (legacy ui_numeric).
- Temp: same with Ice Water (32.0 °F or 0.0 °C by display units), numerics −20…220 step .1.
  *Port change (requested):* legacy stored temp points in the display unit, so switching °F/°C
  silently broke them. The port stores them in °F (`addTempPoint` converts °C input; °C entries keep
  2 decimals, e.g. 20.0 °C → "68.00", so they convert back exactly; Ice Water = "32.0"). When a
  reading is enriched they are converted to the display unit, so Interpolate and the legacy backup
  files see exactly what legacy did. One-time migration (`settings.tempPointsUnit`): if the display
  unit is °C when the port first loads settings, existing temp points are converted °C → °F.

## 9. System tab
- Time: time zone dropdown + Set Time Zone (toast + status "Restart Needed / Click restart to save
  changes."); Adjust System Time Manually (`date -s`, toast "System Time Updated"; box refreshed every 60 s).
- Display Units: Fahrenheit/Celsius and SG/Plato/Brix (radio-like switches).
- Smoothing: Enable, Averaging Time (min, 0–120 step .1), Temperature %, Gravity % (1–100).
- Filter by RSSI: slider −105…−35 + "Minimum RSSI in dBm".
- Identify Tilt by MAC Address: switch.
- App Admin: Update App, current version + notes, latest-release check (daily, GitHub API),
  beta branch box. **CHANGED**: updates pull this repo instead of POSTing a flow.json to Node-RED.
- Dashboard Link: IP link (`hostname -I`), hostname link, Reset Link to tiltpi, Set New Hostname
  (RFC1123 check; `raspi-config nonint do_hostname`; dialog "Restart Now / Restart Later").
- Boost Range: enable switch (polls each ranger's `/tiltscan` every 2.5 s), add/remove hostname
  box (toggle, newest first, max 4), four URL readouts. *Port change (requested):* an "Add Tilt Pi"
  box (invalid names get a toast) plus a list with an X delete button per Tilt Pi, like the
  calibration points table; adding a 5th still drops the oldest.
  Each row has a status light: green = last poll answered, red = failed, grey = not polled
  (Range Booster off). *Port fixes:* a bare name that doesn't resolve is retried as `<name>.local`;
  names are looked up outside the 5 s fetch timeout and cached 5 min; failed hosts are retried every
  30 s (legacy re-polled dead hosts every 2.5 s).
- *Port addition:* Dashboard Link group shows a "Local Name Check" light with a "Test & Reset Local
  Name" button. Every 5 min (first after 60 s) the app looks up its own `<hostname>.local`; if that
  fails it restarts avahi-daemon and checks again (`server/src/system/mdns.js`).
- Raspberry Pi: Screen Auto Off (Never/1 min/10 min/2 h/8 h/16 h), Screen Zoom 0.5–3
  (toast "Restart to Enable New Settings"), BT stability fix / revert for RPi3 (btuart baud),
  Restart, Shutdown. **CHANGED**: instead of `sed`-editing `~/xinitrc_chromium.sh` / LXDE autostart, the app
  writes `<data>/kiosk.conf` (`ZOOM`, `SCREEN_OFF`), read by `deploy/kiosk/` at session start.

## 9b. Local display (from the current Lite image, `~/launch_kiosk.sh`)
- tty1 autologin → `.bash_profile` → `deploy/kiosk/launch_kiosk.sh`: ≤600 MB RAM → X + openbox +
  Tkinter `dashboard/tiltpi_dashboard.py` (reads `/macid/all`); otherwise X + openbox + Chromium kiosk
  showing `tiltpi.html` (waits for the server, then redirects to `/ui`).

## 10. HTTP endpoints (must stay compatible — other Tilt Pis and the Tkinter dashboard use them)
- `GET /tiltscan` — latest snapshot of raw scans (all `a495…` iBeacons, pre-RSSI-filter),
  latest per MAC every 2.5 s, snapshot taken when a MAC repeats; `{}` before the first snapshot.
- `GET /macid/:mac` — stored reading (with `clock`) for that MAC; `all` → array of all slots;
  `{}` when nothing matches.
- `GET /data/:file`, `GET /data/` — JSON file from the data dir (`global` default), CORS `*`.
  **CHANGED**: restricted to `.json` files inside the data dir (legacy allowed path traversal).
- `GET /log.csv` — the CSV log.
- `/ui` — dashboard. Port 1880.

## 11. First boot / provisioning (files on the boot partition, from `legacy/SETUP/SETUP.html`)
- `wpa_supplicant.conf`: ssid/psk lines → `raspi-config nonint do_wifi_ssid_passphrase`; file
  removed on success. *Port change:* on Trixie that raspi-config call is `nmcli device wifi connect`,
  which fails if NetworkManager hasn't started/scanned yet right after boot, and legacy never
  retried. The port instead saves a NetworkManager profile `tiltpi-<ssid>` (autoconnect, retried
  for ~2 min while NM starts), deletes the file, then tries `nmcli connection up`. *Port addition:* its `country=XX` line (SETUP.html always writes `GB`) is
  applied with `do_wifi_country` only when the Pi has no WiFi country yet; Trixie keeps WiFi
  blocked until one is set. The images ship SETUP.html, logo.png and `mdl/` on the boot partition.
- `cloud_log_<color>.json` (`{"Color","Comment"(email),"Beer":[name,true]}`): processed once the
  first Tilt is displayed after boot: default cloud URL, comment = email, cloud+local logging on,
  15 min intervals, beer name, post now, log reset; after 60 s comment = dashboard IP link and post
  again. File removed. *Port change (requested):* instead of the fixed 60 s, the email post waits
  for an IPv4 address (polled every 2 s, max 5 min), and the dashboard-link post waits for that
  post's reply to set the cloud sheet id in Beer[1] (max 60 s; skipped with no email), then uses the
  IP read at that moment (legacy-port used the one seen 10 s after startup).
  *Port addition:* SETUP.html now builds this file with `JSON.stringify` (quotes in names no longer
  break it) and adds the browser's `Timezone` (IANA name) and `Locale`. At startup, before Bluetooth
  scanning begins, the app applies `Timezone` with `timedatectl` and to its own process, so the
  first log entries are already local time. `Locale` (also applied at startup) sets the date format
  setting and presets °F (US & territories, LR, MM, BS, BZ, KY, PW) or °C; gravity stays SG.
- *Port addition:* global setting `locale` (System tab → Display Units → Date Format; '' = the Pi's
  system locale, i.e. legacy behavior) formats the card date (`formatteddate`) and log.csv's Time
  column, always with Latin digits. All commas in log.csv's Time are now replaced (legacy replaced
  the first only; en-GB dates have one, so output is unchanged).

## 12. Persistence
- Legacy settings lived in Node-RED memory and were only saved through §3.5 (so changes made with
  no Tilt in range were lost on reboot). **CHANGED**: `<data>/settings.json` saved on every change;
  imported from `global.json` + `<Color>.json` on first start.
- Not persisted (same as legacy): comments, cloud doc links, last-post times, logging template.

## 13. Known legacy quirks — decisions
| Quirk | Decision |
|---|---|
| Cloud logging switch always comes back ON after reboot (`x \|\| true` in Add Parameter) | **CHANGED** — persisted value is honored. Revisit if users rely on auto-resume. |
| Beer names / comments with `&`, `=`, `#` break the encoded body (`encodeURI`) | Kept for now (Google Script compatibility). |
| Comment with commas shifts CSV columns | Kept. |
| °C conversion uses 0.5555 instead of 5/9 | Kept (identical numbers). |
