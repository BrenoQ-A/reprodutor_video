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

test('staging usa configuração e playlist locais', () => {
  const bootstrap = readJson('staging/player-config.json');

  assert.equal(bootstrap.playlistUrl, 'playlist.json');
  assert.equal(bootstrap.configUrl, 'config.json');
  assert.equal(String(bootstrap.playlistUrl).includes('r2.dev'), false);
  assert.equal(String(bootstrap.configUrl).includes('r2.dev'), false);
});

test('playlist de staging começa vazia e não replica produção', () => {
  const playlist = readJson('staging/playlist.json');
  const productionBootstrap = readJson('player-config.json');

  assert.ok(Array.isArray(playlist.items));
  assert.equal(playlist.items.length, 0);
  assert.notEqual(productionBootstrap.playlistUrl, 'staging/playlist.json');
  assert.notEqual(productionBootstrap.configUrl, 'staging/config.json');
});

test('entradas de staging reutilizam o código dos players sem alterá-lo', () => {
  const mainLoader = read('staging/index.html');
  const legacyLoader = read('staging/legacy.html');

  assert.match(mainLoader, /\.\.\/index\.html\?t=/);
  assert.match(legacyLoader, /\.\.\/legacy\.html\?t=/);
  assert.match(mainLoader, /document\.write\(xhr\.responseText\)/);
  assert.match(legacyLoader, /document\.write\(xhr\.responseText\)/);
});

test('arquivos essenciais do staging existem', () => {
  [
    'index.html',
    'legacy.html',
    'player-config.json',
    'config.json',
    'playlist.json',
    'README.md'
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(staging, name)), true, name + ' ausente');
  });
});
