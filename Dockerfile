# Production image for Cloud Run. See DECISIONS.md 2026-10-11 and
# .github/workflows/deploy.yml, which builds and deploys it.
#
# The build needs no database: migrations and the app-role grant run as
# their own deploy step *before* this image is rolled out, never inside
# `docker build`, so no credential is ever baked into a layer.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts refuses to load without DATABASE_URL, even for
# `generate`, which never connects. A placeholder that points nowhere is
# enough, and is deliberately not a real address.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:1/build" npx prisma generate \
  && npx next build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# `output: "standalone"` (next.config.ts) traces server.js and the
# node_modules it needs; public/ and .next/static are copied alongside so
# server.js serves them itself.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
