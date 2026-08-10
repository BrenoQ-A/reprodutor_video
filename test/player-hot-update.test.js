'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];

function fakeElement(tagName) {
  let rawHtml = '';
  return {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    style: {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    get innerHTML() {
      return this.children.length ? '<media>' : rawHtml;
    },
    set innerHTML(value) {
      rawHtml = String(value);
      if (rawHtml === '') { this.children = []; }
    }
  };
}

function createPlayer(options) {
  const opts = options || {};
  const elements = {};
  const timers = new Map();
  const windowListeners = {};
  let timerId = 0;
  let reloadCount = 0;
  let playlistRequestCount = 0;
  let playlistResponse = opts.playlist || {
    updatedAt: 'v1',
    items: [
      {
        id: 'a',
        name: 'A.mp4',
        type: 'video',
        url: 'https://r2.example/A.mp4',
        durationSeconds: 60
      }
    ]
  };

  [
    'stage-outer',
    'stage-inner',
    'message',
    'message-title',
    'message-text',
    'progress-bar',
    'hud'
  ].forEach((id) => { elements[id] = fakeElement('div'); });

  const body = fakeElement('body');
  body.clientWidth = opts.width || 1280;
  body.clientHeight = opts.height || 720;

  const document = {
    body,
    documentElement: {
      clientWidth: opts.width || 1280,
      clientHeight: opts.height || 720
    },
    getElementById(id) { return elements[id]; },
    addEventListener() {},
    removeEventListener() {},
    createElement(tagName) {
      const element = fakeElement(tagName);
      if (tagName === 'video' || tagName === 'audio') {
        element.currentTime = 0;
        element.duration = 60;
        element.videoWidth = 0;
        element.videoHeight = 0;
        element.paused = false;
        element.ended = false;
        element.seeking = false;
        element.play = function play() { this.paused = false; };
        element.pause = function pause() { this.paused = true; };
        element.load = function load() {};
      }
      return element;
    }
  };

  function FakeXmlHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
  }
  FakeXmlHttpRequest.prototype.open = function open(method, url) {
    this.url = url;
  };
  FakeXmlHttpRequest.prototype.send = function send() {
    let response;
    if (this.url.indexOf('player-config.json') !== -1) {
      response = {
        playlistUrl: 'https://r2.example/playlist.json',
        configUrl: opts.runtimeConfig ? 'https://r2.example/config.json' : '',
        playlistCheckSeconds: 5
      };
    } else if (this.url.indexOf('config.json') !== -1) {
      response = opts.runtimeConfig;
    } else {
      playlistRequestCount += 1;
      response = playlistResponse;
    }
    this.readyState = 4;
    this.status = 200;
    this.responseText = JSON.stringify(response);
    this.onreadystatechange();
  };

  const sandbox = {
    document,
    XMLHttpRequest: FakeXmlHttpRequest,
    window: {
      innerWidth: opts.width || 1280,
      innerHeight: opts.height || 720,
      addEventListener(name, callback) { windowListeners[name] = callback; },
      location: {
        reload() { reloadCount += 1; }
      }
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

  vm.runInNewContext(script, sandbox);

  function runTimer(delay) {
    const timer = Array.from(timers.entries()).find((entry) => entry[1].delay === delay);
    assert.ok(timer, 'temporizador de ' + delay + 'ms deve existir');
    timers.delete(timer[0]);
    timer[1].callback();
  }

  return {
    elements,
    timers,
    windowListeners,
    runTimer,
    setPlaylist(value) { playlistResponse = value; },
    get reloadCount() { return reloadCount; },
    get playlistRequestCount() { return playlistRequestCount; }
  };
}

test('preenche a tela mesmo quando a TV informa as dimensões do vídeo tardiamente', () => {
  const player = createPlayer({ width: 1280, height: 720 });
  const video = player.elements['stage-inner'].children[0];

  assert.match(html, /name="viewport" content="width=1280, user-scalable=no"/);
  assert.equal(video.style.width, '1280px');
  assert.equal(video.style.height, '720px');

  video.onloadedmetadata();
  video.videoWidth = 960;
  video.videoHeight = 540;
  video.onloadeddata();

  assert.equal(video.style.width, '1280px');
  assert.equal(video.style.height, '720px');
});

test('consulta e aplica a playlist nova somente após o vídeo atual', () => {
  const player = createPlayer();
  const firstVideo = player.elements['stage-inner'].children[0];

  assert.equal(firstVideo.src, 'https://r2.example/A.mp4');
  assert.equal(player.playlistRequestCount, 1);
  assert.equal(
    Array.from(player.timers.values()).some((timer) => timer.delay === 5000),
    false,
    'não deve consultar a playlist durante a reprodução'
  );

  player.setPlaylist({
    updatedAt: 'v2',
    items: [
      { id: 'a', name: 'A.mp4', type: 'video', url: 'https://r2.example/A.mp4' },
      { id: 'b', name: 'B.mp4', type: 'video', url: 'https://r2.example/B.mp4' }
    ]
  });
  firstVideo.onended();

  const secondVideo = player.elements['stage-inner'].children[0];
  assert.equal(player.playlistRequestCount, 2);
  assert.equal(secondVideo.src, 'https://r2.example/B.mp4');
  assert.equal(player.reloadCount, 0);
});

test('adia a recarga de manutenção até o término da mídia', () => {
  const player = createPlayer();
  const video = player.elements['stage-inner'].children[0];

  player.runTimer(6 * 60 * 60 * 1000);
  assert.equal(player.reloadCount, 0);
  assert.match(player.elements.hud.innerHTML, /MANUTENÇÃO PENDENTE/);

  video.onended();
  assert.equal(player.reloadCount, 1);
});

test('retoma próximo ao ponto anterior quando o vídeo para de avançar', () => {
  const player = createPlayer();
  const firstVideo = player.elements['stage-inner'].children[0];

  firstVideo.currentTime = 30;
  firstVideo.paused = false;
  firstVideo.onplaying();
  player.runTimer(20000);

  assert.match(player.elements['message-title'].innerHTML, /Reconectando vídeo/);
  assert.equal(firstVideo.paused, true, 'a conexão anterior deve ser encerrada');
  player.runTimer(2000);

  const retriedVideo = player.elements['stage-inner'].children[0];
  retriedVideo.videoWidth = 960;
  retriedVideo.videoHeight = 540;
  retriedVideo.onloadedmetadata();

  assert.equal(retriedVideo.src, 'https://r2.example/A.mp4');
  assert.equal(retriedVideo.currentTime, 27);
  assert.equal(player.reloadCount, 0);
});
