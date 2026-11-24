// BT Stability Fix: config.txt gets / loses the krnbt_baudrate block (bookworm and later).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withBtStabilityFix, BT_FIX_LINE, BT_FIX_MARK } from '../src/system/system.js';

// Raspberry Pi OS bookworm config.txt (from a Tilt Pi), ending in a conditional section.
const STOCK = `dtparam=audio=on
camera_auto_detect=1
display_auto_detect=1
auto_initramfs=1
dtoverlay=vc4-kms-v3d
max_framebuffers=2
disable_fw_kms_setup=1
disable_overscan=1
arm_boost=1

[cm4]
otg_mode=1

[cm5]
dtoverlay=dwc2,dr_mode=host

[all]
`;

test('fix adds the krnbt_baudrate line under its own [all] at the end', () => {
  const out = withBtStabilityFix(STOCK, true);
  assert.ok(out.startsWith(STOCK.trimEnd()), 'existing lines unchanged');
  assert.ok(out.endsWith(`\n[all]\n${BT_FIX_MARK}\n${BT_FIX_LINE}\n`));
  assert.equal(out.match(/krnbt_baudrate/g).length, 1);
});

test('fix twice = once; revert restores the original file', () => {
  const once = withBtStabilityFix(STOCK, true);
  assert.equal(withBtStabilityFix(once, true), once);
  assert.equal(withBtStabilityFix(once, false), STOCK);
  assert.equal(withBtStabilityFix(STOCK, false), STOCK); // revert when not applied: no change
});

test('revert also removes a krnbt_baudrate line added by hand; CRLF files work', () => {
  const hand = STOCK + 'dtparam=krnbt_baudrate=460800\n';
  assert.equal(withBtStabilityFix(hand, false), STOCK);
  const crlf = withBtStabilityFix(STOCK, true).replace(/\n/g, '\r\n');
  assert.equal(withBtStabilityFix(crlf, false), STOCK);
});

test('a file without a trailing newline gets one', () => {
  assert.equal(withBtStabilityFix('dtparam=audio=on', false), 'dtparam=audio=on\n');
  assert.ok(withBtStabilityFix('dtparam=audio=on', true).startsWith('dtparam=audio=on\n\n[all]\n'));
});
