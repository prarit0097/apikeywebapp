#!/usr/bin/env bash
set -euo pipefail
APP_ROOT=/opt/apikeywebapp
if [[ "$(realpath "$PWD")" != "$APP_ROOT" ]]; then
  echo 'Run only from /opt/apikeywebapp.' >&2
  exit 1
fi
test -f .env || { echo 'Create the private production .env first.' >&2; exit 1; }
mkdir -p data backups acme
chgrp www-data "$APP_ROOT"
chmod 750 "$APP_ROOT"
chmod 700 backups
chown 1000:1000 data
chmod 700 data
chmod 600 .env
docker compose -p apikeywebapp config --quiet
if docker image inspect apikeywebapp:latest >/dev/null 2>&1; then
  docker tag apikeywebapp:latest apikeywebapp:previous
fi
docker compose -p apikeywebapp up -d --build gateway
echo 'App started. Validate its health before changing the domain proxy.'
