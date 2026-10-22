/*
  Núcleo compartilhado dos players de sinalização (index.html, legacy.html
  e plsz.html).

  Deliberadamente restrito a JavaScript ES5 e APIs clássicas de navegador
  (XMLHttpRequest, sem fetch/Promise), para compatibilidade com WebKit
  antigo de Smart TVs Samsung.

  Este arquivo concentra apenas a camada de dados e configuração:
  - utilidades puras (escape, extensão, query string, cache busting);
  - requisição JSON com timeout;
  - normalização e revisão de playlists;
  - cadastro de TVs (devices.json) e resolução das URLs de playlist;
  - consulta da(s) playlist(s) ativa(s), global ou por TV.

  A lógica de reprodução (renderização, enquadramento, watchdogs de vídeo,
  recuperação de falhas e mensagens de tela) permanece em cada player,
  porque cada um tem restrições e mecanismos de segurança próprios.

  Expõe o global `PlayerCore`. Serve tanto para <script src> nos players
  quanto para os testes (node:test + vm).
*/
var PlayerCore = (function () {
  'use strict';

  var IMAGE_EXT = ['jpg', 'jpeg', 'png'];
  var VIDEO_EXT = ['mp4'];

  function contains(array, value) {
    var i;
    for (i = 0; i < array.length; i++) {
      if (array[i] === value) { return true; }
    }
    return false;
  }

  function extOf(name) {
    var parts = String(name || '').split('.');
    if (parts.length < 2) { return ''; }
    return parts[parts.length - 1].toLowerCase();
  }

  function merge(target, source) {
    var key;
    if (!source) { return target; }
    for (key in source) {
      if (source.hasOwnProperty(key)) { target[key] = source[key]; }
    }
    return target;
  }

  /*
    Valores dinâmicos (identificador da TV, nomes de arquivo, erros) podem
    chegar ao innerHTML das mensagens. Todo texto que se origina de dado
    externo passa por escapeHtml antes de virar HTML.
  */
  function escapeHtml(value) {
    var text = String(value === null || value === undefined ? '' : value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cacheBust(url) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + new Date().getTime();
  }

  function queryParam(name) {
    var query = String(window.location.search || '').replace(/^\?/, '').split('&');
    var i;
    var pair;
    for (i = 0; i < query.length; i++) {
      pair = query[i].split('=');
      if (decodeURIComponent(pair[0] || '') === name) {
        return decodeURIComponent(String(pair.slice(1).join('=') || '').replace(/\+/g, ' '));
      }
    }
    return '';
  }

  function siblingUrl(url, path) {
    var clean = String(url || '').split('?')[0];
    return clean.replace(/[^/]*$/, path);
  }

  function requestJson(url, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', cacheBust(url), true);
    xhr.onreadystatechange = function () {
      var data;
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          data = JSON.parse(xhr.responseText);
          onSuccess(data);
        } catch (error) {
          onError('JSON inválido em ' + url);
        }
      } else {
        onError('HTTP ' + xhr.status + ' ao acessar ' + url);
      }
    };
    xhr.onerror = function () { onError('Falha de rede ao acessar ' + url); };
    xhr.timeout = 30000;
    xhr.ontimeout = function () { onError('Tempo esgotado ao acessar ' + url); };
    xhr.send();
  }

  function normalizePlaylist(data) {
    var source = data && data.items ? data.items : data;
    var result = [];
    var seen = {};
    var i;
    var item;
    var extension;
    var type;
    var signature;

    if (!source || typeof source.length !== 'number') { return result; }
    for (i = 0; i < source.length; i++) {
      item = source[i];
      if (!item || !item.url || !item.name) { continue; }
      extension = extOf(item.name);
      if (item.type === 'video' || contains(VIDEO_EXT, extension)) {
        type = 'video';
      } else if (item.type === 'image' || contains(IMAGE_EXT, extension)) {
        type = 'image';
      } else {
        continue;
      }

      signature = '';
      if (item.contentHash) {
        signature = 'hash|' + String(item.contentHash);
      } else if (Number(item.sizeBytes) > 0 && Number(item.durationSeconds) > 0) {
        signature = [
          'legacy',
          type,
          String(item.originalName || item.name).toLowerCase(),
          String(Number(item.sizeBytes)),
          String(Math.round(Number(item.durationSeconds) * 1000))
        ].join('|');
      } else {
        signature = 'url|' + String(item.url);
      }
      if (Object.prototype.hasOwnProperty.call(seen, signature)) { continue; }
      seen[signature] = true;

      result.push({
        id: item.id || item.key || item.name,
        name: item.name,
        url: item.url,
        type: type,
        durationSeconds: item.durationSeconds
      });
    }
    return result;
  }

  function revisionOf(data, normalized) {
    var parts = [];
    var i;
    if (data && data.updatedAt) { return String(data.updatedAt); }
    for (i = 0; i < normalized.length; i++) {
      parts.push(String(normalized[i].id || normalized[i].name) + '|' + String(normalized[i].url));
    }
    return parts.join('||');
  }

  function findDevice(registry, deviceId) {
    var i;
    for (i = 0; registry && registry.devices && i < registry.devices.length; i++) {
      if (String(registry.devices[i].id) === String(deviceId)) {
        return registry.devices[i];
      }
    }
    return null;
  }

  function deviceUrlsFor(bootstrap, deviceId, mode) {
    if (mode === 'individual') {
      return [siblingUrl(bootstrap.devicesUrl, 'devices/' + deviceId + '/playlist.json')];
    }
    if (mode === 'mixed') {
      return [
        bootstrap.playlistUrl,
        siblingUrl(bootstrap.devicesUrl, 'devices/' + deviceId + '/playlist.json')
      ];
    }
    return [bootstrap.playlistUrl];
  }

  /*
    Identifica a TV no devices.json e devolve as URLs de playlist ativas.

    options:
      deviceId  - valor do parâmetro ?device= (vazio = modo global);
      bootstrap - objeto com playlistUrl/devicesUrl de player-config.json;
      notify    - showMessage(title, text) do player, para status em tela;
      onReady   - callback({ mode, urls }) quando a TV foi identificada;
      onFatal   - callback(title, text) para erro de configuração permanente.
  */
  function resolveDevice(options) {
    var bootstrap = options.bootstrap;

    if (!options.deviceId) {
      options.onReady({ mode: 'global', urls: [bootstrap.playlistUrl] });
      return;
    }
    if (!bootstrap.devicesUrl) {
      options.onFatal(
        'Cadastro de TVs indisponível',
        'Preencha <code>devicesUrl</code> em <code>player-config.json</code>.'
      );
      return;
    }
    requestJson(bootstrap.devicesUrl, function (registry) {
      var device = findDevice(registry, options.deviceId);
      var mode;
      if (!device) {
        options.notify(
          'TV não cadastrada',
          'O identificador <code>' + escapeHtml(options.deviceId) + '</code> não existe no painel.'
        );
        return;
      }
      mode = device.playlistMode || 'global';
      options.onReady({ mode: mode, urls: deviceUrlsFor(bootstrap, options.deviceId, mode) });
    }, function () {
      options.notify('Aguardando rede', 'Não foi possível identificar esta TV.');
    });
  }

  /*
    Consulta a playlist ativa (global, individual ou mista). Quando há TV
    cadastrada, o devices.json é reconsultado antes para acompanhar trocas
    de modo; se essa consulta falhar, usa as URLs já conhecidas.

    options:
      deviceId, bootstrap - como em resolveDevice;
      urls, mode          - URLs/modo resolvidos no boot;
      onSuccess           - callback({ items, updatedAt });
      onError             - callback(mensagem).
  */
  function fetchActivePlaylist(options) {
    var bootstrap = options.bootstrap;

    function requestSources(urls, mode) {
      var pending = urls.length;
      var results = [];
      var failed = false;
      var i;
      if (!pending) { options.onError('Nenhuma playlist foi configurada.'); return; }
      function finish() {
        var items = [];
        var seen = {};
        var revisions = [];
        var source;
        var item;
        var signature;
        var x;
        var y;
        for (x = 0; x < results.length; x++) {
          source = results[x] && results[x].items ? results[x].items : results[x];
          revisions.push(results[x] && results[x].updatedAt ? results[x].updatedAt : '');
          for (y = 0; source && y < source.length; y++) {
            item = source[y];
            signature = String(item && (item.id || item.key || item.url || item.name));
            if (!seen[signature]) { seen[signature] = true; items.push(item); }
          }
        }
        options.onSuccess({ items: items, updatedAt: mode + '|' + revisions.join('|') });
      }
      for (i = 0; i < urls.length; i++) {
        (function (position) {
          requestJson(urls[position], function (data) {
            results[position] = data || { items: [] };
            pending -= 1;
            if (!pending && !failed) { finish(); }
          }, function (error) {
            if (failed) { return; }
            failed = true;
            options.onError(error);
          });
        })(i);
      }
    }

    if (options.deviceId && bootstrap.devicesUrl) {
      requestJson(bootstrap.devicesUrl, function (registry) {
        var device = findDevice(registry, options.deviceId);
        var mode;
        if (!device) { options.onError('A TV não está mais cadastrada.'); return; }
        mode = device.playlistMode || 'global';
        requestSources(deviceUrlsFor(bootstrap, options.deviceId, mode), mode);
      }, function () {
        requestSources(options.urls, options.mode);
      });
    } else {
      requestSources(options.urls, options.mode);
    }
  }

  /*
    Carrega player-config.json (bootstrap). Chamado uma vez no boot.
    options: { onReady(remoteBootstrap), onFatal(title, text) }
  */
  function loadBootstrap(options) {
    requestJson('player-config.json', function (remote) {
      options.onReady(remote);
    }, function () {
      options.onFatal('Configuração não encontrada', 'Não foi possível carregar player-config.json.');
    });
  }

  /*
    Mescla a configuração remota (configUrl) no objeto CONFIG do player.
    Falhas de rede são ignoradas: o player segue com os valores padrão.
    options: { configUrl, config, onDone() }
  */
  function loadRuntimeConfig(options) {
    if (!options.configUrl) { options.onDone(); return; }
    requestJson(options.configUrl, function (remote) {
      merge(options.config, remote);
      options.onDone();
    }, function () {
      options.onDone();
    });
  }

  return {
    contains: contains,
    extOf: extOf,
    merge: merge,
    escapeHtml: escapeHtml,
    cacheBust: cacheBust,
    queryParam: queryParam,
    siblingUrl: siblingUrl,
    requestJson: requestJson,
    normalizePlaylist: normalizePlaylist,
    revisionOf: revisionOf,
    findDevice: findDevice,
    deviceUrlsFor: deviceUrlsFor,
    resolveDevice: resolveDevice,
    fetchActivePlaylist: fetchActivePlaylist,
    loadBootstrap: loadBootstrap,
    loadRuntimeConfig: loadRuntimeConfig,
    IMAGE_EXT: IMAGE_EXT,
    VIDEO_EXT: VIDEO_EXT
  };
})();

if (typeof window !== 'undefined') { window.PlayerCore = PlayerCore; }
