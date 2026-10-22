'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('cópia de player-core.js no staging é idêntica à raiz', () => {
  const rootCore = fs.readFileSync(path.join(root, 'player-core.js'), 'utf8');
  const stagingCore = fs.readFileSync(path.join(root, 'staging', 'player-core.js'), 'utf8');

  assert.equal(stagingCore, rootCore);
});

test('players referenciam player-core.js antes do script inline', () => {
  ['index.html', 'legacy.html', 'plsz.html'].forEach((name) => {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    const coreTag = html.indexOf('<script src="player-core.js"></script>');
    const firstInline = html.indexOf('<script>', coreTag === -1 ? 0 : coreTag);
    const anyInline = html.search(/<script>/);

    assert.notEqual(coreTag, -1, name + ' deve carregar player-core.js');
    assert.notEqual(anyInline, -1, name + ' deve ter script inline');
    assert.ok(
      coreTag < anyInline,
      name + ' deve carregar o núcleo antes do script inline'
    );
    assert.notEqual(firstInline, -1);
  });
});

test('staging reutiliza os mesmos players e o núcleo compartilhado', () => {
  const stagingLoader = fs.readFileSync(path.join(root, 'staging', 'index.html'), 'utf8');

  assert.match(stagingLoader, /\.\.\/index\.html\?t=/);
});
