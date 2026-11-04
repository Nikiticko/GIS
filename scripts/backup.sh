#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

# GIS_BACKUP_REMOTE має вказувати на rclone crypt remote, а не на Google Drive напряму.
: "${GIS_BACKUP_REMOTE:?Не задано зашифроване сховище GIS_BACKUP_REMOTE}"
exec 9> /tmp/gis-calendar-backup.lock
flock -n 9 || { echo "Резервне копіювання вже виконується" >&2; exit 1; }
work=$(mktemp -d)
stopped=0
cleanup() {
  if [ "$stopped" -eq 1 ]; then docker compose start api || echo "ПОМИЛКА: не вдалося запустити API" >&2; fi
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
echo "$(date -Is) Початок резервного копіювання"
df -h .
docker compose stop api
stopped=1
docker compose exec -T db pg_dump -U gis -d gis -Fc > "$work/database.dump"
docker compose run --rm --no-deps -T api tar -C /app/data -cf - attachments > "$work/attachments.tar"
docker compose start api
stopped=0
name="gis-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$work" -czf "$work/$name" database.dump attachments.tar
rclone copyto "$work/$name" "${GIS_BACKUP_REMOTE%/}/$name"
local_hash=$(sha256sum "$work/$name" | cut -d ' ' -f 1)
remote_hash=$(rclone cat "${GIS_BACKUP_REMOTE%/}/$name" | sha256sum | cut -d ' ' -f 1)
[ "$local_hash" = "$remote_hash" ] || { echo "Помилка перевірки копії" >&2; exit 1; }
rclone delete "${GIS_BACKUP_REMOTE%/}" --include 'gis-*.tar.gz' --min-age 30d
echo "$(date -Is) Резервну копію перевірено: $name"
