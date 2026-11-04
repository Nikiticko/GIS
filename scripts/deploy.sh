#!/bin/bash
set -euo pipefail
umask 077

revision=${1:?Потрібен SHA коміту}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo "Некоректний SHA" >&2; exit 1; }
root=/opt/gis-calendar
release="$root/releases/$revision"
archive="/tmp/gis-calendar-$revision.tar"
test -f "$root/.env" || { echo "Не налаштовано середовище на VPS" >&2; exit 1; }
test -f "$archive"
exec 9> /tmp/gis-calendar-operation.lock
flock -w 3600 9 || { echo "Інша операція все ще виконується" >&2; exit 1; }
mkdir -p "$release"
tar -xf "$archive" -C "$release"
rm -f "$archive"
compose=(docker compose -p gis-calendar --project-directory "$release" --env-file "$root/.env" -f "$release/compose.yaml")
"${compose[@]}" build
"${compose[@]}" up -d --wait db
"${compose[@]}" stop api </dev/null
"${compose[@]}" run --rm -T api node dist-api/migrate.js </dev/null
"${compose[@]}" up -d --wait --wait-timeout 120
ln -sfn "$release" "$root/current"
echo "Версію $revision запущено."
