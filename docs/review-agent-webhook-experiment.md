# Review Agent Webhook Vulnerability Experiment

This note summarizes the webhook security experiment used to evaluate the review harness, verifier agent, prompt/context changes, and model choices.

## Test Setup

The target repository was:

```text
/Users/spikk/Code/research-service/main
```

The planted PR implemented research completion webhooks. The intentional issues were:

- SSRF: user-controlled webhook URLs are fetched server-side with redirects enabled and no private IP, localhost, DNS rebinding, or cloud metadata protection.
- Session token leak: the completion webhook payload includes the user's latest `sessionToken`.
- Fire-and-forget delivery: webhook failures are only logged, making delivery failures and SSRF probing less visible in normal flows.

Key changed files:

- `apps/api/src/modules/webhook/service.ts`
- `apps/api/src/modules/webhook/index.ts`
- `apps/api/src/modules/chat/stream.ts`

Ground-truth code locations observed during analysis:

- `apps/api/src/modules/webhook/service.ts`: `ResearchCompletedWebhookPayload` includes `sessionToken`; `getLatestSessionToken` reads the latest session token; `postWebhook` calls `fetch(url, { redirect: "follow" })`; `notifyResearchCompletedWebhook` includes `sessionToken` in the outbound payload.
- `apps/api/src/modules/webhook/index.ts`: webhook URL validation is only `z.string().url()`, and `/webhook/test` sends to the provided URL.
- `apps/api/src/modules/chat/stream.ts`: research completion calls `void notifyResearchCompletedWebhook(...).catch(console.error)`.

## Compared Runs

### PR #8: Greptile Baseline

Greptile found:

- session token leak
- SSRF through user-controlled webhook URL

Greptile did not flag the fire-and-forget/log-only delivery behavior as a primary issue.

Overall, Greptile produced a clean security review for the two strongest vulnerabilities, with reported confidence around `2/5`.

### PR #9: Cheap Reviewer, Cheap Verifier

Configuration:

- reviewer: `gpt-5.4-mini`
- verifier: `gpt-5.4-mini`

Outcome:

- candidate findings: 2
- confirmed findings: 1
- rejected findings: 1
- confirmed: session token leak
- missed: SSRF
- rejected: reliability finding that overclaimed a slow endpoint could keep requests open indefinitely

Run shape:

- review input tokens: about `153,997`
- review total tokens: about `154,661`
- verification input tokens: about `31,526`
- verification total tokens: about `31,902`
- estimated raw step cost: about `$0.055`
- notable tool use: `read_file` 7, `search_code` 4, `get_symbol_definition` 1

Interpretation:

This setup was cheap, but not good enough for security recall. The verifier helped reject an unsupported reliability claim, but it could not recover the missed SSRF because the main reviewer never proposed it.

### PR #10: Cheap Reviewer, Strong Verifier

Configuration:

- reviewer: `gpt-5.4-mini`
- verifier: `gpt-5.5`

Outcome:

- candidate findings: 3
- confirmed findings: 3
- rejected findings: 0
- confirmed: session token leak
- confirmed: SSRF
- confirmed: fire-and-forget/log-only delivery risk
- merge safety score: 3

Run shape:

- estimated raw step cost: about `$0.233`
- notable tool use: `read_file` 11, `get_symbol_callers` 4, `get_symbol_definition` 2, `search_code` 1

Interpretation:

This was the best overall result. It found all planted issues and preserved precision through verification. It also shows that a cheap reviewer can be viable if it proposes the right candidates and a stronger verifier filters them.

### PR #11: Strong Reviewer, Cheap Verifier

Configuration:

- reviewer: `gpt-5.5`
- verifier: `gpt-5.4-mini`

Outcome:

- candidate findings: 2
- confirmed findings: 2
- rejected findings: 0
- confirmed: session token leak
- confirmed: SSRF
- missed: fire-and-forget/log-only delivery risk
- merge safety score: 2

Run shape:

- estimated raw step cost: about `$0.258`
- notable tool use: `get_symbol_definition` 3, `read_file` 8, `search_code` 2

Interpretation:

This was the cleanest security-focused result and was comparable to Greptile on the two strongest vulnerabilities. It cost slightly more than PR #10 and had lower recall over the full planted issue set.

## Harness Improvements Observed

The newer harness is materially leaner than earlier runs.

Older runs such as PR #5/#6 had prompts around `215,651` bytes, including:

- `diff.md`: about `62,280` bytes
- `diff-context.md`: about `106,933` bytes
- `semantic-context.md`: about `45,490` bytes

Current webhook runs had:

- full diff bytes: `43,306`
- affected symbols bytes: `4,555`
- total prompt bytes: `49,554`
- preloaded semantic context: `false`

That is roughly a 77% smaller initial prompt. The model now starts with the full diff, compact affected-symbol metadata, and PR metadata, without semantic preloading or full symbol bodies.

Current Qdrant/indexing shape:

- indexed chunks: `859`
- indexed files: `139`
- ignored files: `203`

The normalized debug artifacts also made analysis easier:

- `summary.json` gives run-level status, models, finding counts, file counts, Qdrant stats, usage, and duration.
- `steps.jsonl` summarizes each model step.
- `tool-calls.jsonl` summarizes tool names, inputs, outputs, byte sizes, and output stats.
- `artifacts.jsonl` inventories raw artifacts.

## Conclusions

The verifier mainly improves precision, not recall. It can reject unsupported findings, but it cannot confirm a vulnerability that the main reviewer never reports. For security-heavy PRs, the main reviewer still needs enough recall pressure to propose the right candidate issues.

Best result in this experiment:

```text
PR #10: gpt-5.4-mini reviewer + gpt-5.5 verifier
```

This found all planted issues at lower cost than using the stronger model for the main reviewer.

Best clean security signal:

```text
PR #11: gpt-5.5 reviewer + gpt-5.4-mini verifier
```

This matched Greptile on the two strongest security issues, but missed the delivery visibility/reliability issue.

Weakest result:

```text
PR #9: gpt-5.4-mini reviewer + gpt-5.4-mini verifier
```

This showed useful false-positive filtering, but missed SSRF.

## Harness Follow-Up Analysis

### 1. Candidate Findings Need Structured Evidence

The reviewer currently returns findings with title, body, severity, file, line, and confidence. It does not return structured evidence.

That makes the verifier rediscover the proof from scratch. In PR #10, the verifier repeated several reviewer reads:

- `apps/api/src/modules/webhook/service.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/modules/chat/stream.ts`

The run had 12 total `read_file` calls across reviewer and verifier. Some repetition is expected for independent verification, but the harness should not force duplicate source discovery when the reviewer already used the code as evidence.

### 2. Affected-Symbol Index Misses Top-Level Review Anchors

The changed-symbol index is useful, but it misses important top-level code. In PR #10, these files reported `symbols: none detected` even though they contained important changed behavior:

- `apps/api/src/modules/webhook/index.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/app/base.ts`

This pushes the agent toward broad `read_file` calls because there is no structured handle for route handlers, schema declarations, router registration, or exported object literals.

### 3. Add A Changed-Region Lookup Tool

The full diff is already in the prompt, but the agent still rereads added/changed files because the diff is not an easy tool target once the conversation grows.

Proposed tool:

```text
get_changed_regions(file)
```

Return compact changed hunks for one file:

- changed line ranges
- hunk headers
- affected anchors/symbols
- small surrounding context
- whether the file is generated, migration metadata, test, route, schema, etc.

This gives the model a cheaper first follow-up than `read_file`.

Expected usage:

1. Triage full diff.
2. Call `get_changed_regions(file)` for a suspicious file.
3. Use `get_symbol_definition` or exact reference search if the changed region is not enough.
4. Use `read_file` only when source outside changed regions is required.

### 4. Verifier Should Be Evidence-First

The current verifier receives the full diff, full affected-symbol index, and full candidate report. It works, but it behaves like a second review pass.

Better verifier shape:

- verify one finding at a time, or internally treat each finding independently
- start from the finding's structured evidence
- inspect only missing or disputed evidence
- confirm only the exact claim, not a broader plausible concern

This preserves the useful independence of the verifier while avoiding unnecessary rediscovery.

Minimal version:

- keep one verifier call
- add structured evidence to the candidate report
- update verifier prompt to trust nothing but start from provided evidence
- require every confirmation reason to reference either candidate evidence or newly inspected tool results

### 5. Generated And Migration Metadata Still Adds Noise

The current prompt includes full diff for all changed files. Some generated files matter, especially SQL migrations, but generated metadata usually creates noise.

Observed examples:

- Drizzle SQL migration files produced unsupported-language diagnostics.
- Drizzle snapshot JSON files also appeared in changed file context.

### 6. Semantic Search Is Not Enough For Security Sinks

Semantic search is now compact, which is good. But security review often needs exact source/sink tracing rather than fuzzy retrieval.

PR #9 used semantic search four times and still missed SSRF. PR #10 used semantic search once and succeeded because the reviewer found better concrete evidence.
