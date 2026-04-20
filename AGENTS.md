This is a monorepo for a AI researcher app.

# Rules for frontend (/web):

- We use Tanstack start as a framework and follow all its best practices and guidlines suggested official by documentation
- For UI we use Shadcn components for most of the work. If it is possible and suitable to use a Shadcn component in some particular usecase - it should be used. New components can be added via official Shadcn cli.
- For data loading and communication with backend we use Eden treaty client from ElysiaJS.
- ALL data fetching in the app should be done using React Query library, not raw fetch or axios. Proper use of React Query should include loading states in all places where it's suitable (e.g. buttons, other places where data can will be loaded)
