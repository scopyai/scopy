---
title: "Why AI Code Reviewers Are So Noisy (and How to Fix It)"
description: "AI code review false positives explained: why LLM reviewers flood pull requests with nitpicks and wrong findings, and practical ways to cut the noise without losing real bugs."
date: "2026-07-16"
author: "Matt, founder"
tags: "AI code review, false positives, code review noise, pull requests"
---

Every team that tries an AI code reviewer goes through the same stages. During week one it catches bugs, impresses the team, week three ends with "why did it leave three comments on a README change?" Then after some more time everyone has already learned to scroll past the bot, and now it catches nothing because nobody is reading.

The problem is not that AI review does not work. It is that most AI reviewers are optimized to produce comments, and comments are not the product. Caught bugs are the product. This post is about where the noise actually comes from – which is more specific than just LLM hallucinations – and what you can do about it, whichever tool you use.

## What counts as noise

Three different things get lumped together as "false positives" and they need different fixes:

- **Wrong findings.** The bot says there is a bug and there is not. It missed that some check happens one layer up or invented a race condition that cannot occur.
- **True but useless findings.** Technically correct, practically irrelevant: a variable could be renamed, a function could theoretically be split. Nobody's incident report ever started with the variable name being slightly vague. It is only helpful when the team actually architechs the tool to find these.
- **Restating the diff.** "This change adds a parameter to the function". Yes it does. I wrote it...

Write-ups usually put false-positive rates for even the better tools somewhere in the 5–15% range, and much higher for the noisier ones. But the raw rate understates the damage, because trust to the tool's findings falls much faster than these numbers suggest: a reviewer that is wrong one time in three does not get two-thirds of your attention, that's just now how it works.

## Where the noise actually comes from

### 1. The model only sees the diff

This is the biggest cause of _wrong_ findings, and it is an input problem, not a problem with the model itself. A diff shows what changed and not what the change means. Whether a call is safe often depends on a type definition, a caller or a config default in a file the model never saw. Ask a very smart model to review a fragment with no context and you get confident feedback about the wrong thing or just guesses – like asking someone to review a novel by showing them page 212.

So no prompt fixes this. If the contract between the code and the model was not in the input, the model usually cannot recover it. We walked through concrete cases in [why diff-only code review misses bugs](/blog/why-diff-only-code-review-misses-bugs): the same missing context that hides real bugs also regulary _manufactures_ fake ones.

### 2. Nobody checks the model's first draft

Here is the thing most people do not realize about how these tools differ: it is mostly not the model. Several tools call the same frontier models. The difference is what happens between the model's raw output and your pull request.

The cheapest architecture takes the model's first pass and posts it. But a model's first pass at "list the problems with this code" reliably includes guesses, and LLMs are much better at _checking_ a specific claim than at generating only correct claims. "Is it true that `updateRepository` no longer invalidates the cache? Go look it up" is a far easier question than to "find all bugs", and a model answers it far more reliably. Tools that add a verification step – re-examining each candidate finding against the actual code before posting, or requiring at least some agreement between independent passes can cut false positives dramatically.

This is the best question to ask any vendor, us included: **what happens to a finding between the model and my PR?** If the answer is close to "nothing" you have found your noise source. (This verification step is the center of how we built Scopy – findings get independently checked against repository context before anything is posted. It is slower and costs more per review. It is also the difference between a reviewer and a comment generator).

### 3. The bot has no taste

The "true but useless" category is a threshold problem here. A model asked to review code will always try find _something_ – it has no natural sense of which findings are worth a human's time. Left uncalibrated, it applies staff-engineer scrutiny to a typo in a comment.

The fix is more about discipline: findings should be filtered or labeled by whether they affect correctness, security or maintainability of the project, and pure style commentary should be dropped or held to an explicit opt-in from the maintainers.

### 4. It does not know your rules

Some noise is a genuine disagreement: the bot flags a pattern your team decided is fine or misses one your team specifically banned. A generic model knows general best practices and not the fact that your team allows raw SQL where ORM call can be used. Every rule the tool does not know about becomes either a false positive or a missed catch – and both are bad.

## What you can do about it, starting today

These apply to any AI reviewer:

**Count before you tune.** For couple of weeks, track two numbers per PR: findings that led to a code change and findings dismissed. If fewer than about a quarter of comments lead to changes then you have a noise problem worth fixing – or a tool worth replacing.

**Turn severity numbers down before turning the tool off.** Most teams reject AI review at the noise stage without ever visiting the settings or tweaking something in the dashboard. Restrict comments to correctness and security. A quiet bot that people read beats an annoying one, always.

**Write down your standards as rules.** If the tool supports custom rules, encode the recurring disagreements between your teams' standards and its understanding – every rule you add converts a repeat false positive into silence, or a repeat miss into a catch. This is what [natural-language review rules](/blog/natural-language-code-review-rules) are for.

**Dismiss with a reason.** When you reject a finding from the bot, a one-line comment can be helpful in two ways: teammates stop re-checking it, and tools that learn from feedback actually have something to learn from.

**Give it better PRs.** Noise can scale with confusion from what is being shipped. Small PRs with a real description give the reviewer (both human and AI) the reasoning behind the change, and half of AI mistakes are misreadings of your intent. Our [pull request description template](/blog/pull-request-description-template) exists for precisely this.

## What to demand from the tool

If you are choosing or re-evaluating a reviewer, the noise question is basically reduced to four checks:

1. **Context:** does it gather repository context beyond the diff before judging?
2. **Verification:** are candidate findings checked against the code before posting or is the first draft the final answer?
3. **Thresholds:** can you control severity and does it control how many style commentary is posted?
4. **Teachability:** can you add team-specific rules without a config language, and does dismissal feedback go anywhere?

A tool can be missing one of these and still be extremely helpful. Missing all four however is how you get those three comments on a README.

## The payoff is trust, and not the bugs you lose

The goal is not a bot that comments less but the one whose comments are worth reading. Once the signal-to-noise ratio is high, developers act on findings quickly, PRs move faster and the reviewer earns the right to interrupt your team.

If you want to see what a verification-first reviewer feels like on your own pull requests, Scopy's [quickstart](https://docs.scopy.dev/quickstart) takes a few minutes, and if the code staying on your infrastructure matters, it is [open source and self-hostable](/blog/self-hosted-ai-code-review).

## Frequently asked questions

**What is a false positive in AI code review?**
A finding that claims a problem which does not exist, or would never matter in practice. The subtler kind – technically-true-but-irrelevant nitpicks – is just as damaging, because it trains developers to ignore the reviewer.

**What false-positive rate is acceptable?**
There is no magic number, but a useful thing to know is action rate: if under roughly 20–25% of the bot's comments lead to a code change, developers will eventually stop reading them. Above 50% the bot has real credibility.

**Why does my AI reviewer flag things that are clearly fine?**
Usually one of three causes: it only saw the diff and missed the context that makes the code safe, nothing verified the model's first draft or it does not know a team-specific convention that you know from experience. All three are fixable – the first two by tool choice, the third by writing rules.

**Can better prompts fix a noisy AI reviewer?**
Only partially. Prompts can tune tone and severity but they cannot give repository context the tool never collected, and they cannot substitute for a verification pass from a different model.
