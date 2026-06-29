# Multi-stage build for the QueueFlow backend (API + worker share one image;
# the run command selects which process to start).

# ---- builder: install everything, compile TS -> dist ----
FROM node:22-alpine AS builder
WORKDIR /app

# Copy the whole workspace (dist/node_modules excluded via .dockerignore), then
# install against the lockfile so workspace symlinks resolve to full package sources.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN npm ci
RUN npm run build
# tsc doesn't copy non-TS assets — the migrate runner needs schema.sql beside it.
RUN cp packages/db/src/schema.sql packages/db/dist/schema.sql

# ---- runtime: prod deps + compiled output only ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/metrics/package.json packages/metrics/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS for every workspace package (npm workspaces symlinks @queueflow/* here).
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/metrics/dist ./packages/metrics/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist

# Run as the non-root node user baked into the base image.
USER node

# Default to the API; the worker service overrides this command.
CMD ["node", "packages/api/dist/index.js"]
