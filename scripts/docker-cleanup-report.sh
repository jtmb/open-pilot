#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not on PATH" >&2
  exit 1
fi

human_bytes() {
  local bytes="$1"
  local units=(B KiB MiB GiB TiB)
  local unit_index=0
  local whole remainder decimal

  while (( bytes >= 1024 && unit_index < ${#units[@]} - 1 )); do
    remainder=$(( bytes % 1024 ))
    bytes=$(( bytes / 1024 ))
    unit_index=$(( unit_index + 1 ))
  done

  if (( unit_index == 0 )); then
    printf '%s %s\n' "$bytes" "${units[$unit_index]}"
    return
  fi

  whole=$bytes
  decimal=$(( (remainder * 10) / 1024 ))
  printf '%s.%s %s\n' "$whole" "$decimal" "${units[$unit_index]}"
}

fs_used_bytes() {
  df -B1 / | awk 'NR==2 { print $3 }'
}

docker_usage_report() {
  docker system df
}

before_fs_used=$(fs_used_bytes)

echo "== Docker usage before cleanup =="
docker_usage_report
echo
echo "== Filesystem usage before cleanup =="
df -h /
echo
echo "== Pruning Docker build cache =="
docker builder prune -af
echo
echo "== Pruning unused Docker data including volumes =="
docker system prune -af --volumes
echo

after_fs_used=$(fs_used_bytes)
reclaimed_fs_bytes=$(( before_fs_used - after_fs_used ))

echo "== Docker usage after cleanup =="
docker_usage_report
echo
echo "== Filesystem usage after cleanup =="
df -h /
echo
echo "== Summary =="
echo "Filesystem space reclaimed inside WSL: $(human_bytes "$reclaimed_fs_bytes")"