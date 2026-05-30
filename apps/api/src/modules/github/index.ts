import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { protectedRoute } from "../../app/auth";
import { db } from "../../db/client";
import { workspace, workspaceMember } from "../../db/schema";
import { env } from "../../env";
import {
  getGitHubInstallUrl,
  getGitHubInstallation,
  listGitHubInstallationRepositories,
} from "../../services/github";
import {
  syncWorkspaceRepositories,
  upsertGitHubWorkspace,
} from "../../services/workspaces";

type InstallState = {
  userId: string;
  nonce: string;
  expiresAt: number;
};

const sign = (payload: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url");

const createInstallState = (userId: string) => {
  const state: InstallState = {
    userId,
    nonce: randomUUID(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");

  return `${payload}.${sign(payload)}`;
};

const verifyInstallState = (state: string, userId: string) => {
  const [payload, signature] = state.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = sign(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as InstallState;

    return parsed.userId === userId && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
};

const redirectToDashboard = (workspaceId?: string) => {
  const url = new URL("/dashboard", env.FRONTEND_URL);

  if (workspaceId) {
    url.searchParams.set("workspaceId", workspaceId);
  }

  return Response.redirect(url, 302);
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

  if (!installationId || !state || !verifyInstallState(state, currentUser.id)) {
    return status(400, { error: "Invalid GitHub installation callback" });
  }

  try {
    const installation = await getGitHubInstallation(installationId);
    const savedWorkspace = await upsertGitHubWorkspace(
      installation,
      currentUser.id,
    );
    const repositories =
      await listGitHubInstallationRepositories(installationId);

    await syncWorkspaceRepositories(savedWorkspace.id, repositories);

    return redirectToDashboard(savedWorkspace.id);
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
