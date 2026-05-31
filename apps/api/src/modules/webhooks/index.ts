import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../db/client";
import { webhookEvent, workspace } from "../../db/schema";
import {
  createGitHubWebhooks,
  listGitHubInstallationRepositories,
} from "../../services/github";
import { syncWorkspaceRepositories } from "../../services/workspaces";
import {
  addPullRequestLifecycleEvent,
  getTrackedPullRequestNumbers,
  getTrackedRepositoryForWebhook,
  syncGitHubPullRequest,
} from "../../services/pull-requests";

type GitHubWebhookPayload = {
  action?: string;
  installation?: {
    id: number;
    repository_selection?: "all" | "selected";
  };
  repository?: {
    id?: number;
  };
  pull_request?: {
    number?: number;
    updated_at?: string;
  };
  issue?: {
    number?: number;
    pull_request?: unknown;
  };
};

const pullRequestEventNames = new Set([
  "pull_request",
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
]);

const findWorkspaceByInstallationId = async (installationId?: number) => {
  if (!installationId) {
    return null;
  }

  return db.query.workspace.findFirst({
    where: eq(workspace.providerInstallationId, String(installationId)),
  });
};

const updateWorkspaceConnectionStatus = async (
  installationId: number | undefined,
  action: string | undefined,
) => {
  if (!installationId) {
    return;
  }

  const connectionStatus =
    action === "deleted"
      ? "deleted"
      : action === "suspend"
        ? "suspended"
        : action === "unsuspend" || action === "created"
          ? "active"
          : null;

  if (!connectionStatus) {
    return;
  }

  await db
    .update(workspace)
    .set({
      connectionStatus,
      updatedAt: new Date(),
    })
    .where(eq(workspace.providerInstallationId, String(installationId)));
};

export const webhookRoutes = new Elysia({ prefix: "/webhooks" }).post(
  "/github",
  async ({ request, status }) => {
    const deliveryId = request.headers.get("x-github-delivery");
    const eventName = request.headers.get("x-github-event");
    const signature = request.headers.get("x-hub-signature-256");
    const payloadText = await request.text();

    if (!deliveryId || !eventName || !signature) {
      return status(400, { error: "Missing GitHub webhook headers" });
    }

    try {
      const webhooks = createGitHubWebhooks();
      const isValid = await webhooks.verify(payloadText, signature);

      if (!isValid) {
        return status(401, { error: "Invalid GitHub webhook signature" });
      }
    } catch {
      return status(503, { error: "GitHub webhooks are not configured" });
    }

    let payload: GitHubWebhookPayload;

    try {
      payload = JSON.parse(payloadText) as GitHubWebhookPayload;
    } catch {
      return status(400, { error: "Invalid GitHub webhook payload" });
    }
    const relatedWorkspace = await findWorkspaceByInstallationId(
      payload.installation?.id,
    );

    const [savedWebhookEvent] = await db
      .insert(webhookEvent)
      .values({
        id: randomUUID(),
        provider: "github",
        deliveryId,
        eventName,
        action: payload.action ?? null,
        workspaceId: relatedWorkspace?.id ?? null,
        payload: payload as Record<string, unknown>,
      })
      .onConflictDoNothing({
        target: [webhookEvent.provider, webhookEvent.deliveryId],
      })
      .returning();

    const event =
      savedWebhookEvent ??
      (await db.query.webhookEvent.findFirst({
        where: eq(webhookEvent.deliveryId, deliveryId),
      }));

    if (!event || event.processedAt) {
      return {
        ok: true,
      };
    }

    try {
      if (eventName === "installation") {
        await updateWorkspaceConnectionStatus(
          payload.installation?.id,
          payload.action,
        );
      }

      if (eventName === "installation_repositories" && relatedWorkspace) {
        const repositories = await listGitHubInstallationRepositories(
          relatedWorkspace.providerInstallationId,
        );

        await syncWorkspaceRepositories(
          relatedWorkspace.id,
          repositories,
          payload.installation?.repository_selection,
        );
      }

      if (pullRequestEventNames.has(eventName) && relatedWorkspace) {
        const repo = await getTrackedRepositoryForWebhook(
          relatedWorkspace.id,
          payload.repository?.id,
        );
        const number = getTrackedPullRequestNumbers(payload);

        if (repo && number) {
          const savedPullRequest = await syncGitHubPullRequest(repo, number);

          if (eventName === "pull_request" && payload.action) {
            const action =
              payload.action === "closed" && savedPullRequest.state === "merged"
                ? "merged"
                : payload.action;

            await addPullRequestLifecycleEvent(
              savedPullRequest.id,
              deliveryId,
              action,
              payload.pull_request?.updated_at
                ? new Date(payload.pull_request.updated_at)
                : new Date(),
            );
          }
        }
      }

      await db
        .update(webhookEvent)
        .set({
          processedAt: new Date(),
          processingError: null,
        })
        .where(eq(webhookEvent.id, event.id));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown webhook processing error";

      await db
        .update(webhookEvent)
        .set({
          processingError: message,
        })
        .where(eq(webhookEvent.id, event.id));

      console.error("Failed to process GitHub webhook", error);
      return status(502, { error: "Failed to process GitHub webhook" });
    }

    return {
      ok: true,
    };
  },
);
