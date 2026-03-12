# One-step deploy: backend API + web UI in a single container.
# Build with empty VITE_API_URL so the web calls the same origin (/v1/...).

# ---- Backend build ----
FROM node:20-alpine AS backend-build
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---- Web build (same-origin API) ----
FROM node:20-alpine AS web-build
WORKDIR /app/web

ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

COPY web/package.json web/package-lock.json* ./
RUN npm ci

COPY web/index.html web/vite.config.ts web/tsconfig.json web/tsconfig.node.json ./
COPY web/src ./src
COPY web/public ./public
RUN npm run build

# ---- Run: backend serves API + web static ----
# Use Debian-based image so Prisma engine finds correct OpenSSL (Alpine often fails at runtime).
FROM node:20-slim AS run
WORKDIR /app

ENV NODE_ENV=production

# Prisma schema engine requires OpenSSL at runtime (slim image does not include it).
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Backend runtime deps + Prisma
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY --from=backend-build /app/backend/dist ./dist
COPY --from=web-build /app/web/dist ./web-dist

EXPOSE 3000
ENV PORT=3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
