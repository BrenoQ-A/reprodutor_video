# Gateway de mídia — Cloudflare Worker + R2

Este Worker entrega os objetos do bucket `player-sinalizacao` diretamente por um binding R2. O objetivo é substituir o uso direto do domínio público de desenvolvimento do R2 por uma camada controlada para reprodução nas TVs.

## O que ele faz

- aceita apenas `GET`, `HEAD` e `OPTIONS`;
- suporta `Range` de um único intervalo e responde `206 Partial Content` quando o R2 retorna uma leitura parcial;
- devolve `Content-Range`, `Content-Length`, `Accept-Ranges`, `ETag`, `Last-Modified` e `Content-Type`;
- preserva metadados HTTP gravados no objeto;
- aplica `Cache-Control: no-cache` como fallback para JSON e cache de 1 hora para mídia;
- permite CORS somente para as origens configuradas em `ALLOWED_ORIGINS`;
- oferece `GET /health` para validação simples;
- não possui credenciais R2 no código: o acesso é concedido pelo binding `MEDIA_BUCKET`.

## Arquitetura

```text
TV / navegador
      |
      v
player-midia-gateway.workers.dev
      |
      v
Binding MEDIA_BUCKET
      |
      v
R2: player-sinalizacao
```

A URL do Worker preserva a chave do objeto. Exemplo:

```text
/media/abc-video.mp4 -> chave R2 media/abc-video.mp4
/playlist.json       -> chave R2 playlist.json
/playlist-staging.json -> chave R2 playlist-staging.json
```

## Implantação manual inicial

A primeira implantação deve ser feita manualmente para autorizar a conta Cloudflare e confirmar o binding antes de qualquer automação.

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket list
npm test
npm run deploy
```

O `wrangler.jsonc` já aponta o binding `MEDIA_BUCKET` para o bucket `player-sinalizacao`.

Depois do deploy, valide a URL fornecida pelo Wrangler:

```bash
curl -i https://SEU-WORKER.workers.dev/health
curl -I https://SEU-WORKER.workers.dev/playlist.json
curl -i -H "Range: bytes=0-1023" https://SEU-WORKER.workers.dev/media/ARQUIVO.mp4
```

O teste de Range deve retornar `206` e os headers `Content-Range` e `Accept-Ranges: bytes`.

## Migração segura

Não alterar a produção de uma vez. A ordem recomendada é:

1. publicar o Worker;
2. validar `/health`, `HEAD` e `Range`;
3. apontar somente `staging/player-config.json` para o Worker;
4. testar reprodução contínua no player staging e no `legacy.html` staging;
5. depois de aprovado, trocar `STORAGE_PUBLIC_BASE_URL` no backend para o domínio do Worker;
6. confirmar que novas playlists passam a publicar URLs do gateway;
7. por último, migrar o `player-config.json` de produção.

## Domínio

`workers.dev` é suficiente para a fase de testes. Um domínio próprio pode ser adicionado depois sem alterar a lógica do Worker.
