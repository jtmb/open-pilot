#!/bin/sh
set -e
# Run DB migrations on every startup (idempotent)
npx prisma migrate deploy
exec npm start
