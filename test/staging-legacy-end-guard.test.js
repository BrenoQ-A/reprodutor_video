'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'staging', 'legacy.html'), 'utf8');

test('staging legacy injeta guarda para WebKit que para no fim do vídeo', () => {
  assert.match(html, /pausedEndTicks/);
  assert.match(html, /video\.ended/);
  assert.match(html, /typeof video\.onended===\"function\"/);
  assert.match(html, /setInterval\(tick,1000\)/);
});

test('fallback exige fim real ou vídeo pausado junto ao limite', () => {
  assert.match(html, /duration-0\.75/);
  assert.match(html, /pausedEndTicks>=2/);
});
