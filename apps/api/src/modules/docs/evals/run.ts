import { mkdirSync, appendFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { db, pool } from "../../../db/client"
import { docSource } from "../../../db/schema"
import { createReviewLlm, type ReviewLlm } from "../../reviews/llm"
import { queryDocsLibrarian, type LibrarianResult } from "../librarian"
import { resolveDocSourceConfig } from "../sources"
import { evalCases, type DocsEvalCase } from "./testset"

const BUDGET_USD = 0.1

type Args = {
  filter?: string
  tag?: string
  repeat: number
  concurrency: number
}

const parseArgs = (): Args => {
  const args: Args = { repeat: 1, concurrency: 2 }
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === "--filter" && value) {
      args.filter = value
      index += 1
    } else if (flag === "--tag" && value) {
      args.tag = value
      index += 1
    } else if (flag === "--repeat" && value) {
      args.repeat = Math.max(1, Number.parseInt(value, 10) || 1)
      index += 1
    } else if (flag === "--concurrency" && value) {
      args.concurrency = Math.max(1, Number.parseInt(value, 10) || 1)
      index += 1
    } else {
      console.error(`Unknown or valueless flag: ${flag}`)
      process.exit(1)
    }
  }
  return args
}

type Assertion = { assertion: string; pass: boolean; detail: string }

const scoreCase = (
  testCase: DocsEvalCase,
  result: LibrarianResult
): Assertion[] => {
  const assertions: Assertion[] = []
  const answer = result.answer.toLowerCase()
  const { expect } = testCase

  assertions.push({
    assertion: "found",
    pass: result.found === expect.found,
    detail: `expected found=${expect.found}, got ${result.found}`,
  })

  for (const fragment of expect.citeUrlIncludes ?? []) {
    const pass = result.citations.some((citation) =>
      citation.url.includes(fragment)
    )
    assertions.push({
      assertion: `cite:${fragment}`,
      pass,
      detail: pass
        ? "matched"
        : `no citation url contains "${fragment}" (got: ${result.citations.map((c) => c.url).join(", ") || "none"})`,
    })
  }

  for (const group of expect.answerIncludes ?? []) {
    const matched = group.find((term) => answer.includes(term.toLowerCase()))
    assertions.push({
      assertion: `answer-includes:[${group.join("|")}]`,
      pass: Boolean(matched),
      detail: matched ? `matched "${matched}"` : "no term from group in answer",
    })
  }

  for (const term of expect.answerExcludes ?? []) {
    const pass = !answer.includes(term.toLowerCase())
    assertions.push({
      assertion: `answer-excludes:${term}`,
      pass,
      detail: pass ? "absent" : `tripwire "${term}" appeared in answer`,
    })
  }

  return assertions
}

type CostInfo = {
  costUsd: number | null
  costMicroUsd: number | null
  costStatus: "resolved" | "partial" | "missing" | "zero_no_llm"
}

const resolveCost = async (
  llm: ReviewLlm,
  generation: unknown
): Promise<CostInfo> => {
  if (generation === undefined) {
    return { costUsd: 0, costMicroUsd: 0, costStatus: "zero_no_llm" }
  }
  try {
    const cost = await llm.resolveGenerationCost(generation)
    if (cost.costMicrocents === null) {
      const stepMicro = cost.steps.reduce<number>(
        (total, step) =>
          total +
          (typeof step === "object" &&
          step !== null &&
          typeof (step as { costMicroUsd?: unknown }).costMicroUsd === "number"
            ? (step as { costMicroUsd: number }).costMicroUsd
            : 0),
        0
      )
      return {
        costUsd: stepMicro / 1_000_000,
        costMicroUsd: stepMicro,
        costStatus: stepMicro > 0 ? "partial" : "missing",
      }
    }
    return {
      costUsd: cost.cost ?? 0,
      costMicroUsd: cost.costMicrocents,
      costStatus: "resolved",
    }
  } catch {
    return { costUsd: null, costMicroUsd: null, costStatus: "missing" }
  }
}

type AttemptRecord = {
  id: string
  attempt: number
  status: "ok" | "skipped" | "error"
  pass: boolean
  assertions: Assertion[]
  costUsd: number | null
  costStatus: string
  latencyMs: number
  stepCount: number
  toolCallCount: number
  usage?: unknown
  error?: string
}

const percent = (numerator: number, denominator: number) =>
  denominator === 0 ? "n/a" : `${((100 * numerator) / denominator).toFixed(1)}%`

const main = async () => {
  const args = parseArgs()
  let cases = evalCases
  if (args.filter) cases = cases.filter((c) => c.id.includes(args.filter!))
  if (args.tag) cases = cases.filter((c) => c.tags?.includes(args.tag!))
  if (cases.length === 0) {
    console.error("No cases match the given filter/tag.")
    process.exit(1)
  }

  const libraries = [
    ...new Set(
      cases
        .map((c) => resolveDocSourceConfig(c.library)?.slug)
        .filter((slug): slug is string => Boolean(slug))
    ),
  ]
  const corpus: Record<string, unknown> = {}
  const librariesWithoutCorpus = new Set<string>()
  for (const slug of libraries) {
    const source = await db.query.docSource.findFirst({
      where: eq(docSource.slug, slug),
    })
    corpus[slug] = source?.activeCrawlId
      ? {
          activeCrawlId: source.activeCrawlId,
          pageCount: source.pageCount,
          lastCrawledAt: source.lastCrawledAt,
        }
      : null
    if (!source?.activeCrawlId) librariesWithoutCorpus.add(slug)
  }
  for (const slug of librariesWithoutCorpus) {
    console.warn(
      `WARN: no active corpus for "${slug}" — its cases will be skipped`
    )
  }

  const runDir = join(
    process.cwd(),
    ".evals",
    "docs-librarian",
    new Date().toISOString().replace(/[:.]/g, "-")
  )
  mkdirSync(join(runDir, "cases"), { recursive: true })
  const resultsPath = join(runDir, "results.jsonl")

  const llm = createReviewLlm()
  const records: AttemptRecord[] = []

  const attempts: { testCase: DocsEvalCase; attempt: number }[] = []
  for (const testCase of cases) {
    for (let attempt = 1; attempt <= args.repeat; attempt += 1) {
      attempts.push({ testCase, attempt })
    }
  }

  let cursor = 0
  const workers = Array.from(
    { length: Math.min(args.concurrency, attempts.length) },
    async () => {
      while (cursor < attempts.length) {
        const index = cursor++
        const item = attempts[index]
        if (!item) continue
        const { testCase, attempt } = item

        const configSlug = resolveDocSourceConfig(testCase.library)?.slug
        if (configSlug && librariesWithoutCorpus.has(configSlug)) {
          records.push({
            id: testCase.id,
            attempt,
            status: "skipped",
            pass: false,
            assertions: [],
            costUsd: 0,
            costStatus: "zero_no_llm",
            latencyMs: 0,
            stepCount: 0,
            toolCallCount: 0,
          })
          continue
        }

        const startedAt = Date.now()
        let record: AttemptRecord
        try {
          const result = await queryDocsLibrarian(
            { library: testCase.library, question: testCase.question },
            { diagnostics: true }
          )
          const latencyMs = Date.now() - startedAt
          const assertions = scoreCase(testCase, result)
          const cost = await resolveCost(llm, result.generation)
          record = {
            id: testCase.id,
            attempt,
            status: "ok",
            pass: assertions.every((assertion) => assertion.pass),
            assertions,
            costUsd: cost.costUsd,
            costStatus: cost.costStatus,
            latencyMs,
            stepCount: result.diagnostics?.stepCount ?? 0,
            toolCallCount: result.diagnostics?.toolCallCount ?? 0,
            usage: result.usage,
          }
          writeFileSync(
            join(runDir, "cases", `${testCase.id}-${attempt}.json`),
            JSON.stringify(
              {
                testCase,
                result: { ...result, generation: undefined },
                assertions,
                cost,
              },
              null,
              2
            )
          )
        } catch (error) {
          record = {
            id: testCase.id,
            attempt,
            status: "error",
            pass: false,
            assertions: [],
            costUsd: null,
            costStatus: "missing",
            latencyMs: Date.now() - startedAt,
            stepCount: 0,
            toolCallCount: 0,
            error: error instanceof Error ? error.message : String(error),
          }
        }
        records.push(record)
        appendFileSync(
          resultsPath,
          `${JSON.stringify({ ...record, usage: undefined })}\n`
        )
        const mark =
          record.status === "ok"
            ? record.pass
              ? "PASS"
              : "FAIL"
            : record.status.toUpperCase()
        console.log(
          `[${mark}] ${testCase.id}#${attempt} $${(record.costUsd ?? 0).toFixed(4)} ${record.latencyMs}ms steps=${record.stepCount} tools=${record.toolCallCount}${record.error ? ` error=${record.error}` : ""}`
        )
        for (const assertion of record.assertions.filter((a) => !a.pass)) {
          console.log(`    ✗ ${assertion.assertion}: ${assertion.detail}`)
        }
      }
    }
  )
  await Promise.all(workers)

  const scored = records.filter((record) => record.status === "ok")
  const foundAssertions = scored.flatMap((record) =>
    record.assertions.filter((assertion) => assertion.assertion === "found")
  )
  const citeAssertions = scored.flatMap((record) =>
    record.assertions.filter((a) => a.assertion.startsWith("cite:"))
  )
  const includeAssertions = scored.flatMap((record) =>
    record.assertions.filter((a) => a.assertion.startsWith("answer-includes:"))
  )
  const tripwires = scored.flatMap((record) =>
    record.assertions.filter(
      (a) => a.assertion.startsWith("answer-excludes:") && !a.pass
    )
  )
  const costs = scored
    .map((record) => record.costUsd)
    .filter((cost): cost is number => cost !== null)
    .sort((a, b) => a - b)
  const totalCost = costs.reduce((total, cost) => total + cost, 0)
  const llmScored = scored.filter((record) => record.stepCount > 0)

  const passRatioByCase = new Map<string, { pass: number; total: number }>()
  for (const record of scored) {
    const entry = passRatioByCase.get(record.id) ?? { pass: 0, total: 0 }
    entry.total += 1
    if (record.pass) entry.pass += 1
    passRatioByCase.set(record.id, entry)
  }

  const summary = {
    startedAt: new Date().toISOString(),
    modelId:
      process.env.DOCS_LIBRARIAN_MODEL ?? process.env.REVIEW_VERIFIER_MODEL,
    args,
    corpus,
    counts: {
      cases: cases.length,
      attempts: records.length,
      ok: scored.length,
      skipped: records.filter((record) => record.status === "skipped").length,
      errors: records.filter((record) => record.status === "error").length,
    },
    metrics: {
      casePassRate: percent(scored.filter((r) => r.pass).length, scored.length),
      foundAccuracy: percent(
        foundAssertions.filter((a) => a.pass).length,
        foundAssertions.length
      ),
      citationPass: percent(
        citeAssertions.filter((a) => a.pass).length,
        citeAssertions.length
      ),
      answerPass: percent(
        includeAssertions.filter((a) => a.pass).length,
        includeAssertions.length
      ),
      hallucinationTripwires: tripwires.length,
    },
    cost: {
      totalUsd: totalCost,
      meanUsd: costs.length ? totalCost / costs.length : 0,
      medianUsd: costs.length ? costs[Math.floor(costs.length / 2)] : 0,
      maxUsd: costs.length ? costs[costs.length - 1] : 0,
      unresolved: scored.filter((record) => record.costUsd === null).length,
      budgetUsd: BUDGET_USD,
      withinBudget: totalCost <= BUDGET_USD,
    },
    latency: {
      meanMs: llmScored.length
        ? Math.round(
            llmScored.reduce((total, r) => total + r.latencyMs, 0) /
              llmScored.length
          )
        : 0,
      meanSteps: llmScored.length
        ? (
            llmScored.reduce((total, r) => total + r.stepCount, 0) /
            llmScored.length
          ).toFixed(1)
        : "0",
      meanToolCalls: llmScored.length
        ? (
            llmScored.reduce((total, r) => total + r.toolCallCount, 0) /
            llmScored.length
          ).toFixed(1)
        : "0",
    },
    passRatioByCase: Object.fromEntries(
      [...passRatioByCase.entries()].map(([id, entry]) => [
        id,
        `${entry.pass}/${entry.total}`,
      ])
    ),
  }
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2))

  console.log("\n=== docs librarian eval summary ===")
  console.log(
    `cases: ${summary.counts.cases}  attempts: ${summary.counts.attempts}  ok: ${summary.counts.ok}  skipped: ${summary.counts.skipped}  errors: ${summary.counts.errors}`
  )
  console.log(`casePassRate:   ${summary.metrics.casePassRate}`)
  console.log(`foundAccuracy:  ${summary.metrics.foundAccuracy}`)
  console.log(`citationPass:   ${summary.metrics.citationPass}`)
  console.log(`answerPass:     ${summary.metrics.answerPass}`)
  console.log(`tripwires hit:  ${summary.metrics.hallucinationTripwires}`)
  console.log(
    `cost: total $${totalCost.toFixed(4)}  mean $${summary.cost.meanUsd.toFixed(4)}  max $${summary.cost.maxUsd?.toFixed(4)}  unresolved: ${summary.cost.unresolved}`
  )
  console.log(
    `latency: mean ${summary.latency.meanMs}ms  steps ${summary.latency.meanSteps}  toolCalls ${summary.latency.meanToolCalls}`
  )
  console.log(
    `BUDGET ${summary.cost.withinBudget ? "OK" : "EXCEEDED"} ($${totalCost.toFixed(4)} / $${BUDGET_USD})`
  )
  console.log(`artifacts: ${runDir}`)

  await pool.end()
  if (!summary.cost.withinBudget) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
