import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import {
  repository,
  user as userTable,
  workspace,
  workspaceMember,
} from "../../db/schema"
import { protectedRoute } from "../auth"

export const meRoutes = protectedRoute("/me")
  .get("/session", ({ session, user }) => ({
    session,
    user,
  }))
  .get("/user", async ({ user, status }) => {
    const currentUser = await db.query.user.findFirst({
      where: eq(userTable.id, user.id),
    })

    if (!currentUser) {
      return status(404, { error: "User not found" })
    }

    return currentUser
  })
  .get("/onboarding", async ({ user }) => {
    const currentUser = await db.query.user.findFirst({
      where: eq(userTable.id, user.id),
    })

    if (!currentUser || currentUser.onboardingStatus === "connect_github") {
      return {
        status: "connect_github" as const,
        workspace: null,
      }
    }

    const [firstWorkspace] = await db
      .select({
        workspace: {
          id: workspace.id,
          providerAccountLogin: workspace.providerAccountLogin,
          providerAccountType: workspace.providerAccountType,
          providerAccountAvatarUrl: workspace.providerAccountAvatarUrl,
          name: workspace.name,
          connectionStatus: workspace.connectionStatus,
        },
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, user.id))
      .limit(1)

    if (!firstWorkspace) {
      return {
        status: "connect_github" as const,
        workspace: null,
      }
    }

    const repositories = await db.query.repository.findMany({
      where: eq(repository.workspaceId, firstWorkspace.workspace.id),
      columns: {
        id: true,
        enabled: true,
      },
    })

    return {
      status: currentUser.onboardingStatus,
      workspace: {
        ...firstWorkspace.workspace,
        role: firstWorkspace.role,
        repositoryCount: repositories.length,
        enabledRepositoryCount: repositories.filter((repo) => repo.enabled)
          .length,
      },
    }
  })
