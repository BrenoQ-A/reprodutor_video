# Ambiente de staging do player

Este diretório fornece um ambiente de teste isolado da configuração de produção.

## Entradas

- `staging/index.html`: carrega o código atual de `../index.html`, mas usa o bootstrap de staging.
- `staging/legacy.html`: carrega o código atual de `../legacy.html`, mantendo parâmetros como `?fit=cover`, `?fit=contain` e `?fit=stretch`.
- `staging/admin.html`: painel exclusivo do staging. Ele autentica usando a mesma conta do painel principal, mas grava apenas em `playlist-staging.json` e `config-staging.json`.

## Estado persistente

O bootstrap `staging/player-config.json` aponta para dois objetos próprios no Cloudflare R2:

- `playlist-staging.json`
- `config-staging.json`

Esses objetos são criados e mantidos pela API `/api/staging` do backend. A playlist de produção (`playlist.json`) e a configuração de produção (`config.json`) não são modificadas pelo fluxo de staging.

A mídia física pode ser reaproveitada a partir da produção por referência ao mesmo objeto no R2. Remover uma mídia do staging remove somente sua entrada em `playlist-staging.json`; o arquivo de produção não é excluído.

## URLs após publicação no GitHub Pages

- Player principal: `https://brenoq-a.github.io/reprodutor_video/staging/`
- Player legado: `https://brenoq-a.github.io/reprodutor_video/staging/legacy.html`
- Painel de staging: `https://brenoq-a.github.io/reprodutor_video/staging/admin.html`
- Legacy cover: `https://brenoq-a.github.io/reprodutor_video/staging/legacy.html?fit=cover`

## Fluxo recomendado

1. Entre em `staging/admin.html` com uma conta administradora.
2. Selecione mídias de produção e adicione apenas as referências necessárias ao staging, ou use o espelhamento completo quando quiser reproduzir a playlist atual em um ambiente de teste.
3. Ajuste enquadramento, volume, canvas e demais parâmetros do staging.
4. Valide no player normal ou legacy de staging.
5. Somente depois replique manualmente a mudança aprovada para produção.

## Regra de segurança

O staging nunca deve excluir ou sobrescrever `playlist.json`, `config.json` ou objetos de mídia da produção. As operações de remoção e limpeza do painel de staging são limitadas aos metadados de staging.
