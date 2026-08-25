const DEFAULT_ALLOWED_ORIGINS = ['https://brenoq-a.github.io'];

function allowedOrigins(env) {
  const configured = String(env && env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function requestOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) { return true; }
  const allowed = allowedOrigins(env);
  return allowed.includes('*') || allowed.includes(origin);
}

function applyCors(headers, request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    headers.set('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Modified-Since');
  headers.set(
    'Access-Control-Expose-Headers',
    'ETag, Content-Length, Content-Range, Accept-Ranges, Last-Modified'
  );
}

function normalizeKey(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathname || ''));
  } catch (error) {
    return null;
  }
  const key = decoded.replace(/^\/+/, '');
  if (!key || key.includes('\u0000')) { return null; }
  const segments = key.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || !segment)) {
    return null;
  }
  return key;
}

function encodeKeyForUrl(key) {
  return String(key || '').split('/').map(encodeURIComponent).join('/');
}

function isPlaylistKey(key) {
  return key === 'playlist.json' || key === 'playlist-staging.json';
}

function validRangeSyntax(value) {
  if (!value) { return true; }
  if (value.includes(',')) { return false; }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) { return false; }
  if (match[1] && match[2] && Number(match[2]) < Number(match[1])) { return false; }
  if (!match[1] && Number(match[2]) <= 0) { return false; }
  return true;
}

function inferContentType(key) {
  const lower = String(key || '').toLowerCase();
  if (lower.endsWith('.mp4')) { return 'video/mp4'; }
  if (lower.endsWith('.webm')) { return 'video/webm'; }
  if (lower.endsWith('.mp3')) { return 'audio/mpeg'; }
  if (lower.endsWith('.m4a')) { return 'audio/mp4'; }
  if (lower.endsWith('.aac')) { return 'audio/aac'; }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) { return 'image/jpeg'; }
  if (lower.endsWith('.png')) { return 'image/png'; }
  if (lower.endsWith('.json')) { return 'application/json; charset=utf-8'; }
  return 'application/octet-stream';
}

function defaultCacheControl(key) {
  return String(key || '').toLowerCase().endsWith('.json')
    ? 'no-cache'
    : 'public, max-age=3600';
}

function objectHeaders(object, key, request, env) {
  const headers = new Headers();
  if (object && typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', inferContentType(key));
  }
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', defaultCacheControl(key));
  }
  if (object && object.httpEtag) {
    headers.set('ETag', object.httpEtag);
  }
  if (object && object.uploaded instanceof Date) {
    headers.set('Last-Modified', object.uploaded.toUTCString());
  }
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  const range = object && object.range;
  if (range && Number.isFinite(range.offset) && Number.isFinite(range.length)) {
    const start = range.offset;
    const end = start + Math.max(0, range.length - 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
    headers.set('Content-Length', String(range.length));
  } else if (object && Number.isFinite(object.size)) {
    headers.set('Content-Length', String(object.size));
  }

  applyCors(headers, request, env);
  return headers;
}

function simpleResponse(body, status, request, env, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  applyCors(headers, request, env);
  return new Response(body, { status, headers });
}

async function rewritePlaylistResponse(object, key, request, env) {
  const text = await new Response(object.body).text();
  const playlist = JSON.parse(text);
  const items = playlist && Array.isArray(playlist.items) ? playlist.items : [];
  const baseUrl = new URL(request.url);

  items.forEach((item) => {
    if (!item || !item.key) { return; }
    const safeKey = normalizeKey('/' + item.key);
    if (!safeKey) { return; }
    item.url = new URL('/' + encodeKeyForUrl(safeKey), baseUrl).toString();
  });

  const body = JSON.stringify(playlist, null, 2) + '\n';
  const headers = objectHeaders(object, key, request, env);
  headers.delete('ETag');
  headers.delete('Content-Range');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  return new Response(body, { status: 200, headers });
}

async function handleObject(request, env) {
  if (!requestOriginAllowed(request, env)) {
    return simpleResponse('Origem não autorizada.', 403, request, env);
  }

  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return simpleResponse(
      JSON.stringify({ ok: true, service: 'player-midia-gateway' }),
      200,
      request,
      env,
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    );
  }

  if (request.method === 'OPTIONS') {
    return simpleResponse(null, 204, request, env, { 'Access-Control-Max-Age': '86400' });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return simpleResponse('Método não permitido.', 405, request, env, { Allow: 'GET, HEAD, OPTIONS' });
  }

  const key = normalizeKey(url.pathname);
  if (!key) {
    return simpleResponse('Objeto inválido.', 400, request, env);
  }

  if (request.method === 'HEAD') {
    const metadata = await env.MEDIA_BUCKET.head(key);
    if (!metadata) {
      return simpleResponse('Não encontrado.', 404, request, env);
    }
    return new Response(null, {
      status: 200,
      headers: objectHeaders(metadata, key, request, env)
    });
  }

  const rangeHeader = request.headers.get('Range');
  if (!validRangeSyntax(rangeHeader)) {
    return simpleResponse('Range inválido.', 416, request, env, { 'Accept-Ranges': 'bytes' });
  }

  let object;
  try {
    object = await env.MEDIA_BUCKET.get(
      key,
      rangeHeader ? { range: new Headers({ Range: rangeHeader }) } : undefined
    );
  } catch (error) {
    if (rangeHeader) {
      return simpleResponse('Range não satisfazível.', 416, request, env, { 'Accept-Ranges': 'bytes' });
    }
    throw error;
  }

  if (!object) {
    return simpleResponse('Não encontrado.', 404, request, env);
  }

  if (!rangeHeader && isPlaylistKey(key)) {
    return rewritePlaylistResponse(object, key, request, env);
  }

  const headers = objectHeaders(object, key, request, env);
  const status = object.range ? 206 : 200;
  return new Response(object.body, { status, headers });
}

export default {
  async fetch(request, env) {
    try {
      return await handleObject(request, env);
    } catch (error) {
      console.error('Falha no gateway de mídia:', error);
      return simpleResponse('Falha interna do gateway.', 500, request, env, {
        'Cache-Control': 'no-store'
      });
    }
  }
};

export {
  allowedOrigins,
  applyCors,
  defaultCacheControl,
  encodeKeyForUrl,
  handleObject,
  inferContentType,
  isPlaylistKey,
  normalizeKey,
  objectHeaders,
  requestOriginAllowed,
  rewritePlaylistResponse,
  validRangeSyntax
};
