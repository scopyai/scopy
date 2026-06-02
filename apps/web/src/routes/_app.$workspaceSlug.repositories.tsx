import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/$workspaceSlug/repositories")({
  component: RepositoriesLayout,
})

function RepositoriesLayout() {
  return <Outlet />
}
