# Reprodutor de Vídeo — Player de Sinalização Digital

Player web para TVs de sinalização (digital signage), projetado para rodar
24/7 em Smart TVs Samsung — de WebKit antigo (Orsay) a Tizen — e em
navegadores modernos. A mídia e as playlists são servidas por um gateway
Cloudflare Workers + R2, e o painel administrativo conversa com um backend
próprio para upload, cadastro de TVs e publicação.

## Arquitetura

```text
TVs / navegadores
      |
      v
GitHub Pages (este repositório)
  index.html | legacy.html | plsz.html | diagnostico.html
  player-core.js (núcleo compartilhado)
      |
      +--> player-config.json  --> URLs de playlist/devices/config
      |
      v
Cloudflare Worker (worker/) --> R2: player-sinalizacao
  playlist.json | devices/<id>/playlist.json | mídia
      ^
      |
Painel (admin.html) --> Backend (Azure Container Apps)
  upload, cadastro de TVs, playlists por TV, staging
```

## Players

| Arquivo | Para quê | Particularidades |
| --- | --- | --- |
| `index.html` | Player principal (Tizen / navegadores modernos) | HUD, barra de progresso, borda na cor da mídia, recodifica `?device=`, hot-update entre mídias |
| `legacy.html` | Samsung Orsay / WebKit antigo | Elemento `<video>` persistente, safe reload com proteção contra loop, guardião de fim de vídeo, `?fit=cover\|contain\|stretch` |
| `plsz.html` | Versão leve do legado | Mesmos mecanismos de segurança, sem HUD, sobre `player-core.js` |
| `diagnostico.html` | Diagnóstico na TV | Codecs, engine, tela e rede para suporte remoto |

### Núcleo compartilhado

`player-core.js` concentra a camada de dados usada pelos três players:
requisição JSON, normalização e revisão de playlists, cadastro de TVs
(`devices.json`) e consulta das playlists ativas (global, individual ou
mista). É ES5 puro, sem etapa de build. O `staging/player-core.js` é uma
cópia idêntica exigida pelo loader de staging (que resolve `src` relativos
contra o diretório `staging/`); um teste de igualdade byte a byte impede
divergência entre as cópias.

A lógica de reprodução (enquadramento, watchdogs, recuperação de falhas)
permanece em cada player porque cada família de TV tem restrições próprias.

### Identificação da TV

Os players aceitam `?device=<id>`. Sem o parâmetro, tocam a playlist global.
O cadastro vive em `devices.json` e cada TV pode ter:

- `playlistMode: global` — só a playlist pública;
- `playlistMode: individual` — só `devices/<id>/playlist.json`;
- `playlistMode: mixed` — as duas, mescladas e deduplicadas.

Falhas transitórias não derrubam o player: a identificação é retentada a
cada minuto e consultas de playlist no modo misto aceitam sucesso parcial
(a revisão ganha o marcador `|miss:N` até a fonte ausente voltar).

## Configuração

### `player-config.json` (bootstrap)

| Chave | Uso |
| --- | --- |
| `playlistUrl` | Playlist global (JSON com `items` e `updatedAt`) |
| `devicesUrl` | Cadastro de TVs e playlists por TV |
| `configUrl` | Configuração de runtime opcional (mesclada no CONFIG) |
| `playlistCheckSeconds` | Intervalo de consulta da playlist. Player principal: mínimo de 2s, e consulta só entre mídias (nunca durante a reprodução). Players legados: mínimo proposital de 60s para não sobrecarregar o XHR do WebKit antigo |

### `config.json` (runtime, publicado pelo painel)

`imageDurationSeconds`, `pollIntervalMinutes`, `showHud`, `autoReloadHours`,
`targetVolume`, `videoVolumeOverrides`, `fillBorderColor`, `musicEnabled`,
`musicPlaylist`, `imageMusicDurationSeconds`, `musicVolume`.

### Comportamentos de robustez

- **Watchdogs de vídeo**: tempo sem avançar dispara retentativas com retomada
  próxima ao ponto da falha; esgotadas, recarga segura do player.
- **Safe reload (legado)**: no máximo 2 recargas por janela de 60s, guardado
  em `localStorage`, evitando loops de reinicialização.
- **Guardião de fim de vídeo (legado/leve)**: WebKit antigo às vezes não
  dispara `ended`; após duas confirmações no limite final, o `onended`
  configurado é acionado manualmente.
- **Áudio com autoplay bloqueado**: mensagem em tela e retomada com
  OK/Enter ou toque.
- **Troca de conteúdo**: sempre no limite entre mídias, nunca no meio de um
  vídeo; a revisão da playlist decide se há novidade.

## Painel e staging

- `admin.html` + `admin-config.js`: painel de publicação (autenticação por
  token Bearer em `sessionStorage`, envio com progresso, deduplicação,
  cadastro de TVs e cópia da URL de cada player).
- `staging/`: ambiente de prova isolado. Os loaders reutilizam os players da
  raiz via `document.write`, e a configuração aponta para
  `playlist-staging.json`/`config-staging.json`. Staging nunca altera
  objetos de produção — detalhes em `staging/README.md`.

## Gateway de mídia

`worker/` entrega o bucket R2 com CORS restrito, suporte a `Range` (206),
`HEAD`, `ETag/Last-Modified` e reescrita de URLs das playlists controladas.
Playlist corrompida responde 502 claro. Detalhes de implantação em
`worker/README.md`.

## Desenvolvimento

```bash
npm test              # testes dos players e do núcleo (test/)
npm run test:worker   # testes do gateway (worker/test/)
npm run test:all      # tudo
```

Os testes usam `node --test` (Node 18+). Os dos players rodam o script real
dentro de um DOM falso (via `vm`), cobrindo hot-update, watchdogs,
enquadramento, escaping e o núcleo compartilhado. O CI executa as duas
suítes a cada push/PR.

## Publicação

- **GitHub Pages**: o conteúdo da raiz é servido direto do branch principal.
- **Worker**: `cd worker && npm run deploy` (primeira implantação manual,
  ver `worker/README.md`).

## Licença

[Distribuído sob a licença MIT](LICENSE).
