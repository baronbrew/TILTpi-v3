import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime, normalizeLocale, temperatureUnitFor } from '../src/locale.js';

const d = new Date(2026, 10, 22, 13, 44, 38); // local time 22 Nov 2026 13:44:38
const fmt = (locale) => formatDateTime(d, locale).replace(/\s/g, ' '); // ICU may use U+202F before PM

test('date format follows the locale', () => {
  assert.equal(fmt('en-US'), '11/22/2026, 1:44:38 PM');
  assert.equal(fmt('en-GB'), '22/11/2026, 13:44:38');
  assert.equal(fmt('de-DE'), '22.11.2026, 13:44:38');
});

test('always Latin digits (spreadsheets can read log.csv)', () => {
  assert.match(formatDateTime(d, 'ar-EG'), /2026/);
});

test("'' = system default, like legacy", () => {
  assert.equal(formatDateTime(d, ''), d.toLocaleString());
});

test('locale validation', () => {
  assert.equal(normalizeLocale('en-us'), 'en-US');
  assert.equal(normalizeLocale('not a locale!'), '');
  assert.equal(normalizeLocale(undefined), '');
});

test('temperature unit by country', () => {
  assert.equal(temperatureUnitFor('en-US'), '°F');
  assert.equal(temperatureUnitFor('en'), '°F'); // likely region US
  assert.equal(temperatureUnitFor('es-PR'), '°F');
  assert.equal(temperatureUnitFor('en-GB'), '°C');
  assert.equal(temperatureUnitFor('en-CA'), '°C');
  assert.equal(temperatureUnitFor('de-DE'), '°C');
  assert.equal(temperatureUnitFor(''), undefined);
});
