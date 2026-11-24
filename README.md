# TILTpi-v3 — Tilt Pi (Node.js + React)

Port of the Node-RED Tilt Pi (`legacy/flow.json`) to plain Node.js and React, with Bluetooth
scanning done in JavaScript (noble) instead of the Python `aioblescan` process.

- `server/` – backend: BLE scanning, processing, cloud + CSV logging, system controls,
  legacy-compatible HTTP endpoints (`/tiltscan`, `/macid/:mac`, `/data/:file`, `/log.csv`), WebSocket for the UI.
- `web/` – React dashboard served at `http://<pi>:1880/ui` (look and layout of the old dashboard).
- `docs/LEGACY_BEHAVIOR.md` – **the parity contract**: everything the old flow did, and every
  deliberate change. Read this before changing behavior.
- `legacy/` – the original flow and SETUP page, used by the parity tests.
- `deploy/` – systemd service, install and self-update scripts; `deploy/kiosk/` local-display launcher.
- `dashboard/` – lightweight Tkinter display for low-memory Pis (Pi Zero W).
- `image/` + `.github/workflows/build-images.yml` – SD card images built with pi-gen:
  - `tiltpi-desktop-arm64`: Raspberry Pi OS trixie with desktop, 64-bit (Pi 3 and newer), Node.js from Debian.
  - `tiltpi-lite-armhf`: Raspberry Pi OS (Legacy) bookworm Lite, 32-bit (Pi Zero W and newer), Node.js 18.20.8
    ARMv6 build from unofficial-builds.nodejs.org (the version the Node-RED Tilt Pi ran on the Pi Zero W).
  The server runs on Node.js 18 or newer.

## Develop (any OS)
```
cd server && npm install && npm test      # parity tests run the original Node-RED code
npm run dev                               # mock Tilts, dry-run system commands, no real cloud posts
cd ../web && npm install && npm run build # or `npm run dev` for hot reload (proxies to :1880)
```
Open http://localhost:1880/ui.

## Code map
| Concern | File |
|---|---|
| Wiring / UI commands | `server/src/app.js` |
| Decode iBeacon | `server/src/tilt/ibeacon.js` |
| Reading pipeline | `server/src/tilt/{enrich,smoothing,calibration,readings}.js` |
| Cloud / CSV logging | `server/src/logging/` |
| Settings + legacy import | `server/src/settings.js` |
| OS integration | `server/src/system/` |
| Dashboard tabs | `web/src/tabs/` |
