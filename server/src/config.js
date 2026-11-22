// Runtime configuration. Everything can be overridden with environment variables so the same
// code runs on a Raspberry Pi (defaults) and on a development machine (see server/dev.env).
import path from 'node:path';

const env = process.env;
const here = import.meta.dirname;

export const config = {
  port: Number(env.TILTPI_PORT || 1880),
  // Directory holding settings.json, log.csv and the legacy global.json / <COLOR>.json backups.
  dataDir: path.resolve(env.TILTPI_DATA_DIR || '/home/pi'),
  // Boot partition where SETUP.html provisioning files (wpa_supplicant.conf, cloud_log_*.json) land.
  bootDir: path.resolve(env.TILTPI_BOOT_DIR || '/boot/firmware'),
  // 'noble' (real Bluetooth) or 'mock' (simulated Tilts for development).
  scanner: env.TILTPI_SCANNER || 'noble',
  // When true, privileged system commands (reboot, date -s, raspi-config...) are logged, not run.
  dryRun: env.TILTPI_DRY_RUN === '1',
  // Built React app.
  webDir: path.resolve(env.TILTPI_WEB_DIR || path.join(here, '../../web/dist')),
  // Repository used by "Update App" and the latest-release check.
  repo: env.TILTPI_REPO || 'baronbrew/TILTpi-v3',
  // Directory of the git checkout that "Update App" updates.
  appDir: path.resolve(env.TILTPI_APP_DIR || path.join(here, '../..')),
  // Linux user that owns the data files and the USB mount.
  user: env.TILTPI_USER || 'pi',
};
