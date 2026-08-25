import test from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  inferContentType,
  normalizeKey,
  validRangeSyntax
} from '../src/index.js';

function fakeObject(options = {}) {
  const bodyText = options.bodyText || 'abcdefghij';
  return {
    body: bodyText,
    size: options.size ?? 10,
    range: options.range,
    httpEtag: '"etag-123"',
    uploaded: new Date('2026-08-25T12:00:00Z'),
    writeHttpMetadata(headers) {
      headers.set('Content-Type', options.contentType || 'video/mp4');
      headers.set('Cache-Control', options.cacheControl || 'public, max-age=3600');
    }
  };
}

function fakeEnv() {
  return {
    ALLOWED_ORIGINS: 'https://brenoq-a.github.io',
    MEDIA_BUCKET: {
      async head(key) {
        if (key === 'missing.mp4') { return null; }
        return fakeObject();
      },
      async get(key, options) {
        if (key === 'missing.mp4') { return null; }
        if (options && options.range) {
          return fakeObject({ bodyText: 'cdef', range: { offset: 2, length: 4 } });
        }
        return fakeObject();
      }
    }
  };
}

test('normaliza chaves e rejeita travessia', () => {
  assert.equal(normalizeKey('/media/video.mp4'), 'media/video.mp4');
  assert.equal(normalizeKey('/media%2Fvideo.mp4'), 'media/video.mp4');
  assert.equal(normalizeKey('/../video.mp4'), null);
  assert.equal(normalizeKey('/media//video.mp4'), null);
});

test('valida ranges HTTP simples', () => {
  assert.equal(validRangeSyntax('bytes=0-999'), true);
  assert.equal(validRangeSyntax('bytes=500-'), true);
  assert.equal(validRangeSyntax('bytes=-500'), true);
  assert.equal(validRangeSyntax('bytes=999-100'), false);
  assert.equal(validRangeSyntax('bytes=0-1,4-5'), false);
  assert.equal(validRangeSyntax('bytes=-0'), false);
});

test('infere tipos de conteúdo conhecidos', () => {
  assert.equal(inferContentType('media/a.mp4'), 'video/mp4');
  assert.equal(inferContentType('playlist.json'), 'application/json; charset=utf-8');
  assert.equal(inferContentType('image.png'), 'image/png');
});

test('GET completo retorna metadados para streaming', async () => {
  const request = new Request('https://gateway.example/media/video.mp4', {
    headers: { Origin: 'https://brenoq-a.github.io' }
  });
  const response = await worker.fetch(request, fakeEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Length'), '10');
  assert.equal(response.headers.get('ETag'), '"etag-123"');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://brenoq-a.github.io');
});

test('GET com Range retorna 206 e Content-Range', async () => {
  const request = new Request('https://gateway.example/media/video.mp4', {
    headers: {
      Origin: 'https://brenoq-a.github.io',
      Range: 'bytes=2-5'
    }
  });
  const response = await worker.fetch(request, fakeEnv());

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('Content-Length'), '4');
});

test('HEAD retorna metadados sem corpo', async () => {
  const request = new Request('https://gateway.example/media/video.mp4', { method: 'HEAD' });
  const response = await worker.fetch(request, fakeEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '10');
  assert.equal(await response.text(), '');
});

test('OPTIONS responde CORS sem tocar no bucket', async () => {
  const request = new Request('https://gateway.example/media/video.mp4', {
    method: 'OPTIONS',
    headers: { Origin: 'https://brenoq-a.github.io' }
  });
  const response = await worker.fetch(request, fakeEnv());

  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Range/);
});

test('origem desconhecida é bloqueada', async () => {
  const request = new Request('https://gateway.example/media/video.mp4', {
    headers: { Origin: 'https://example.invalid' }
  });
  const response = await worker.fetch(request, fakeEnv());
  assert.equal(response.status, 403);
});

test('objeto ausente retorna 404', async () => {
  const request = new Request('https://gateway.example/missing.mp4');
  const response = await worker.fetch(request, fakeEnv());
  assert.equal(response.status, 404);
});
