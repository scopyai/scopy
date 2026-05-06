This is a reusable monorepo template with a TanStack Start web app, an Elysia API, shadcn/ui components, Better Auth, Drizzle, and Eden treaty.

# Rules for frontend (/web):

- We use TanStack Start as the frontend framework and follow the official framework patterns.
- For UI we use Shadcn components for most of the work. If it is possible and suitable to use a Shadcn component in some particular usecase - it should be used. New components can be added via official Shadcn cli.
- For backend communication, use the Eden treaty client from ElysiaJS.
- Import backend app types from the `api` workspace package, not by reaching into API source with frontend tsconfig path aliases.
- ALL data fetching in the app should be done using React Query library, not raw fetch or axios. Proper use of React Query should include loading states in all places where it's suitable (e.g. buttons, other places where data can will be loaded)
