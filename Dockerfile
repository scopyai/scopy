FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
