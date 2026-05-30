import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../db/client";
import { webhookEvent, workspace } from "../../db/schema";
import { createGitHubWebhooks } from "../../services/github";

type GitHubWebhookPayload = {
  action?: string;
  installation?: {
    id: number;
  };
};

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

    await db
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
      });

    if (eventName === "installation") {
      await updateWorkspaceConnectionStatus(
        payload.installation?.id,
        payload.action,
      );
    }

    return {
      ok: true,
    };
  },
);
