---
title: "Why Diff-Only Code Review Misses Bugs"
description: "A Git diff shows what changed, but many bugs depend on code that did not. See concrete examples of how repository context makes human and AI code review more accurate."
date: "2026-07-08"
author: "Matt, founder"
tags: "code review, Git diff, repository context, AI code review"
---

A Git diff shows what changed. It does not show everything the change affects, and that difference is responsible for a surprising number of review mistakes.

That distinction sounds small until a pull request changes one function and breaks three callers, violates a convention defined elsewhere or passes a value whose unit only becomes obvious two files downstream. The faulty line is visible in the diff; the reason it is faulty is not.

Human reviewers compensate by opening related files, following symbols and searching the repository. An AI code reviewer needs to do the same. If the model receives only the patch, better prompting cannot recover a contract that was never included.

Here are the most common classes of bugs a diff cannot explain on its own.

## A diff shows edits, not contracts

Consider this change:

```ts
- await reserveCredits(workspace.id, reviewableLines)
+ await reserveCredits(workspace.id, pullRequest.changedLines)
```

The new code is valid TypeScript. The names look compatible. Nothing in the diff proves that it is wrong.

Elsewhere in the repository, however, `reviewableLines` may exclude generated files and ignored paths, while `changedLines` includes everything GitHub reports. The function’s contract expects billable lines, not raw changed lines. A diff-only review sees a tidy refactor; a repository-aware review can see an accidental billing change.

The missing context may be a caller, a type definition, a database constraint or a configuration default. Sometimes it is just a comment explaining why an ugly workaround cannot be removed yet.

Code rarely carries its entire meaning on the edited line.

## Example 1: The authorization check in another layer

Imagine a new route:

```ts
app.delete("/invitations/:id", async ({ params, user }) => {
  if (!user) throw new UnauthorizedError()
  return invitationService.remove(params.id)
})
```

Within the diff, the route checks authentication and delegates cleanly. Whether it is secure depends on the service:

```ts
async function remove(id: string) {
  return db.delete(invitations).where(eq(invitations.id, id))
}
```

Nothing scopes the invitation to the user’s workspace or verifies an administrator role. The change is vulnerable to an insecure direct object reference, but the evidence is divided across changed and unchanged files.

A good review follows the call. Who owns this invitation, where is membership checked and does the service assume that authorization happened earlier? Looking at similar routes usually answers those questions faster than staring at the changed handler.

This pattern appears constantly in layered applications because authorization responsibilities are rarely obvious from one function.

## Example 2: A unit mismatch with perfect types

```ts
const expiresAt = new Date(Date.now() + config.sessionTtl)
```

Looks reasonable. `sessionTtl` is a number. The constructor accepts a number. The compiler is delighted.

But suppose the configuration schema defines `sessionTtl` in seconds while JavaScript timestamps use milliseconds. The session expires roughly one thousand times earlier than intended. No type error, no suspicious syntax, and possibly no failing test if the test configuration uses a very large value.

The necessary context lives in the configuration parser or documentation:

```ts
sessionTtl: z.coerce.number().default(3600) // seconds
```

Repository context is not merely “more code.” It is the code that defines meaning.

## Example 3: A caller depends on an old side effect

Suppose a refactor makes this function cleaner:

```ts
async function updateRepository(input: RepositoryUpdate) {
  return repositoryStore.update(input)
}
```

The old version also invalidated a cache and scheduled a resync. The new implementation returns the correct record, so its local tests pass. A caller elsewhere assumes that updating a repository will eventually refresh GitHub state.

Reviewing the function alone encourages a narrow question: “Does this update the repository?” Following its consumers reveals the real question: “What observable behavior has the rest of the system come to expect from this operation?”

Side effects make diff-only review particularly fragile. Cache invalidation, event publication, job scheduling and cleanup are easy to remove and hard to notice because the edited function often looks cleaner afterwards.

## Example 4: The repository already has a safer pattern

A pull request adds a request like this:

```ts
const response = await fetch(`/api/repositories/${id}`)
```

The call may work. But the repository might require a generated, typed API client that attaches authentication, normalizes errors and refreshes expired sessions.

The problem is not visible from the new line. It becomes visible when you search for other API calls.

The same problem appears when code bypasses a shared authorization helper, uses raw SQL instead of the tenant-scoped repository, or reads environment variables outside the validated configuration module. These are not just style differences. The established helper often holds fixes and constraints you cannot see at the call site.

These are not cosmetic conventions. A plain-looking helper often carries years of accumulated bug fixes.

## Example 5: A schema change breaks an unedited consumer

Suppose an API response changes from:

```json
{ "status": "complete" }
```

to:

```json
{ "state": "complete" }
```

The server diff may update its type and tests. A background worker, CLI package or external integration can still read `status`. In a monorepo, repository search can find those consumers. A review restricted to changed files cannot.

This matters most for public APIs, shared packages, migrations, event payloads and queue jobs because their consumers are often far away from the code being edited.

The absence of a changed consumer does not mean there are no consumers. Sometimes it means the pull request forgot them.

## How much context is enough?

“Read the whole repository” sounds safe but usually wastes effort. Large codebases hold far more text than a reviewer, or a model, can weigh at once. Too much irrelevant context can bury the relationship that matters.

A better approach works outward from the diff. Start with the whole changed function rather than the edited lines alone, then follow the types it references, the calls that matter and the consumers downstream. Pull in similar code, tests, configuration and schema only when they help explain the behavior under review.

The goal is not the most context. It is the smallest context that still holds the relevant contracts.

## A repository-context checklist for human reviewers

When a change is important, do not stop at the Files Changed tab. Check:

- Definitions of new or modified types
- Callers of changed public functions
- Implementations called by new routes or handlers
- Related database schema and migrations
- Configuration units, defaults and validation
- Similar code elsewhere in the repository
- Existing tests for the surrounding behavior
- Documentation or comments describing non-obvious constraints
- Other packages consuming changed APIs, events or shared types

You do not need to perform a grand tour of the monorepo for every typo. Review depth should follow risk.

## What this means for AI code review

An LLM can only reason from the context it receives. A powerful model with an incomplete view will give you articulate feedback about the wrong boundaries. Better prompting cannot recover a contract that was never provided.

When you evaluate an AI code reviewer, look at what happens before the model is called. Does it get complete functions or just patch fragments? Can it resolve symbols, find callers and include related tests? In a large repository, how does it decide what context is relevant? This retrieval step is a core part of the reviewer, not plumbing you can ignore.

## Review the change in the system it joins

The diff remains the right starting point. It tells reviewers where human intent touched the repository. But reliable code review moves outward from those lines until it understands the contracts they participate in.

That principle holds whether the reviewer is a teammate or an AI tool: inspect the change, follow the relationships, and review how the system behaves, not just the lines that turned red and green.

For a repeatable process, use the [code review checklist for AI-generated code](/blog/code-review-checklist-ai-generated-code). To understand where other automated tools fit, read [AI code review vs static analysis](/blog/ai-code-review-vs-static-analysis).
