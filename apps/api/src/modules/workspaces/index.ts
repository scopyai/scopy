import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { protectedRoute } from "../auth"
import { db } from "../../db/client"
import { checkRateLimit } from "../../lib/rate-limit"
import {
  repository,
  pullRequest,
  pullRequestTimelineEvent,
  user,
  workspace,
  workspaceMember,
} from "../../db/schema"
import {
  getWorkspaceMembershipForUser,
  inviteWorkspaceMemberByEmail,
  getPullRequestForUser,
  getRepositoryForUser,
  requireWorkspaceForUser,
  submitRepositoryPullRequestSync,
  syncGitHubWorkspaceRepositories,
} from "./service"
import { syncGitHubPullRequest } from "../pull-requests/service"
import {
  normalizeReviewConfigOverrides,
  repositoryReviewConfigUpdateSchema,
  resolveReviewConfig,
  workspaceReviewConfigUpdateSchema,
  type ReviewConfigOverrides,
  type ReviewConfigValues,
} from "../reviews/review-config"

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const inviteWorkspaceMemberSchema = z.object({
  email: z.email(),
  role: z.enum(["admin", "member"]).default("member"),
})
const inviteWorkspaceMemberRateLimit = {
  limit: 10,
  windowMs: 10 * 60 * 1000,
}

const updateWorkspaceMemberSchema = z.object({
  role: z.enum(["admin", "member"]),
})

const updateRepositorySchema = z.object({
  enabled: z.boolean().optional(),
  excludedDocLibraries: z.array(z.string().min(1).max(100)).max(200).optional(),
})

const onboardingRepositoriesSchema = z.object({
  repositoryIds: z.array(z.string().min(1).max(100)).max(10_000).default([]),
})

const selectReviewConfigValues = (
  config: ReviewConfigValues
): ReviewConfigValues => ({
  reviewDrafts: config.reviewDrafts,
  baseBranchPatterns: config.baseBranchPatterns,
  pathIncludePatterns: config.pathIncludePatterns,
  pathExcludePatterns: config.pathExcludePatterns,
  naturalLanguageRules: config.naturalLanguageRules,
  maxReviewChangedLines: config.maxReviewChangedLines,
})

const selectReviewConfigOverrides = (
  config: ReviewConfigOverrides | null | undefined
): ReviewConfigOverrides => ({
  reviewDrafts: config?.reviewDrafts ?? null,
  baseBranchPatterns: config?.baseBranchPatterns ?? null,
  pathIncludePatterns: config?.pathIncludePatterns ?? null,
  pathExcludePatterns: config?.pathExcludePatterns ?? null,
  naturalLanguageRules: config?.naturalLanguageRules ?? null,
  maxReviewChangedLines: config?.maxReviewChangedLines ?? null,
})

export const workspaceRoutes = protectedRoute("/workspaces")
  .get("/", async ({ user: currentUser }) => {
    return db
      .select({
        workspace: {
          id: workspace.id,
          provider: workspace.provider,
          providerAccountLogin: workspace.providerAccountLogin,
          providerAccountType: workspace.providerAccountType,
          providerAccountAvatarUrl: workspace.providerAccountAvatarUrl,
          name: workspace.name,
          connectionStatus: workspace.connectionStatus,
        },
        role: workspaceMember.role,
        status: workspaceMember.status,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, currentUser.id))
      .orderBy(asc(workspace.name))
  })
  .get("/:workspaceId", async ({ params, user: currentUser }) => {
    return requireWorkspaceForUser(
      params.workspaceId,
      currentUser.id
    )
  })
  .get(
    "/:workspaceId/github-links",
    async ({ params, user: currentUser }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id
      )

      const ws = workspaceWithRole.workspace

      if (ws.connectionStatus === "deleted") {
        return {
          action: "reinstall" as const,
        }
      }

      const installationSettingsUrl =
        ws.providerAccountType === "organization"
          ? `https://github.com/organizations/${ws.providerAccountLogin}/settings/installations/${ws.providerInstallationId}`
          : `https://github.com/settings/installations/${ws.providerInstallationId}`

      return {
        action: "configure" as const,
        installationSettingsUrl,
      }
    }
  )
  .patch(
    "/:workspaceId",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = updateWorkspaceSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid workspace update" })
      }

      await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      const [updatedWorkspace] = await db
        .update(workspace)
        .set({
          name: parsed.data.name,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, params.workspaceId))
        .returning()

      return updatedWorkspace
    }
  )
  .get(
    "/:workspaceId/review-config",
    async ({ params, user: currentUser }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id
      )

      return selectReviewConfigValues(workspaceWithRole.workspace)
    }
  )
  .patch(
    "/:workspaceId/review-config",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = workspaceReviewConfigUpdateSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid review config update" })
      }

      await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      const updatedWorkspace = await db.transaction(async (tx) => {
        const now = new Date()
        const [updated] = await tx
          .update(workspace)
          .set({ ...parsed.data, updatedAt: now })
          .where(eq(workspace.id, params.workspaceId))
          .returning()

        const workspaceDefaults = selectReviewConfigValues(updated!)
        const repositories = await tx
          .select()
          .from(repository)
          .where(eq(repository.workspaceId, params.workspaceId))

        for (const repo of repositories) {
          const normalized = normalizeReviewConfigOverrides(
            workspaceDefaults,
            selectReviewConfigOverrides(repo)
          )
          await tx
            .update(repository)
            .set({ ...normalized, updatedAt: now })
            .where(eq(repository.id, repo.id))
        }

        return updated!
      })

      return selectReviewConfigValues(updatedWorkspace)
    }
  )
  .delete("/:workspaceId", async ({ params, user: currentUser, status }) => {
    await requireWorkspaceForUser(
      params.workspaceId,
      currentUser.id,
      ["owner"]
    )

    return status(409, { error: "Workspace owners cannot leave yet" })
  })
  .get(
    "/:workspaceId/members",
    async ({ params, user: currentUser }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id
      )

      const memberConditions = [
        eq(workspaceMember.workspaceId, params.workspaceId),
      ]

      if (!["owner", "admin"].includes(workspaceWithRole.role)) {
        memberConditions.push(eq(workspaceMember.status, "active"))
      }

      return db
        .select({
          id: workspaceMember.id,
          role: workspaceMember.role,
          status: workspaceMember.status,
          invitedAt: workspaceMember.invitedAt,
          acceptedAt: workspaceMember.acceptedAt,
          createdAt: workspaceMember.createdAt,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
        })
        .from(workspaceMember)
        .innerJoin(user, eq(user.id, workspaceMember.userId))
        .where(and(...memberConditions))
        .orderBy(asc(user.name))
    }
  )
  .post(
    "/:workspaceId/members",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = inviteWorkspaceMemberSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid member invite" })
      }

      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      if (parsed.data.role === "admin" && workspaceWithRole.role !== "owner") {
        return status(403, { error: "Only workspace owners can invite admins" })
      }

      const inviteRateLimit = checkRateLimit({
        key: `workspace-member-invite:${params.workspaceId}:${currentUser.id}`,
        ...inviteWorkspaceMemberRateLimit,
      })

      if (!inviteRateLimit.allowed) {
        return status(429, {
          error: "Too many member invites",
          retryAfterSeconds: inviteRateLimit.retryAfterSeconds,
        })
      }

      const inviteResult = await inviteWorkspaceMemberByEmail({
        workspaceId: params.workspaceId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedByUserId: currentUser.id,
      })

      if (!inviteResult) {
        return status(404, { error: "User not found" })
      }

      if (inviteResult.status === "already_member") {
        return status(409, { error: "User is already a workspace member" })
      }

      return inviteResult.membership
    }
  )
  .post(
    "/:workspaceId/members/accept",
    async ({ params, user: currentUser, status }) => {
      const existingMembership = await getWorkspaceMembershipForUser(
        params.workspaceId,
        currentUser.id
      )

      if (!existingMembership) {
        return status(404, { error: "Workspace invitation not found" })
      }

      if (existingMembership.status === "active") {
        return existingMembership
      }

      const now = new Date()
      const [acceptedMembership] = await db
        .update(workspaceMember)
        .set({
          status: "active",
          acceptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaceMember.workspaceId, params.workspaceId),
            eq(workspaceMember.userId, currentUser.id),
            eq(workspaceMember.status, "pending")
          )
        )
        .returning()

      if (!acceptedMembership) {
        return status(404, { error: "Workspace invitation not found" })
      }

      return acceptedMembership
    }
  )
  .delete(
    "/:workspaceId/members/me",
    async ({ params, user: currentUser, status }) => {
      const existingMembership = await getWorkspaceMembershipForUser(
        params.workspaceId,
        currentUser.id
      )

      if (!existingMembership) {
        return status(404, { error: "Workspace membership not found" })
      }

      if (
        existingMembership.status === "active" &&
        existingMembership.role === "owner"
      ) {
        return status(409, { error: "Workspace owners cannot leave yet" })
      }

      const [removedMembership] = await db
        .delete(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, params.workspaceId),
            eq(workspaceMember.userId, currentUser.id)
          )
        )
        .returning()

      return removedMembership
    }
  )
  .patch(
    "/:workspaceId/members/:memberId",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = updateWorkspaceMemberSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid member update" })
      }

      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      if (workspaceWithRole.role === "admin" && parsed.data.role === "admin") {
        return status(403, { error: "Admins cannot promote workspace admins" })
      }

      const memberToUpdate = await db.query.workspaceMember.findFirst({
        where: and(
          eq(workspaceMember.id, params.memberId),
          eq(workspaceMember.workspaceId, params.workspaceId)
        ),
      })

      if (!memberToUpdate) {
        return status(404, { error: "Workspace member not found" })
      }

      if (memberToUpdate.userId === currentUser.id) {
        return status(409, {
          error: "Workspace members cannot update themselves",
        })
      }

      if (memberToUpdate.role === "owner") {
        return status(409, { error: "Workspace owners cannot be updated yet" })
      }

      if (
        workspaceWithRole.role === "admin" &&
        memberToUpdate.role !== "member"
      ) {
        return status(403, { error: "Admins can only update members" })
      }

      const [updatedMembership] = await db
        .update(workspaceMember)
        .set({
          role: parsed.data.role,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceMember.id, params.memberId),
            eq(workspaceMember.workspaceId, params.workspaceId)
          )
        )
        .returning()

      return updatedMembership
    }
  )
  .delete(
    "/:workspaceId/members/:memberId",
    async ({ params, user: currentUser, status }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      const memberToRemove = await db.query.workspaceMember.findFirst({
        where: and(
          eq(workspaceMember.id, params.memberId),
          eq(workspaceMember.workspaceId, params.workspaceId)
        ),
      })

      if (!memberToRemove) {
        return status(404, { error: "Workspace member not found" })
      }

      if (memberToRemove.userId === currentUser.id) {
        return status(409, {
          error: "Use the leave workspace endpoint to remove yourself",
        })
      }

      if (memberToRemove.role === "owner") {
        return status(409, { error: "Workspace owners cannot be removed yet" })
      }

      if (
        workspaceWithRole.role === "admin" &&
        memberToRemove.role !== "member"
      ) {
        return status(403, { error: "Admins can only remove members" })
      }

      const [removedMembership] = await db
        .delete(workspaceMember)
        .where(
          and(
            eq(workspaceMember.id, params.memberId),
            eq(workspaceMember.workspaceId, params.workspaceId)
          )
        )
        .returning()

      return removedMembership
    }
  )
  .post("/:workspaceId/sync", async ({ params, user: currentUser, status }) => {
    const workspaceWithRole = await requireWorkspaceForUser(
      params.workspaceId,
      currentUser.id,
      ["owner", "admin"]
    )

    try {
      const synced = await syncGitHubWorkspaceRepositories(
        params.workspaceId,
        workspaceWithRole.workspace.providerInstallationId
      )

      return {
        synced,
      }
    } catch (error) {
      console.error("Failed to sync GitHub repositories", error)
      return status(502, { error: "Failed to sync GitHub repositories" })
    }
  })
  .get(
    "/:workspaceId/repositories",
    async ({ params, user: currentUser, query }) => {
      await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id
      )

      const enabled =
        query.enabled === "true"
          ? true
          : query.enabled === "false"
            ? false
            : undefined

      const conditions = [eq(repository.workspaceId, params.workspaceId)]

      if (query.includeUnavailable !== "true") {
        conditions.push(isNull(repository.providerAccessRemovedAt))
      }

      if (enabled !== undefined) {
        conditions.push(eq(repository.enabled, enabled))
      }

      return db
        .select()
        .from(repository)
        .where(and(...conditions))
        .orderBy(asc(repository.fullName))
    }
  )
  .post(
    "/:workspaceId/onboarding/repositories",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = onboardingRepositoriesSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid onboarding repository selection" })
      }

      await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      )

      return db.transaction(async (tx) => {
        const availableRepositories = await tx
          .select({ id: repository.id })
          .from(repository)
          .where(
            and(
              eq(repository.workspaceId, params.workspaceId),
              isNull(repository.providerAccessRemovedAt)
            )
          )

        const availableRepositoryIds = new Set(
          availableRepositories.map((repo) => repo.id)
        )
        const selectedRepositoryIds = [
          ...new Set(
            parsed.data.repositoryIds.filter((id) =>
              availableRepositoryIds.has(id)
            )
          ),
        ]
        const now = new Date()

        await tx
          .update(repository)
          .set({
            enabled: false,
            updatedAt: now,
          })
          .where(
            and(
              eq(repository.workspaceId, params.workspaceId),
              isNull(repository.providerAccessRemovedAt)
            )
          )

        if (selectedRepositoryIds.length) {
          await tx
            .update(repository)
            .set({
              enabled: true,
              updatedAt: now,
            })
            .where(
              and(
                eq(repository.workspaceId, params.workspaceId),
                inArray(repository.id, selectedRepositoryIds),
                isNull(repository.providerAccessRemovedAt)
              )
            )
        }

        await tx
          .update(user)
          .set({
            onboardingStatus: "done",
            updatedAt: now,
          })
          .where(eq(user.id, currentUser.id))

        return {
          enabled: selectedRepositoryIds.length,
          total: availableRepositories.length,
        }
      })
    }
  )
  .get(
    "/:workspaceId/repositories/:repositoryId",
    async ({ params, user: currentUser, status }) => {
      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      return access.repository
    }
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = updateRepositorySchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid repository update" })
      }

      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id,
        { roles: ["owner", "admin"] }
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const existingRepository = access.repository

      if (existingRepository.providerAccessRemovedAt) {
        return status(409, {
          error: "Repository is no longer accessible through the GitHub App",
        })
      }

      const [updatedRepository] = await db
        .update(repository)
        .set({
          ...parsed.data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(repository.id, params.repositoryId),
            eq(repository.workspaceId, params.workspaceId)
          )
        )
        .returning()

      if (!updatedRepository) {
        return status(404, { error: "Repository not found" })
      }

      return updatedRepository
    }
  )
  .get(
    "/:workspaceId/repositories/:repositoryId/pull-requests",
    async ({ params, user: currentUser, status }) => {
      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const repo = access.repository
      if (repo.providerAccessRemovedAt) {
        return status(404, { error: "Repository not found" })
      }

      return db
        .select()
        .from(pullRequest)
        .where(eq(pullRequest.repositoryId, repo.id))
        .orderBy(desc(pullRequest.providerUpdatedAt))
    }
  )
  .post(
    "/:workspaceId/repositories/:repositoryId/pull-requests/sync",
    async ({ params, user: currentUser, status }) => {
      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id,
        { roles: ["owner", "admin"] }
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const repo = access.repository

      if (repo.providerAccessRemovedAt) {
        return status(409, {
          error: "Repository is no longer accessible through the GitHub App",
        })
      }

      try {
        return {
          queued: await submitRepositoryPullRequestSync(repo.id),
        }
      } catch (error) {
        console.error("Failed to queue GitHub pull request sync", error)
        return status(502, {
          error: "Failed to queue GitHub pull request sync",
        })
      }
    }
  )
  .post(
    "/:workspaceId/repositories/:repositoryId/pull-requests/:pullRequestId/sync",
    async ({ params, user: currentUser, status }) => {
      const access = await getPullRequestForUser(
        params.workspaceId,
        params.repositoryId,
        params.pullRequestId,
        currentUser.id
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const row = access

      const rateLimit = checkRateLimit({
        key: `pull-request-sync:${currentUser.id}:${row.pullRequest.id}`,
        limit: 5,
        windowMs: 60_000,
      })
      if (!rateLimit.allowed) {
        return status(429, { error: "Too many pull request refreshes" })
      }

      try {
        return await syncGitHubPullRequest(
          row.repository,
          row.pullRequest.number
        )
      } catch (error) {
        console.error("Failed to sync GitHub pull request", error)
        return status(502, { error: "Failed to sync GitHub pull request" })
      }
    }
  )
  .get(
    "/:workspaceId/repositories/:repositoryId/pull-requests/:pullRequestId",
    async ({ params, user: currentUser, status }) => {
      const access = await getPullRequestForUser(
        params.workspaceId,
        params.repositoryId,
        params.pullRequestId,
        currentUser.id
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const row = access

      const timeline = await db
        .select()
        .from(pullRequestTimelineEvent)
        .where(eq(pullRequestTimelineEvent.pullRequestId, row.pullRequest.id))
        .orderBy(
          asc(pullRequestTimelineEvent.providerCreatedAt),
          asc(pullRequestTimelineEvent.createdAt)
        )

      return {
        ...row.pullRequest,
        timeline: timeline.map((event) => ({
          ...event,
          body: event.deletedAt ? null : event.body,
        })),
      }
    }
  )
  .get(
    "/:workspaceId/repositories/:repositoryId/review-config",
    async ({ params, user: currentUser, status }) => {
      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      return resolveReviewConfig(access.workspace, access.repository)
    }
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId/review-config",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = repositoryReviewConfigUpdateSchema.safeParse(body)

      if (!parsed.success) {
        return status(400, { error: "Invalid review config update" })
      }

      const access = await getRepositoryForUser(
        params.workspaceId,
        params.repositoryId,
        currentUser.id,
        { roles: ["owner", "admin"] }
      )

      if (!access.ok) {
        return status(404, { error: access.error })
      }

      const repo = access.repository

      if (repo.providerAccessRemovedAt) {
        return status(409, {
          error: "Repository is no longer accessible through the GitHub App",
        })
      }

      const workspaceDefaults = selectReviewConfigValues(access.workspace)
      const overrides = normalizeReviewConfigOverrides(workspaceDefaults, {
        ...selectReviewConfigOverrides(repo),
        ...parsed.data,
      })

      await db
        .update(repository)
        .set({ ...overrides, updatedAt: new Date() })
        .where(eq(repository.id, repo.id))

      return resolveReviewConfig(workspaceDefaults, overrides)
    }
  )
