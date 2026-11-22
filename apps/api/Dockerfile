# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f apps/api/Dockerfile -t kite-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @kite/shared build && pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
RUN groupadd -r kite && useradd -r -g kite kite && mkdir -p /app/uploads && chown kite:kite /app/uploads
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/assets ./assets
USER kite
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations (transactional, idempotent), then start.
CMD ["sh", "-c", "node dist/database/cli/migrate.js run && node dist/main.js"]
