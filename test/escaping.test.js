'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('player principal escapa o identificador da TV antes do innerHTML', () => {
  const html = read('index.html');
  const core = read('player-core.js');

  assert.match(core, /function escapeHtml\(value\)/);
  assert.match(
    html,
    /PlayerCore\.escapeHtml\(deviceId\) \+ '  '/,
    'HUD deve escapar o identificador da TV'
  );
  assert.doesNotMatch(
    html,
    /'<code>' \+ deviceId \+ '<\/code>'/,
    'identificador bruto não pode ser concatenado em HTML'
  );
});

test('player principal escapa o nome do arquivo em mensagens de falha', () => {
  const html = read('index.html');

  assert.match(
    html,
    /'Último arquivo: <code>' \+ PlayerCore\.escapeHtml\(item\.name\) \+ '<\/code><br>'/
  );
});

test('players legado e leve escapam o nome da mídia ao carregar', () => {
  const legacy = read('legacy.html');
  const light = read('plsz.html');

  assert.match(legacy, /PlayerCore\.escapeHtml\(item\.name\) \|\| 'Vídeo'/);
  assert.match(light, /PlayerCore\.escapeHtml\(it\.name\) ?\|\| ?'Vídeo'/);
});

test('escapeHtml cobre os caracteres perigosos de HTML', () => {
  const core = read('player-core.js');
  const match = core.match(/function escapeHtml\(value\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, 'função escapeHtml deve existir no player-core.js');

  const escapeHtml = new Function(
    'value',
    match[1].replace(/return text/, 'var result = text') + '; return result;'
  );
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('A & B "C" \'D\''), 'A &amp; B &quot;C&quot; &#39;D&#39;');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
});
