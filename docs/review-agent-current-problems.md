## Tool And Runtime Problems

### Context Is Too Large

Both runs fed the model roughly 240k-255k input tokens. The prompt included full diffs, diff context, semantic context, and large chunks from indexed files.

This creates several problems:

- higher cost
- slower reviews
- harder model attention over the important changed behavior
- higher chance of false positives from irrelevant context

### Semantic Retrieval Is Noisy

Qdrant indexed and retrieved files that should not be part of normal review context, including `.agents/skills/...` examples and generated files.

Observed noisy top semantic results included Elysia example files unrelated to the PR. This is an indexing/filtering problem, not a model problem.

### Full-File Chunks Are Too Expensive

Semantic context included whole-file chunks such as `apps/api/src/modules/chat/index.ts` and `apps/api/src/modules/chat/service.ts`.

Whole files can be useful when explicitly requested, but initial semantic context should be much smaller: short snippets, affected symbols, and concise metadata. The agent can call `read_file` when it needs more.

### Tools Are Underused

Both runs mostly used `read_file`. The agent did not use symbol definition, callers, or follow-up semantic search after the initial context.

This means the current system has tools, but not enough workflow pressure to use them for verification.

### No Evidence Gate

Findings can be emitted without explicit evidence fields. This allowed the cheap model to report a token-revocation issue that was not supported by the code.

### No Root-Cause Deduplication

The cheap model reported the same vulnerability as multiple high-severity findings.

### Debug Logs Are Useful But Hard To Query

The `.runs` artifacts captured the important data, but some JSON shapes are awkward:

- step summaries require inspecting nested `content`
- tool output summaries are easier to read from individual files than from aggregate output
- some convenience fields are missing from summaries

The logger should keep raw artifacts, but also write normalized summaries that are easy to inspect with `jq`.

## Prompt Problems

The prompt tells the model to use tools, but it does not enforce a review workflow.
