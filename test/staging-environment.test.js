'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'staging');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('staging usa objetos próprios no R2', () => {
  const bootstrap = readJson('staging/player-config.json');
  const productionBootstrap = readJson('player-config.json');

  assert.match(bootstrap.playlistUrl, /\/playlist-staging\.json$/);
  assert.match(bootstrap.configUrl, /\/config-staging\.json$/);
  assert.notEqual(bootstrap.playlistUrl, productionBootstrap.playlistUrl);
  assert.notEqual(bootstrap.configUrl, productionBootstrap.configUrl);
});

test('arquivos locais permanecem vazios como fallback seguro', () => {
  const playlist = readJson('staging/playlist.json');

  assert.ok(Array.isArray(playlist.items));
  assert.equal(playlist.items.length, 0);
});

test('entradas de staging reutilizam o código dos players sem alterá-lo', () => {
  const mainLoader = read('staging/index.html');
  const legacyLoader = read('staging/legacy.html');

  assert.match(mainLoader, /\.\.\/index\.html\?t=/);
  assert.match(legacyLoader, /\.\.\/legacy\.html\?t=/);
  assert.match(mainLoader, /document\.write\(xhr\.responseText\)/);
  assert.match(legacyLoader, /document\.write\(xhr\.responseText\)/);
});

test('painel de staging usa apenas endpoints de staging para conteúdo', () => {
  const admin = read('staging/admin.html');

  assert.match(admin, /\/api\/staging\/state/);
  assert.match(admin, /\/api\/staging\/media\/copy/);
  assert.match(admin, /\/api\/staging\/media\/sync-production/);
  assert.match(admin, /\/api\/staging\/config/);
  assert.doesNotMatch(admin, /\/api\/media\/upload/);
  assert.doesNotMatch(admin, /\/api\/media\/reorder/);
  assert.doesNotMatch(admin, /\/api\/config['"]/);
});

test('arquivos essenciais do staging existem', () => {
  [
    'index.html',
    'legacy.html',
    'admin.html',
    'player-config.json',
    'config.json',
    'playlist.json',
    'README.md'
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(staging, name)), true, name + ' ausente');
  });
});
