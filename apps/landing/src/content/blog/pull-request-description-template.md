---
title: "Pull Request Description Template for Better Code Reviews"
description: "Copy a practical pull request description template that gives reviewers the context they need, shortens review cycles and improves both human and AI code review."
date: "2026-06-29"
author: "Matt, founder"
tags: "pull request template, PR description, code review, GitHub"
---

A good pull request description is not paperwork. It saves every reviewer from reconstructing the same story from commits, issue comments and whatever they can guess from the diff.

It should explain what changed, why it changed, how it was verified and where the reviewer should spend extra attention. That is usually enough.

This guide gives you a practical pull request description template, examples, and advice for adapting it to your team without turning every three-line fix into an essay.

## Copy this pull request template

```md
## Summary

<!-- What changed? Keep this to 1–3 concise bullets. -->

-

## Why

<!-- What user, product or engineering problem does this solve? -->


## Approach

<!-- Explain important implementation decisions and rejected alternatives. -->


## How to test

<!-- Give reviewers exact steps or commands. Include expected results. -->

1.

## Review focus

<!-- Point reviewers to risky, subtle or uncertain parts of the change. -->

-

## Screenshots or output

<!-- Add before/after visuals, API examples, logs or benchmark results. -->


## Checklist

- [ ] Tests added or updated
- [ ] Documentation updated where needed
- [ ] Migrations and rollback considered
- [ ] Security and permissions reviewed
- [ ] Monitoring or operational impact considered
```

Delete sections that genuinely do not apply. Empty ritual is worse than no template because it trains reviewers to ignore the entire description.

## What each section is for

### Summary: orient the reviewer

The summary should describe the result, not repeat filenames.

Weak:

> Updated `billing.ts`, `plans.ts` and tests.

Better:

> - Charges reviews using reviewable changed lines instead of GitHub’s raw line count.
> - Excludes ignored and generated paths from credit calculation.

The diff already lists modified files. Use the summary to explain the behavior those edits create.

### Why: preserve the reason

Code records the chosen implementation. It rarely preserves the decision that led to it.

Write what was going wrong and who was affected:

> Large generated lockfiles were consuming review credits even though Scopy did not review them. This made usage unpredictable for repositories that update dependencies frequently.

That single paragraph helps a reviewer evaluate whether the solution addresses the actual problem. It also helps the engineer investigating this code six months later, who may otherwise assume the strange filter is decorative.

Link the issue or design document, but summarize the essential context in the PR. Links decay, permissions change and reviewers should not need to open seven tabs before understanding the first line.

### Approach: explain decisions, not syntax

Do not narrate every function. Explain the choices a reviewer cannot infer safely: why this layer owns the behavior, why an existing abstraction was not used, how compatibility is preserved or what constraint made the implementation unusual.

For example:

> Filtering happens before credits are reserved so retries remain idempotent. I considered filtering inside the billing service, but that service intentionally has no repository-path context.

That gives the reviewer something meaningful to challenge. “Created a function called `filterReviewablePaths`” does not.

### How to test: make verification reproducible

“Tests pass” is not a testing guide. Include exact commands or steps and the expected result.

```md
## How to test

1. Run `pnpm --filter api test billing`.
2. Open a PR that changes one source file and `pnpm-lock.yaml`.
3. Confirm the usage preview counts only the source-file lines.
4. Re-deliver the webhook and confirm credits are not reserved twice.
```

If manual setup is awkward, say so. Reviewers will happily follow a five-step test, but they resent hunting down environment variables you never mentioned.

### Review focus: spend attention deliberately

Authors know which part of a change made them stare at the ceiling. Tell the reviewer.

Be honest about the part you are least sure about. “Please check the transaction boundary between credit reservation and queueing” is much more useful than asking for a general review. You can also point out that a migration rollback deserves another look or that generated client changes are not the important part of the diff.

This is not an invitation to ignore the rest of the diff. It is a way to allocate scarce reviewer concentration to the highest-risk decisions.

### Screenshots or output: show observable changes

For UI changes, include before and after screenshots at relevant viewport sizes. For backend work, show a request and response, an execution plan, a log excerpt or benchmark result.

Evidence answers questions faster than saying that the new version definitely works on your machine.

Keep sensitive data out of screenshots and logs. It is easy to forget to blur something, and hard to take it back once it is posted.

## Example: a weak and strong description

Here is a common weak description:

```md
## Summary

Adds invitation deletion.

## Testing

Added tests.
```

It is not false, but the reviewer must discover almost everything.

A stronger version:

```md
## Summary

- Lets workspace administrators revoke pending invitations.
- Adds a confirmation action to the team settings page.

## Why

Invitations currently remain valid until they expire. Administrators need to
revoke invitations sent to the wrong address or to someone who no longer needs
access.

## Approach

The API scopes deletion by both invitation ID and workspace ID, then checks the
current member's administrator role. Revocation is idempotent: deleting an
already-revoked invitation returns success so repeated UI requests are safe.

## How to test

1. Invite a user from workspace settings.
2. Revoke the pending invitation and confirm it disappears.
3. Open the old invitation link and confirm it is rejected.
4. Confirm a normal member cannot revoke invitations.

## Review focus

- Please check the workspace scoping in `invitationService.revoke`.
- I would like a second opinion on returning success for repeated revocations.
```

The stronger description is longer, but its real advantage is specificity. A small PR may need only half of that text.

## Templates for different kinds of pull requests

### Small bug fix

```md
## Problem

<!-- What breaks, and under what conditions? -->

## Fix

<!-- What caused it and what changed? -->

## Regression test

<!-- Which test fails before the fix and passes after it? -->
```

### Refactor

```md
## Goal

<!-- What becomes easier, safer or simpler? -->

## Behavior preserved

<!-- How did you verify externally visible behavior did not change? -->

## Structural changes

<!-- Which boundaries or abstractions moved? -->

## Follow-up work

<!-- What is intentionally outside this PR? -->
```

### Database migration

```md
## Schema change

## Backfill strategy

## Deployment order

## Compatibility during rollout

## Rollback plan

## Verification queries
```

### Performance change

```md
## Bottleneck

## Measurement method

## Before and after

## Trade-offs

## Production monitoring
```

## Keep the template proportional

A template should improve communication without becoming another form that people complete on autopilot.

For a typo, dependency patch or obvious three-line fix, a sentence and a test note may be enough. For an authorization change, data migration or concurrency fix, the full template is a sensible minimum.

A useful rule is: description depth should follow review risk, not line count. A five-line permission change can deserve more explanation than a mechanical 500-line rename.

## Help AI reviewers by giving them intent

An AI reviewer can inspect the implementation, but it cannot reliably infer unstated product requirements. A precise PR description gives it acceptance criteria, constraints and areas of concern to test against.

Good context helps both kinds of reviewer. People spend less time reconstructing intent, an AI reviewer can compare code with the stated behavior, and authors often catch omissions while writing the description. The same text becomes a useful decision record for whoever returns to the code later.

Combine this template with the [code review checklist for AI-generated code](/blog/code-review-checklist-ai-generated-code), and read the broader [code review best practices](/blog/code-review-best-practices) for guidance on PR size, latency and feedback.
