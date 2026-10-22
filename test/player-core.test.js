'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'player-core.js'), 'utf8');

function createCore(fetchPlan, options) {
  const opts = options || {};
  const timers = new Map();
  let timerId = 0;
  let fetchIndex = 0;

  function FakeXmlHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
  }
  FakeXmlHttpRequest.prototype.open = function open(method, url) {
    this.url = url;
  };
  FakeXmlHttpRequest.prototype.send = function send() {
    const plan = fetchPlan[fetchIndex];
    fetchIndex += 1;
    if (!plan) { throw new Error('requisição inesperada: ' + this.url); }
    this.readyState = 4;
    if (plan.status === undefined) { plan.status = 200; }
    this.status = plan.status;
    this.responseText = plan.body !== undefined ? plan.body : JSON.stringify(plan.data || {});
    this.onreadystatechange();
  };

  const sandbox = {
    XMLHttpRequest: FakeXmlHttpRequest,
    window: {
      location: { search: opts.search || '' }
    },
    setTimeout(callback, delay) {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 1; },
    clearInterval() {}
  };

  vm.runInNewContext(coreSource, sandbox);

  return {
    core: sandbox.PlayerCore,
    timers,
    fetchIndex,
    runTimersWithDelay(delay) {
      Array.from(timers.entries())
        .filter((entry) => entry[1].delay === delay)
        .forEach((entry) => {
          timers.delete(entry[0]);
          entry[1].callback();
        });
    }
  };
}

const BOOTSTRAP = {
  playlistUrl: 'https://media.example/playlist.json',
  devicesUrl: 'https://media.example/devices.json',
  configUrl: '',
  playlistCheckSeconds: 60
};

test('escapeHtml neutraliza HTML perigoso', () => {
  const { core } = createCore([]);
  assert.equal(
    core.escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(core.escapeHtml('Clean-01.mp4'), 'Clean-01.mp4');
  assert.equal(core.escapeHtml(null), '');
});

test('normalizePlaylist deduplica por contentHash, assinatura legada e URL', () => {
  const { core } = createCore([]);
  const normalized = core.normalizePlaylist({
    items: [
      { id: '1', name: 'A.mp4', type: 'video', url: 'https://m/A.mp4', contentHash: 'h1' },
      { id: '2', name: 'A.mp4', type: 'video', url: 'https://m/A-copy.mp4', contentHash: 'h1' },
      { id: '3', name: 'B.mp4', type: 'video', url: 'https://m/B.mp4', sizeBytes: 10, durationSeconds: 5 },
      { id: '4', name: 'B.mp4', type: 'video', url: 'https://m/B-copy.mp4', sizeBytes: 10, durationSeconds: 5 },
      { id: '5', name: 'C.png', type: 'image', url: 'https://m/C.png' },
      { id: '6', name: 'C-copy.png', type: 'image', url: 'https://m/C.png' }
    ]
  });

  assert.equal(normalized.length, 3);
  assert.deepEqual(Array.from(normalized, (item) => item.id), ['1', '3', '5']);
});

test('normalizePlaylist descarta itens sem URL, sem nome ou tipo desconhecido', () => {
  const { core } = createCore([]);
  const normalized = core.normalizePlaylist({
    items: [
      { id: 'x', name: 'sem-url.mp4', type: 'video' },
      { id: 'y', url: 'https://m/y.mp4', type: 'video' },
      { id: 'z', name: 'doc.txt', type: 'other', url: 'https://m/doc.txt' },
      { id: 'w', name: 'Vídeo Valid.mp4', type: 'video', url: 'https://m/w.mp4' }
    ]
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, 'Vídeo Valid.mp4');
});

test('resolveDevice sem ?device= usa a playlist global', () => {
  const { core } = createCore([]);
  let result = null;
  core.resolveDevice({
    deviceId: '',
    bootstrap: BOOTSTRAP,
    notify() {},
    onFatal() {},
    onReady(value) { result = value; }
  });
  assert.equal(result.mode, 'global');
  assert.deepEqual(Array.from(result.urls), [BOOTSTRAP.playlistUrl]);
});

test('resolveDevice com TV em modo misto junta playlist global e da TV', () => {
  const registry = {
    devices: [{ id: 'tv-01', playlistMode: 'mixed' }]
  };
  const { core } = createCore([{ data: registry }]);
  let result = null;
  core.resolveDevice({
    deviceId: 'tv-01',
    bootstrap: BOOTSTRAP,
    notify() {},
    onFatal() {},
    onReady(value) { result = value; }
  });
  assert.equal(result.mode, 'mixed');
  assert.deepEqual(Array.from(result.urls), [
    BOOTSTRAP.playlistUrl,
    'https://media.example/devices/tv-01/playlist.json'
  ]);
});

test('resolveDevice sem devicesUrl configurado termina em erro permanente', () => {
  const { core } = createCore([]);
  const calls = { fatal: 0, ready: 0 };
  core.resolveDevice({
    deviceId: 'tv-01',
    bootstrap: { playlistUrl: 'https://m/playlist.json', devicesUrl: '' },
    notify() {},
    onFatal() { calls.fatal += 1; },
    onReady() { calls.ready += 1; }
  });
  assert.equal(calls.fatal, 1);
  assert.equal(calls.ready, 0);
});

test('fetchActivePlaylist mescla fontes no modo misto e monta revisão', () => {
  const { core } = createCore([
    { data: { devices: [{ id: 'tv-01', playlistMode: 'mixed' }] } },
    { data: { updatedAt: 'v1', items: [{ id: 'a', name: 'A.mp4', type: 'video', url: 'https://m/A.mp4' }] } },
    { data: { updatedAt: 'd1', items: [{ id: 'b', name: 'B.mp4', type: 'video', url: 'https://m/B.mp4' }] } }
  ]);

  let result = null;
  core.fetchActivePlaylist({
    deviceId: 'tv-01',
    bootstrap: BOOTSTRAP,
    urls: [BOOTSTRAP.playlistUrl],
    mode: 'global',
    onSuccess(value) { result = value; },
    onError() { result = { error: true }; }
  });

  assert.equal(result.updatedAt, 'mixed|v1|d1');
  assert.deepEqual(Array.from(result.items, (item) => item.id), ['a', 'b']);
});

test('fetchActivePlaylist sem TV cadastrapa cai de volta para as URLs conhecidas', () => {
  const { core } = createCore([
    { status: 404, body: 'not found' },
    { data: { updatedAt: 'v9', items: [{ id: 'a', name: 'A.mp4', type: 'video', url: 'https://m/A.mp4' }] } }
  ]);

  let result = null;
  core.fetchActivePlaylist({
    deviceId: 'tv-sumiu',
    bootstrap: BOOTSTRAP,
    urls: [BOOTSTRAP.playlistUrl],
    mode: 'global',
    onSuccess(value) { result = value; },
    onError() { result = { error: true }; }
  });

  assert.equal(result.updatedAt, 'global|v9');
  assert.equal(result.items.length, 1);
});

test('revisionOf usa updatedAt quando existe e assinatura própria quando não', () => {
  const { core } = createCore([]);
  const normalized = [
    { id: 'a', name: 'A.mp4', url: 'https://m/A.mp4' },
    { id: 'b', name: 'B.mp4', url: 'https://m/B.mp4' }
  ];
  assert.equal(core.revisionOf({ updatedAt: 'v2' }, normalized), 'v2');
  assert.equal(
    core.revisionOf({}, normalized),
    'a|https://m/A.mp4||b|https://m/B.mp4'
  );
});
