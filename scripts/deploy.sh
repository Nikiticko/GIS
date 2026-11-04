#!/bin/bash
set -euo pipefail
exec </dev/null
umask 077
trap 'status=$?; echo "Помилка розгортання на рядку $LINENO (код $status)." >&2' ERR

revision=${1:?Потрібен SHA коміту}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo "Некоректний SHA" >&2; exit 1; }
root=/opt/gis-calendar
release="$root/releases/$revision"
archive="/tmp/gis-calendar-$revision.tar"
test -f "$root/.env" || { echo "Не налаштовано середовище на VPS" >&2; exit 1; }
test -f "$archive"
available_kb=$(df -Pk "$root" | awk 'NR == 2 {print $4}')
(( available_kb >= 1048576 )) || { echo "Для розгортання потрібно щонайменше 1 ГіБ вільного місця" >&2; exit 1; }
exec 9> /tmp/gis-calendar-operation.lock
flock -w 3600 9 || { echo "Інша операція все ще виконується" >&2; exit 1; }
mkdir -p "$release"
tar -xf "$archive" -C "$release"
rm -f "$archive"
compose=(docker compose -p gis-calendar --project-directory "$release" --env-file "$root/.env" -f "$release/compose.yaml")
echo "Складання контейнерів"
"${compose[@]}" build
echo "Запуск PostgreSQL"
"${compose[@]}" up -d --wait db
echo "Перевірка резервної копії перед міграціями"
if [[ "$("${compose[@]}" exec -T db psql -U gis -d gis -Atc "select to_regclass('public.users') is not null")" == t ]]; then
  GIS_COMPOSE_FILE="$release/compose.yaml" GIS_BACKUP_REMOTE="${GIS_BACKUP_REMOTE:-gis-encrypted:backups}" GIS_OPERATION_LOCK_HELD=1 bash "$release/scripts/backup.sh"
fi
echo "Застосування міграцій"
"${compose[@]}" stop api </dev/null
"${compose[@]}" run --rm -T api node dist-api/migrate.js </dev/null
echo "Запуск і перевірка контейнерів"
"${compose[@]}" up -d --wait --wait-timeout 120
for service in db api web; do
  container=$("${compose[@]}" ps -q "$service")
  [[ -n "$container" ]] || { echo "Контейнер $service відсутній" >&2; exit 1; }
  state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
  [[ "$state" == 'running healthy' ]] || { echo "Контейнер $service: $state" >&2; exit 1; }
  echo "$service: $state"
done
echo "Перевірка HTTPS та API через Caddy"
curl --fail --silent --show-error --noproxy '*' --max-time 15 --retry 6 --retry-delay 5 --retry-all-errors --resolve gis-calendar.tech:443:127.0.0.1 https://gis-calendar.tech/ | grep '<div id="root"' >/dev/null
curl --fail --silent --show-error --noproxy '*' --max-time 15 --retry 6 --retry-delay 5 --retry-all-errors --resolve gis-calendar.tech:443:127.0.0.1 https://gis-calendar.tech/api/health | grep -E '"status"[[:space:]]*:[[:space:]]*"ok"' >/dev/null
ln -sfn "$release" "$root/current"
[[ "$(readlink "$root/current")" == "$release" ]] || { echo "Не вдалося оновити current" >&2; exit 1; }
echo "GIS_DEPLOY_SUCCESS $revision"
