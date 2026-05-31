import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../db/client";
import { webhookEvent, workspace, type ProviderActor } from "../../db/schema";
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
    body?: string | null;
    html_url?: string;
    state?: "open" | "closed";
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
    closed_at?: string | null;
    updated_at?: string;
    created_at?: string;
    base?: {
      ref?: string;
    };
    head?: {
      ref?: string;
      sha?: string;
    };
    user?: GitHubWebhookActor;
  };
  sender?: GitHubWebhookActor;
  issue?: {
    number?: number;
    pull_request?: unknown;
  };
};

type GitHubWebhookActor = {
  id: number;
  login: string;
  avatar_url?: string | null;
  html_url?: string | null;
};

const toProviderActor = (
  actor: GitHubWebhookActor | null | undefined,
): ProviderActor | null =>
  actor
    ? {
        id: String(actor.id),
        login: actor.login,
        avatarUrl: actor.avatar_url ?? null,
        htmlUrl: actor.html_url ?? null,
      }
    : null;

const pullRequestEventNames = new Set([
  "pull_request",
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
]);
const pullRequestLifecycleActions = new Set([
  "opened",
  "closed",
  "reopened",
  "ready_for_review",
  "converted_to_draft",
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

          if (
            eventName === "pull_request" &&
            payload.action &&
            pullRequestLifecycleActions.has(payload.action)
          ) {
            const action =
              payload.action === "closed" && savedPullRequest.state === "merged"
                ? "merged"
                : payload.action;

            await addPullRequestLifecycleEvent(
              savedPullRequest.id,
              deliveryId,
              action,
              {
                author: toProviderActor(
                  payload.sender ?? payload.pull_request?.user,
                ),
                body: payload.pull_request?.body ?? null,
                htmlUrl:
                  payload.pull_request?.html_url ?? savedPullRequest.htmlUrl,
                providerCreatedAt: payload.pull_request?.updated_at
                  ? new Date(payload.pull_request.updated_at)
                  : new Date(),
                providerUpdatedAt: payload.pull_request?.updated_at
                  ? new Date(payload.pull_request.updated_at)
                  : new Date(),
                metadata: {
                  state: savedPullRequest.state,
                  draft: savedPullRequest.draft,
                  baseRef:
                    payload.pull_request?.base?.ref ?? savedPullRequest.baseRef,
                  headRef:
                    payload.pull_request?.head?.ref ?? savedPullRequest.headRef,
                  headSha:
                    payload.pull_request?.head?.sha ?? savedPullRequest.headSha,
                  closedAt: payload.pull_request?.closed_at ?? null,
                  mergedAt: payload.pull_request?.merged_at ?? null,
                },
              },
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
