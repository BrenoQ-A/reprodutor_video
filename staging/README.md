# Ambiente de staging do player

Este diretório fornece um ambiente de teste isolado da configuração de produção.

## Entradas

- `staging/index.html`: carrega o código atual de `../index.html`, mas resolve `player-config.json` dentro deste diretório.
- `staging/legacy.html`: carrega o código atual de `../legacy.html`, mantendo inclusive parâmetros como `?fit=cover`, mas resolve `player-config.json` dentro deste diretório.

Como o documento final continua na URL `/staging/...`, todas as URLs relativas usadas pelo player apontam para os arquivos de staging abaixo, sem alterar `index.html`, `legacy.html` ou `player-config.json` de produção.

## Configuração isolada

- `player-config.json`: bootstrap do staging.
- `config.json`: parâmetros de execução do staging.
- `playlist.json`: playlist de teste; começa vazia para impedir reprodução acidental de conteúdo de produção.

## URLs após publicação no GitHub Pages

- Player principal: `https://brenoq-a.github.io/reprodutor_video/staging/`
- Player legado: `https://brenoq-a.github.io/reprodutor_video/staging/legacy.html`
- Player legado com ajuste de enquadramento: `https://brenoq-a.github.io/reprodutor_video/staging/legacy.html?fit=cover`

## Regra de segurança

Mudanças de conteúdo de staging devem ocorrer apenas em `staging/playlist.json` e `staging/config.json` até que o painel administrativo ganhe suporte explícito a ambientes. Nunca reutilize a playlist de produção por cópia automática.
