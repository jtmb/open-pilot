#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "==> Stopping containers..."
docker compose down --remove-orphans

echo "==> Waiting for port 3000 to be released..."
for i in $(seq 1 30); do
  if ! (ss -tlnp 2>/dev/null | grep -q ':3000') && ! (lsof -ti:3000 2>/dev/null | grep -q .); then
    echo "    Port 3000 is free."
    break
  fi
  echo "    Port 3000 still held, waiting... ($i/30)"
  if [ "$i" -eq 30 ]; then
    echo "    Forcing port release..."
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
  fi
  sleep 1
done

echo "==> Building images (web + code-server if needed)..."
docker compose build

echo "==> Starting containers..."
docker compose up -d --force-recreate

echo "==> Waiting for web to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "==> Done. Web is up at http://localhost:3000"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Web did not become healthy. Checking logs..."
docker compose logs web --tail=30
exit 1
