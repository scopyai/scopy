# Review

Review is an open-source AI code review tool for GitHub pull requests. It is built as a TypeScript monorepo with:

- `apps/web`: TanStack Start, React, shadcn/ui, React Query, Eden treaty
- `apps/api`: Elysia, Better Auth, Drizzle, PostgreSQL, Graphile Worker
- `apps/tools`: repository analysis, diff context, symbol lookup, text search, and semantic indexing utilities
- `packages/ui`: shared shadcn/ui components

Developer documentation lives in [`docs/`](docs/) and is structured for Mintlify import.

## Quickstart

Install dependencies:

```bash
pnpm install
```

Create env files from the examples:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Run the app:

```bash
pnpm dev
```

The product web app runs on `http://localhost:3000` and the API defaults to `http://localhost:3001`.

## Docs

Run the Mintlify docs locally from the repo root:

```bash
pnpm docs:dev
```

## API Types

The web app consumes the API type through the `api` workspace package:

```tsx
import type { App } from "api";
```

Do not import API types through a frontend-only path alias such as `@api/*`; that breaks package resolution in monorepos.

## Adding shadcn/ui Components

To add shadcn/ui components, run this at the repo root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using Components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```
