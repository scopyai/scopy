---
title: "How to review AI-generated code: checklist for catching most of the bugs"
description: "A practical checklist for reviewing AI-generated code: verifying intent, tracing data flow, testing failure paths, checking security boundaries and catching obvious mistakes before merge."
date: "2026-07-12"
author: "Matt, founder"
tags: "AI-generated code, code review checklist, pull requests, AI coding"
---

AI-generated code deserves the same review standards as human-written code, but it does not always fail in the same way. A person might leave a half-finished function and a TODO comment while an AI assistant is more likely to produce something polished, documented and completely wrong about one important aspect of design.

That polish changes the reviewer's job from only looking for broken syntax or untidy code to checking whether convincing code actually matches the system around it.

This checklist is designed for pull requests written partly or entirely with coding agents: Codex, Claude Code, Cursor, GitHub Copilot or anything else. Use it as a template, a prompt for an internal AI reviewer or a final self-review before asking a teammate for their time.

## The five-pass review

You can review most AI-generated changes in five passes. First, confirm that the code solves the problem that was actually requested. Then verify its assumptions against real APIs and the conventions already present in the repository. Follow the data through the system, inspect security and failure boundaries and finally make the tests prove the behavior.

There is one rule beneath all five: somebody on the team must be able to explain the implementation and its trade-offs without asking the generating tool. If nobody can, the team does not really own the change yet and cannot hold responsibility for it.

## 1. Start with intent instead of syntax

Read the issue and pull request description before reading the diff. Write down, in one sentence, what should be true after the change.

For example:

> A workspace administrator can revoke an invitation, but members of other workspaces cannot.

Now compare that sentence with the implementation. AI coding tools often solve the shape of a problem while missing some business constraints. You may get a perfectly competent “delete invitation” endpoint that checks whether the user is logged in but not whether they administer the relevant workspace.

Check the implementation against each acceptance criterion. Look for behavior that became subtly broader or narrower, requirements the agent invented and disagreements between what the interface requires and what the API actually does.

This is also why a useful [pull request description](/blog/pull-request-description-template) matters. A diff can show what changed but it cannot reliably tell a reviewer why.

## 2. Verify every external fact

Language models are very good at producing code that resembles a library’s API. Unfortunately, “resembles” is doing some heavy lifting there.

Treat every newly introduced API, command-line flag, environment variable, framework option and cloud permission as a claim that needs verification. Open the documentation or source for the version installed in the repository. Confirm argument order, return types and error behavior because a method that exists in the latest documentation may not exist in the version your project actually uses.

Pay special attention to code that includes a confident explanatory comment. Confidence is not a type check, especially for LLMs.

## 3. Compare it with the rest of the repository

Generated code is usually optimized for the prompt it received. Your codebase is optimized — or at least slowly negotiated — for conventions the prompt may not contain. As AI does not understand what the pain is, it usually is not able to make architectural decisions oriented far into the future.

To spot this, search for a similar implementation elsewhere in the repository. See how neighboring routes authenticate users, where validation normally happens, how transactions and errors are handled, and which testing helpers the project already uses. These patterns often contain constraints that were never included in the agent’s prompt and which it could interpret incorrectly when copying is not an option.

Do not reject a different approach merely because it is different. But make the difference deliberate, e.g. a new endpoint should not introduce a second authorization system because the AI assistant did not see the first one. Obvious one here.

This is one reason [reviewing only the diff is risky](/blog/why-diff-only-code-review-misses-bugs): the evidence needed to judge a change often lives in files that were not modified.

## 4. Trace the complete data flow

Follow one representative value from input to storage and back to output.

Suppose a change adds a `timezone` field. Follow it from the form through client validation, the request payload, API validation, the service layer and database, then back through serialization into the UI. Repeat the journey with the value missing and with it invalid. Generated changes often update six of those layers and still look complete during a happy-path demo.

As you trace it, watch for an old field name surviving in one layer, optional values becoming accidentally required, units changing and serialization dropping information.

## 5. Review security boundaries explicitly

Instead of asking something like just checking the authentication implementation for a user you usually think “is this user allowed to perform this action on this specific resource?”. And make your AI think so as well through AGENTS.md and other ways to preserve project-specific context.

For every important read or write, identify the actor, the resource, its owning tenant and the permission required for accessing it. In my personal experience, most authorization bugs become obvious when one of those relationships has no enforcement point.

Generated code is not inherently insecure. It is simply capable of repeating insecure patterns with really good formatting.

## 6. Attack the failure paths

The happy path is usually the part AI agents handle best. Spend review time where something becomes wrong, where uncomfortable questions are asked.

Walk through one inconvenient scenario instead of trying to think about every possible disaster at once. What happens if a database write succeeds but the following API call fails? Then consider atomicity, concurrency, timeouts and retries: can two requests update the same record, or can a queue deliver the same side effect twice? Empty, duplicated and unexpectedly large results are also productive tests because they expose assumptions hidden by normal data.

These are just examples of possible exploration paths you can take - they usually come with experience but it's worth starting early, believe me.

## 7. Make tests prove something

Generated tests can be impressive: many mocks, long names, everything green and very little evidence that it actually adds reliability to your system.

A useful test should fail for the bug it claims to prevent. Temporarily reverse or remove the relevant implementation condition. If the test remains green, it is not worth anything.

A test should show that an unauthorized user is rejected, that validation prevents a write, that a retry cannot create a second charge, or that a migration preserves existing values. Those assertions survive refactoring because they describe what the system promises and do not focus on implementation.

## 8. Remove generated clutter

AI assistants often leave comments that restate the next line, one-use abstractions that complicate the code and broad `try/catch` blocks that hide useful failures. They may also duplicate validation or add a dependency for a few lines of ordinary code.

Remove anything that does not improve correctness, clarity or maintainability. The goal is not to hide that AI helped write the change but to leave the codebase better than it was before.

## A reusable PR checklist

Paste this compact version into your repository’s pull request template:

```md
### AI-generated code review

- [ ] I can explain the implementation and its trade-offs.
- [ ] I verified new APIs and configuration against the installed versions.
- [ ] I compared the change with existing repository patterns.
- [ ] I traced inputs, outputs and side effects across all affected layers.
- [ ] I checked authorization and tenant boundaries.
- [ ] I tested failure paths and edge cases, not only the happy path.
- [ ] Tests fail when the behavior they protect is broken.
- [ ] No secrets or sensitive data are exposed in logs or errors.
- [ ] New dependencies, migrations and generated comments are necessary.
```

## The reviewer still owns the merge

AI can write code, propose tests and perform a useful first review. It cannot accept responsibility for the result. The person approving the pull request remains the final boundary between plausible code and production code.

Use this checklist to make that responsibility manageable, not ceremonial. For the next step, learn [how AI code review differs from static analysis](/blog/ai-code-review-vs-static-analysis) or create repository-specific checks with [natural-language code review rules](/blog/natural-language-code-review-rules).
