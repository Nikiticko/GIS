#!/bin/bash
set -euo pipefail
umask 077
cd /opt/gis-calendar
compose=(docker compose -p gis-calendar --env-file /opt/gis-calendar/.env -f "${GIS_COMPOSE_FILE:-/opt/gis-calendar/current/compose.yaml}")

# GIS_BACKUP_REMOTE має вказувати на rclone crypt remote, а не на Google Drive напряму.
: "${GIS_BACKUP_REMOTE:?Не задано зашифроване сховище GIS_BACKUP_REMOTE}"
if [ "${GIS_OPERATION_LOCK_HELD:-}" = 1 ]; then
  flock -n 9
else
  exec 9> /tmp/gis-calendar-operation.lock
  flock -w 3600 9 || { echo "Інша операція все ще виконується" >&2; exit 1; }
fi
remote_name=${GIS_BACKUP_REMOTE%%:*}:
rclone listremotes --long | awk -v remote="$remote_name" '$1 == remote && $2 == "crypt" { found=1 } END { exit !found }' || { echo "Потрібне налаштоване crypt-сховище" >&2; exit 1; }
work=$(mktemp -d)
restart_needed=0
cleanup() {
  status=$?
  trap - EXIT
  if [ "$restart_needed" -eq 1 ]; then
    "${compose[@]}" start --wait --wait-timeout 120 api || { echo "ПОМИЛКА: API не відновив роботу" >&2; status=1; }
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
echo "$(date -Is) Початок резервного копіювання"
df -h .
if [ -n "$("${compose[@]}" ps --status running -q api)" ]; then restart_needed=1; fi
"${compose[@]}" stop api
"${compose[@]}" exec -T db pg_dump -U gis -d gis -Fc > "$work/database.dump"
"${compose[@]}" exec -T db pg_restore --list < "$work/database.dump" > /dev/null
"${compose[@]}" run --rm --no-deps -T api tar -C /app/data -cf - attachments > "$work/attachments.tar"
tar -tf "$work/attachments.tar" > /dev/null
if [ "$restart_needed" -eq 1 ]; then
  "${compose[@]}" start --wait --wait-timeout 120 api
  restart_needed=0
fi
name="gis-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$work" -czf "$work/$name" database.dump attachments.tar
rclone --crypt-no-data-encryption=false copyto "$work/$name" "${GIS_BACKUP_REMOTE%/}/$name"
local_hash=$(sha256sum "$work/$name" | cut -d ' ' -f 1)
remote_hash=$(rclone --crypt-no-data-encryption=false cat "${GIS_BACKUP_REMOTE%/}/$name" | sha256sum | cut -d ' ' -f 1)
[ "$local_hash" = "$remote_hash" ] || { echo "Помилка перевірки копії" >&2; exit 1; }
rclone delete "${GIS_BACKUP_REMOTE%/}" --include 'gis-*.tar.gz' --min-age 30d
echo "$(date -Is) Резервну копію перевірено: $name"
