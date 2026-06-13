# Scopy

Scopy is an open-source AI code review tool for GitHub pull requests.

It connects to GitHub, watches enabled repositories, reviews pull request diffs with an AI review engine, posts findings back to GitHub, and tracks review activity in a product dashboard.

## Monorepo

- `apps/web`: TanStack Start, React, shadcn/ui, React Query, Eden treaty
- `apps/api`: Elysia, Better Auth, Drizzle, PostgreSQL, Graphile Worker
- `apps/tools`: repository analysis, diff context, symbol lookup, text search, and semantic indexing utilities
- `apps/landing`: marketing site
- `packages/ui`: shared shadcn/ui components

Scopy developer and product docs live in [`docs/`](docs/) and are structured for Mintlify.

## Quickstart

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm dev
```

Default local URLs:

- Web app: `http://localhost:3000`
- API: `http://localhost:3001`
- Landing app: `http://localhost:3002`

## Docs

```bash
pnpm docs:dev
```

Start with:

- [`docs/index.mdx`](docs/index.mdx)
- [`docs/quickstart.mdx`](docs/quickstart.mdx)
- [`docs/product/how-review-works.mdx`](docs/product/how-review-works.mdx)
- [`docs/architecture/overview.mdx`](docs/architecture/overview.mdx)

## Common Commands

```bash
pnpm typecheck
pnpm build
pnpm --filter api test
pnpm --filter tools test
```

## Development Rules

- Use React Query for frontend data fetching.
- Use the Eden treaty client from `apps/web/src/lib/api.ts`.
- Import API types from the `api` workspace package.
- Prefer shared shadcn/ui components from `@workspace/ui`.
- Add shadcn/ui components with `pnpm dlx shadcn@latest add <component> -c apps/web`.
