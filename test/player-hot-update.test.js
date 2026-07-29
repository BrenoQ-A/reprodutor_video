'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

test('aplica playlist nova após o vídeo sem recarregar a página', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
  const elements = {};
  const timers = new Map();
  let timerId = 0;
  let reloadCount = 0;
  let playlistResponse = {
    updatedAt: 'v1',
    items: [
      { id: 'a', name: 'A.mp4', type: 'video', url: 'https://r2.example/A.mp4' }
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

  const document = {
    getElementById(id) { return elements[id]; },
    addEventListener() {},
    removeEventListener() {},
    createElement(tagName) {
      const element = fakeElement(tagName);
      if (tagName === 'video' || tagName === 'audio') {
        element.play = function play() {};
        element.pause = function pause() {};
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
        configUrl: '',
        playlistCheckSeconds: 5
      };
    } else {
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
      innerWidth: 1920,
      innerHeight: 1080,
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
  const firstVideo = elements['stage-inner'].children[0];
  assert.equal(firstVideo.src, 'https://r2.example/A.mp4');

  playlistResponse = {
    updatedAt: 'v2',
    items: [
      { id: 'a', name: 'A.mp4', type: 'video', url: 'https://r2.example/A.mp4' },
      { id: 'b', name: 'B.mp4', type: 'video', url: 'https://r2.example/B.mp4' }
    ]
  };
  const refresh = Array.from(timers.entries()).find((entry) => entry[1].delay === 5000);
  assert.ok(refresh, 'a verificação da playlist deve estar agendada');
  timers.delete(refresh[0]);
  refresh[1].callback();

  assert.equal(
    elements.hud.innerHTML.indexOf('NOVO CONTEÚDO') >= 0,
    true,
    'o player deve avisar que há conteúdo pendente'
  );
  firstVideo.onended();

  const secondVideo = elements['stage-inner'].children[0];
  assert.equal(secondVideo.src, 'https://r2.example/B.mp4');
  assert.equal(reloadCount, 0);
});
