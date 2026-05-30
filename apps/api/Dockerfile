FROM node:22-alpine AS base

WORKDIR /repo

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile --filter api...

FROM deps AS builder

COPY apps/api ./apps/api

RUN pnpm --filter api build

FROM builder AS migrate

RUN addgroup -S app && adduser -S app -G app \
  && chown -R app:app /repo

USER app

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile --prod --filter api...

FROM node:22-alpine AS runner

RUN addgroup -S app && adduser -S app -G app

WORKDIR /repo/apps/api

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=prod-deps --chown=app:app /repo/node_modules /repo/node_modules
COPY --from=prod-deps --chown=app:app /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=builder --chown=app:app /repo/apps/api/dist ./dist
COPY --from=builder --chown=app:app /repo/apps/api/package.json ./package.json

USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
