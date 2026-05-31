import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { protectedRoute } from "../../app/auth";
import { db } from "../../db/client";
import { workspace, workspaceMember } from "../../db/schema";
import { env } from "../../env";
import {
  getGitHubInstallUrl,
  getGitHubInstallation,
  getGitHubUserAuthorizationUrl,
  listGitHubInstallationRepositories,
  verifyGitHubInstallationForUser,
} from "../../services/github";
import {
  syncWorkspaceRepositories,
  upsertGitHubWorkspace,
} from "../../services/workspaces";

type InstallState = {
  type: "install" | "verify-installation";
  userId: string;
  nonce: string;
  expiresAt: number;
  installationId?: string;
};

const sign = (payload: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url");

const createInstallState = (
  userId: string,
  type: InstallState["type"] = "install",
  installationId?: string,
) => {
  const state: InstallState = {
    type,
    userId,
    nonce: randomUUID(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    ...(installationId ? { installationId } : {}),
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");

  return `${payload}.${sign(payload)}`;
};

const verifyInstallState = (
  state: string,
  userId: string,
  type: InstallState["type"],
) => {
  const [payload, signature] = state.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as InstallState;

    if (
      parsed.type !== type ||
      parsed.userId !== userId ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const redirectToDashboard = (workspaceId?: string) => {
  const url = new URL("/dashboard", env.FRONTEND_URL);

  if (workspaceId) {
    url.searchParams.set("workspaceId", workspaceId);
  }

  return Response.redirect(url, 302);
};

const connectGitHubInstallation = async (
  installationId: string,
  userId: string,
) => {
  const installation = await getGitHubInstallation(installationId);
  const savedWorkspace = await upsertGitHubWorkspace(installation, userId);
  const repositories =
    await listGitHubInstallationRepositories(installationId);

  await syncWorkspaceRepositories(
    savedWorkspace.id,
    repositories,
    installation.repository_selection,
  );

  return redirectToDashboard(savedWorkspace.id);
};

const handleInstallationCallback = async ({
  query,
  user: currentUser,
  status,
}: {
  query: Record<string, string | undefined>;
  user: { id: string };
  status: (code: number, body?: { error: string }) => unknown;
}) => {
  const installationId = query.installation_id;
  const state = query.state;
  const code = query.code;
  const isInstallationUpdate = query.setup_action === "update";

  if (code) {
    const verifiedState = state
      ? verifyInstallState(state, currentUser.id, "verify-installation")
      : null;

    if (!verifiedState?.installationId) {
      return status(400, { error: "Invalid GitHub authorization callback" });
    }

    try {
      await verifyGitHubInstallationForUser(verifiedState.installationId, code);

      return connectGitHubInstallation(
        verifiedState.installationId,
        currentUser.id,
      );
    } catch (error) {
      console.error("Failed to verify GitHub installation ownership", error);
      return status(403, { error: "GitHub installation is not accessible" });
    }
  }

  const verifiedInstallState = state
    ? verifyInstallState(state, currentUser.id, "install")
    : null;

  if (
    !installationId ||
    (!isInstallationUpdate && !verifiedInstallState)
  ) {
    return status(400, { error: "Invalid GitHub installation callback" });
  }

  try {
    if (verifiedInstallState) {
      return Response.redirect(
        getGitHubUserAuthorizationUrl(
          createInstallState(
            currentUser.id,
            "verify-installation",
            installationId,
          ),
        ),
        302,
      );
    }

    if (isInstallationUpdate) {
      const [existingWorkspace] = await db
        .select({ workspace })
        .from(workspaceMember)
        .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
        .where(
          and(
            eq(workspaceMember.userId, currentUser.id),
            eq(workspace.provider, "github"),
            eq(workspace.providerInstallationId, installationId),
            ne(workspace.connectionStatus, "deleted"),
          ),
        )
        .limit(1);

      if (!existingWorkspace) {
        return status(404, { error: "Workspace not found" });
      }

      const installation = await getGitHubInstallation(installationId);
      const repositories =
        await listGitHubInstallationRepositories(installationId);

      await syncWorkspaceRepositories(
        existingWorkspace.workspace.id,
        repositories,
        installation.repository_selection,
      );

      return redirectToDashboard(existingWorkspace.workspace.id);
    }

    return status(400, { error: "Invalid GitHub installation callback" });
  } catch (error) {
    console.error("Failed to connect GitHub installation", error);
    return status(502, { error: "Failed to connect GitHub installation" });
  }
};

export const githubRoutes = protectedRoute("/github")
  .get("/install-url", ({ user: currentUser, status }) => {
    try {
      return {
        url: getGitHubInstallUrl(createInstallState(currentUser.id)),
      };
    } catch {
      return status(503, { error: "GitHub App is not configured" });
    }
  })
  .get("/callback", ({ query, user, status }) =>
    handleInstallationCallback({ query, user, status }),
  )
  .get("/installation", ({ query, user, status }) =>
    handleInstallationCallback({ query, user, status }),
  )
  .post("/sync", async ({ user: currentUser, status }) => {
    const workspaces = await db
      .select({ workspace })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(
        and(
          eq(workspaceMember.userId, currentUser.id),
          eq(workspace.provider, "github"),
        ),
      );

    try {
      for (const row of workspaces) {
        const repositories = await listGitHubInstallationRepositories(
          row.workspace.providerInstallationId,
        );

        await syncWorkspaceRepositories(row.workspace.id, repositories);
      }

      return {
        synced: workspaces.length,
      };
    } catch (error) {
      console.error("Failed to sync GitHub workspaces", error);
      return status(502, { error: "Failed to sync GitHub workspaces" });
    }
  });
