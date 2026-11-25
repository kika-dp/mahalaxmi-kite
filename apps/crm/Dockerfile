# syntax=docker/dockerfile:1.7
# docker build -f apps/crm/Dockerfile -t kite-crm .   (API is same-origin at /api/v1 behind Caddy)
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# All workspace manifests are needed so pnpm can validate the lockfile.
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
COPY apps/crm/package.json apps/crm/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter "crm..."
COPY packages packages
COPY apps/crm apps/crm
RUN pnpm --filter @kite/shared build && pnpm --filter @kite/api-client build && pnpm --filter crm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r kite && useradd -r -g kite kite
COPY --from=build /repo/apps/crm/.next/standalone ./
COPY --from=build /repo/apps/crm/.next/static ./apps/crm/.next/static
USER kite
EXPOSE 3000
CMD ["node", "apps/crm/server.js"]
