# Install dependencies
FROM node:20-bullseye AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
FROM node:20-bullseye AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client for the target platform
RUN npx prisma generate
RUN npm run build

# Production image
FROM node:20-bullseye AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Prisma migration files + schema (needed by migrate deploy at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
# Data directory for the SQLite database
RUN mkdir -p /data
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
