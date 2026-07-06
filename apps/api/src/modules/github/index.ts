import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, ne } from "drizzle-orm"
import { protectedRoute } from "../auth"
import { db } from "../../db/client"
import { user, workspace, workspaceMember } from "../../db/schema"
import { env } from "../../env"
import {
  getGitHubInstallUrl,
  getGitHubInstallation,
  getGitHubUserAuthorizationUrl,
  listGitHubInstallationRepositories,
  verifyGitHubInstallationForUser,
} from "./service"
import {
  PersonalGitHubWorkspaceAlreadyConnectedError,
  syncWorkspaceRepositories,
  upsertGitHubWorkspace,
} from "../workspaces/service"

type InstallState = {
  type: "install" | "verify-installation"
  userId: string
  nonce: string
  expiresAt: number
  installationId?: string
  source?: "connect" | "onboarding"
}

const sign = (payload: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(payload)
    .digest("base64url")

const createInstallState = (
  userId: string,
  type: InstallState["type"] = "install",
  installationId?: string,
  source: InstallState["source"] = "connect"
) => {
  const state: InstallState = {
    type,
    userId,
    nonce: randomUUID(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    ...(installationId ? { installationId } : {}),
    source,
  }
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url")

  return `${payload}.${sign(payload)}`
}

const verifyInstallState = (
  state: string,
  userId: string,
  type: InstallState["type"]
) => {
  const [payload, signature] = state.split(".")

  if (!payload || !signature) {
    return null
  }

  const expectedSignature = sign(payload)
  const actual = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as InstallState

    if (
      parsed.type !== type ||
      parsed.userId !== userId ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

const redirectAfterConnect = async (
  workspaceId: string,
  source: InstallState["source"] = "connect"
) => {
  const ws = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
  })

  if (!ws) {
    return Response.redirect(new URL("/connect", env.FRONTEND_URL), 302)
  }

  const path =
    source === "onboarding"
      ? "/onboarding/overview"
      : `/${encodeURIComponent(ws.providerAccountLogin)}/repositories`
  const url = new URL(path, env.FRONTEND_URL)
  url.searchParams.set("connected", "1")
  return Response.redirect(url, 302)
}

const redirectWithGitHubError = (error: string) => {
  const url = new URL("/connect", env.FRONTEND_URL)
  url.searchParams.set("githubError", error)
  return Response.redirect(url, 302)
}

const connectGitHubInstallation = async (
  installationId: string,
  userId: string,
  source: InstallState["source"] = "connect"
) => {
  const installation = await getGitHubInstallation(installationId)
  const savedWorkspace = await upsertGitHubWorkspace(installation, userId, {
    initialReviewCredits:
      source === "onboarding" ? env.SIGNUP_REVIEW_CREDITS : 0,
  })
  const repositories = await listGitHubInstallationRepositories(installationId)

  await syncWorkspaceRepositories(
    savedWorkspace.id,
    repositories,
    installation.repository_selection
  )

  await db
    .update(user)
    .set({
      onboardingStatus: "select_repositories",
      updatedAt: new Date(),
    })
    .where(
      and(eq(user.id, userId), eq(user.onboardingStatus, "connect_github"))
    )

  return redirectAfterConnect(savedWorkspace.id, source)
}

const handleInstallationCallback = async ({
  query,
  user: currentUser,
}: {
  query: Record<string, string | undefined>
  user: { id: string }
}) => {
  if (query.error) {
    return redirectWithGitHubError("authorization_denied")
  }

  const installationId = query.installation_id
  const state = query.state
  const code = query.code
  const isInstallationUpdate = query.setup_action === "update"

  if (code) {
    const verifiedState = state
      ? verifyInstallState(state, currentUser.id, "verify-installation")
      : null

    if (!verifiedState?.installationId) {
      return redirectWithGitHubError("invalid_authorization_callback")
    }

    try {
      await verifyGitHubInstallationForUser(verifiedState.installationId, code)

      return await connectGitHubInstallation(
        verifiedState.installationId,
        currentUser.id,
        verifiedState.source
      )
    } catch (error) {
      console.error("Failed to verify GitHub installation ownership", error)

      if (error instanceof PersonalGitHubWorkspaceAlreadyConnectedError) {
        return redirectWithGitHubError("personal_account_already_connected")
      }

      return redirectWithGitHubError("installation_not_accessible")
    }
  }

  const verifiedInstallState = state
    ? verifyInstallState(state, currentUser.id, "install")
    : null

  if (!installationId || (!isInstallationUpdate && !verifiedInstallState)) {
    return redirectWithGitHubError("invalid_installation_callback")
  }

  try {
    if (verifiedInstallState) {
      return Response.redirect(
        getGitHubUserAuthorizationUrl(
          createInstallState(
            currentUser.id,
            "verify-installation",
            installationId,
            verifiedInstallState.source
          )
        ),
        302
      )
    }

    if (isInstallationUpdate) {
      const [existingWorkspace] = await db
        .select({ workspace })
        .from(workspaceMember)
        .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
        .where(
          and(
            eq(workspaceMember.userId, currentUser.id),
            eq(workspaceMember.status, "active"),
            eq(workspace.provider, "github"),
            eq(workspace.providerInstallationId, installationId),
            ne(workspace.connectionStatus, "deleted")
          )
        )
        .limit(1)

      if (!existingWorkspace) {
        return redirectWithGitHubError("workspace_not_found")
      }

      const installation = await getGitHubInstallation(installationId)
      const repositories =
        await listGitHubInstallationRepositories(installationId)

      await syncWorkspaceRepositories(
        existingWorkspace.workspace.id,
        repositories,
        installation.repository_selection
      )

      return redirectAfterConnect(existingWorkspace.workspace.id)
    }

    return redirectWithGitHubError("invalid_installation_callback")
  } catch (error) {
    console.error("Failed to connect GitHub installation", error)

    if (error instanceof PersonalGitHubWorkspaceAlreadyConnectedError) {
      return redirectWithGitHubError("personal_account_already_connected")
    }

    return redirectWithGitHubError("connect_failed")
  }
}

export const githubRoutes = protectedRoute("/github")
  .get("/install-url", ({ query, user: currentUser, status }) => {
    try {
      const source = query.source === "onboarding" ? "onboarding" : "connect"
      return {
        url: getGitHubInstallUrl(
          createInstallState(currentUser.id, "install", undefined, source)
        ),
      }
    } catch {
      return status(503, { error: "GitHub App is not configured" })
    }
  })
  .get("/callback", ({ query, user }) =>
    handleInstallationCallback({ query, user })
  )
  .get("/authorization", ({ query, user }) =>
    handleInstallationCallback({ query, user })
  )
  .get("/installation", ({ query, user }) =>
    handleInstallationCallback({ query, user })
  )
  .post("/sync", async ({ user: currentUser, status }) => {
    const workspaces = await db
      .select({ workspace })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(
        and(
          eq(workspaceMember.userId, currentUser.id),
          eq(workspaceMember.status, "active"),
          eq(workspace.provider, "github")
        )
      )

    try {
      for (const row of workspaces) {
        const repositories = await listGitHubInstallationRepositories(
          row.workspace.providerInstallationId
        )

        await syncWorkspaceRepositories(row.workspace.id, repositories)
      }

      return {
        synced: workspaces.length,
      }
    } catch (error) {
      console.error("Failed to sync GitHub workspaces", error)
      return status(502, { error: "Failed to sync GitHub workspaces" })
    }
  })
