# TanStack Start + Elysia Monorepo Template

This is a reusable TypeScript monorepo template with:

- `apps/web`: TanStack Start, React, shadcn/ui, React Query, Eden treaty
- `apps/api`: Elysia, Better Auth, Drizzle, PostgreSQL
- `packages/ui`: shared shadcn/ui components

## Setup

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

## Eden

The web app consumes the API type through the `api` workspace package:

```tsx
import type { App } from "api";
```

Do not import API types through a frontend-only path alias such as `@api/*`; that breaks package resolution in monorepos.

## Adding Components

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
