'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'legacy.html'), 'utf8');

test('player legado possui reload de segurança após falhas consecutivas', () => {
  assert.match(html, /var MAX_RECOVERY_ATTEMPTS = 3;/);
  assert.match(html, /function recoverFromWatchdog\(detail\)/);
  assert.match(html, /scheduleSafeReload\(detail\)/);
  assert.match(html, /window\.location\.reload\(\)/);
});

test('reload de segurança possui proteção contra loop rápido', () => {
  assert.match(html, /var RELOAD_WINDOW_MS = 60000;/);
  assert.match(html, /var MAX_RELOADS_PER_WINDOW = 2;/);
  assert.match(html, /legacyReloadWindowStart/);
  assert.match(html, /legacyReloadCount/);
});

test('watchdog continua tratando progresso e loop nativo como atividade válida', () => {
  assert.match(html, /currentTime > lastVideoTime \+ 0\.2 \|\| currentTime < lastVideoTime - 1/);
  assert.match(html, /notePlaybackProgress\(now\)/);
  assert.match(html, /setInterval\(watchdogTick, STALL_CHECK_MS\)/);
});
