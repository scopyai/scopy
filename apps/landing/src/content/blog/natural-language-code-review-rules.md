---
title: "How to Write Natural-Language Code Review Rules"
description: "Learn how to write precise natural-language code review rules for AI reviewers, with patterns, examples, scope, exceptions and a practical testing process."
date: "2026-07-04"
author: "Matt, founder"
tags: "code review rules, AI code review, coding standards, pull requests"
---

Every engineering team has rules that are real but not quite formal enough for a linter. Background jobs must be safe to retry, tenant-owned records need workspace scope, and authentication routes shouldn't log request bodies. Usually these rules are enforced by whoever happens to remember them during review.

These rules often live in review comments, onboarding conversations and the memory of one senior engineer who is, inconveniently, on holiday. Natural-language code review rules let an AI reviewer apply them consistently to every pull request.

Writing a useful rule isn't the same as writing a slogan. “Ensure best practices” sounds responsible and tells the reviewer almost nothing. A strong rule describes where it applies, what to detect, why it matters and what exceptions are legitimate.

## The anatomy of a good review rule

Use this structure:

> **When** [scope or trigger], **require/flag** [observable condition], **because** [risk]. **Allow** [specific exceptions].

For example:

> When a database query reads or modifies a workspace-owned record, require the query to be scoped by the current workspace ID, because IDs alone do not enforce tenant isolation. Global administration jobs may omit workspace scope when they use the dedicated admin database client.

The rule now says where it applies, what behavior is expected, why it matters and which exception is legitimate. That's enough context for a useful finding, and enough for an engineer to disagree with it when the exception applies.

Without an exception, a broadly correct rule can generate confidently irrelevant comments.

## Rule 1: Describe observable evidence

Weak:

> Make sure the code is secure.

Stronger:

> In authenticated API handlers, verify authorization against the specific resource or its workspace before reading or modifying it. Do not treat authentication alone as authorization.

The stronger rule tells the reviewer what evidence to look for. “Secure” is an outcome; resource-scoped authorization is a reviewable condition.

The same problem appears with “handle errors properly”, “write clean code”, “optimize performance” and “use best practices”. They sound responsible but two experienced reviewers can interpret them in completely different ways.

If two experienced reviewers could interpret a rule in opposite ways, it needs more detail.

## Rule 2: Narrow the scope

Weak:

> Do not use `fetch`.

Stronger:

> In `apps/web`, do not call backend endpoints with raw `fetch`. Use the generated typed API client so requests share authentication, error handling and response types. Calls to unrelated third-party services may use the project’s external-request helper.

The folder scope prevents the reviewer from flagging server-side integrations or build scripts. The reason helps it recognize wrappers that violate the spirit of the rule. The exception prevents a local convention from becoming a universal ban on a standard platform API.

Scope can be a package, a path, an API route, database access or a security-sensitive operation. Apply a rule only where the team would enforce it manually; a frontend convention should not unexpectedly become a rule for every script in the repository.

## Rule 3: Explain the risk

Compare:

> Queue jobs must be idempotent.

with:

> Queue workers may receive the same job more than once. Before adding an external side effect such as charging, emailing or creating a record, require an idempotency check or a uniqueness constraint that makes repeated execution safe.

The second rule explains why the convention exists and identifies the operations where it matters. That context helps the reviewer distinguish harmless repeated computation from a duplicated payment.

Reasons also make comments more useful to authors. A good review teaches the constraint instead of just announcing that some rule was broken.

## Rule 4: Include legitimate exceptions

Rules without exceptions become noise generators.

Suppose the team says:

> Never log request bodies.

That may be too broad for a webhook troubleshooting service whose payloads contain no secrets. A more precise version is:

> Do not log raw request bodies for authentication, billing or user-content endpoints because they may contain credentials or personal data. For signed provider webhooks, log only explicitly allowlisted diagnostic fields.

An exception should be narrow and checkable. “Unless necessary” isn't a real exception, because nobody can tell when it applies.

## Rule 5: Provide positive and negative examples

Examples are useful when the rule depends on a local pattern.

```md
Rule: API routes must use the workspace-scoped repository after membership has
been established.

Good:
const repo = createWorkspaceRepository(db, membership.workspaceId)
return repo.invitations.findById(params.id)

Bad:
return db.query.invitations.findFirst({
  where: eq(invitations.id, params.id)
})

Reason: Invitation IDs do not establish that the current user belongs to the
owning workspace.
```

Examples should illustrate the distinguishing feature, not prescribe an entire implementation. Otherwise the reviewer may reject safe alternatives that look different.

## Rule 6: Ask for findings, not broad redesigns

AI reviewers are most useful when they identify a concrete risk on a specific change.

Risky rule:

> Suggest opportunities to improve architecture.

Better:

> Flag a new dependency from a lower-level package to a higher-level application package when it creates a cycle or violates the dependency direction documented in `ARCHITECTURE.md`. Do not suggest unrelated refactors.

The better rule keeps the review anchored to the pull request. Otherwise a small bug fix can come back with an unasked-for plan to rebuild the architecture.

## Rule 7: Define severity

Not every violation should block a merge. State what matters:

```md
Blocking: A new tenant-owned query is not scoped to the current tenant.

Warning: A query is correctly scoped but bypasses the preferred repository
helper, making future enforcement harder.

Do not comment: Naming or formatting differences already covered by the linter.
```

Severity guidance stops style preferences from looking as urgent as correctness and security issues. In my experience this matters almost as much as the wording of the rule itself because noisy reviewers are ignored very quickly.

## Example natural-language rules

### Tenant isolation

> For reads and writes of workspace-owned records, require workspace scope from the authenticated membership. Flag lookups by record ID alone unless the dedicated global-admin path is used.

### Authorization

> In mutation endpoints, verify permission on the affected resource server-side. Hiding or disabling a client-side control is not sufficient authorization.

### Idempotent jobs

> Queue workers that create records, send messages or charge accounts must remain safe when the same job is delivered more than once. Look for uniqueness constraints, idempotency keys or an equivalent persisted guard.

### Transactions

> When multiple database writes must either all succeed or all fail to preserve an invariant, require a transaction. Do not request transactions for independent analytics or best-effort logging.

### Sensitive logging

> Do not log credentials, authorization headers, raw request bodies, private source code or provider responses containing user data. Prefer stable identifiers and allowlisted diagnostic fields.

### API client usage

> Frontend code must use the typed API client for first-party backend requests. Flag raw `fetch` calls to first-party endpoints because they bypass shared authentication and typed errors.

### Database migrations

> Migrations on populated tables must be safe during rolling deployment. Flag adding a required column without a default or staged backfill when older application instances may still write rows.

### Time and units

> When passing durations, sizes or currency values across module boundaries, require the unit to be explicit in the type, variable name or shared contract. Flag conversions that rely on an undocumented assumption.

### Retry behavior

> Do not retry non-idempotent external requests automatically unless the provider supports an idempotency key or the application persists an equivalent deduplication mechanism.

### Test quality

> For bug fixes, require a regression test that fails when the fix is removed. Flag tests that only assert a mock was called when the user-visible behavior can be asserted directly.

## Test rules like code

A review rule isn't finished when it sounds good. Run it against examples from the repository.

Use a few changes the rule should flag, a few similar changes it should leave alone and at least one real exception. For every result, check whether the finding is correct, points to useful evidence and gives the author enough information to act. Ambiguous cases should be allowed to remain human decisions.

Revise the rule when false positives share a pattern. Add scope or an exception instead of piling on vague instructions such as “be careful not to over-report.”

## Know when to write a static rule instead

Natural language isn't the best tool for every convention. If a violation can be detected exactly and occurs often, enforce it with types, tests, linting or static analysis.

Good candidates for deterministic enforcement include:

- Forbidden imports
- File naming
- Required function arguments
- Formatting
- Dependency direction
- Known insecure API calls

Use AI review for rules that require meaning, context or judgment. The distinction is covered in more detail in [AI code review vs static analysis](/blog/ai-code-review-vs-static-analysis).

## Start with five rules, not fifty

Choose a small set based on real bugs and the review comments your team keeps repeating. Measure the results, refine them, and add more only when reviewers trust the signal.

A good review rule writes down part of your team's engineering culture. It captures why the team does something, applies that reason consistently, and still leaves room for justified exceptions.

For a wider review process, use the [code review checklist for AI-generated code](/blog/code-review-checklist-ai-generated-code) and the [pull request description template](/blog/pull-request-description-template) to give both human and AI reviewers better intent.
