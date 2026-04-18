import { Output, stepCountIs, tool, ToolLoopAgent, wrapLanguageModel } from "ai";
import { randomUUID } from "node:crypto";
import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { z } from "zod";
import type {
  enrichedResearchEvidenceType,
  WorkflowContext,
} from "./types";
import {
  judgeVerificationResult,
  researchEvidenceSchema,
  type researchEvidenceSchemaType,
} from "./types";
import { createRunTools } from "./tools";
import {
  judgeAgentPrompt,
  researchAgentPrompt,
  summarizerAgentPrompt,
} from "./prompts";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { enrichResearchEvidence } from "./evidence";
import { createAgentStepLogger, createWorkflowRunStats } from "./stats";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY as string,
});

const RESEARCHER_MODEL_ID = "openai/gpt-5.4-mini";
const LIGHTWEIGHT_MODEL_ID = "openai/gpt-oss-120b";
const RESEARCHER_REASONING_EFFORT = "low" as const;

const researcherBaseModel = openrouter.chat(RESEARCHER_MODEL_ID);
const lightweightBaseModel = openrouter.chat(LIGHTWEIGHT_MODEL_ID);

const researcherModel =
  process.env.NODE_ENV === "production"
    ? researcherBaseModel
    : wrapLanguageModel({
        model: researcherBaseModel,
        middleware: devToolsMiddleware(),
      });

const lightweightModel =
  process.env.NODE_ENV === "production"
    ? lightweightBaseModel
    : wrapLanguageModel({
        model: lightweightBaseModel,
        middleware: devToolsMiddleware(),
      });

const MAX_RESEARCH_AGENT_STEPS = 60;

function buildJudgeSources(
  context: WorkflowContext,
  evidence: researchEvidenceSchemaType[],
) {
  const verifiedEvidence = enrichResearchEvidence(evidence, context.usedSources);
  const evidenceBySourceUrl = new Map<string, typeof verifiedEvidence>();

  for (const item of verifiedEvidence) {
    const existing = evidenceBySourceUrl.get(item.sourceUrl) ?? [];
    existing.push(item);
    evidenceBySourceUrl.set(item.sourceUrl, existing);
  }

  return [...evidenceBySourceUrl.entries()].map(([sourceUrl, quotes]) => {
    const source = context.usedSources.find((item) => item.url === sourceUrl);

    return {
      sourceUrl,
      title: source?.title ?? sourceUrl,
      highlights: source?.highlights ?? [],
      authors: source?.authors ?? [],
      publishedDate: source?.publishedDate ?? null,
      sourceFound: Boolean(source),
      quotes,
    };
  });
}

function getApprovedEvidence(
  context: WorkflowContext,
): enrichedResearchEvidenceType[] {
  const approvedSourceUrlSet = new Set(context.approvedSourceUrls);
  return enrichResearchEvidence(
    dedupeResearchEvidence(context.researchEvidence),
    context.usedSources,
  ).filter((item) => approvedSourceUrlSet.has(item.sourceUrl));
}

function dedupeResearchEvidence(
  evidence: researchEvidenceSchemaType[],
): researchEvidenceSchemaType[] {
  const seen = new Set<string>();
  const deduped: researchEvidenceSchemaType[] = [];

  for (const item of evidence) {
    const key = [
      item.sourceUrl.trim(),
      item.evidenceQuote.trim(),
      item.locatingPhrase.trim(),
    ].join("\n");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export async function research(query: string) {
  console.log("Agent model setup:", {
    provider: "openrouter",
    researcherAgent: {
      model: RESEARCHER_MODEL_ID,
      reasoningEffort: RESEARCHER_REASONING_EFFORT,
    },
    judgeAgent: {
      model: LIGHTWEIGHT_MODEL_ID,
    },
    summarizerAgent: {
      model: LIGHTWEIGHT_MODEL_ID,
    },
  });

  const context: WorkflowContext = {
    query,
    usedSources: [],
    approvedSourceUrls: [],
    researchEvidence: [],
    judge: { conclusion: "needs_revision", details: null, keepSourceUrls: [], fixes: [] },
    summary: "",
    researchPlan: [],
    stats: createWorkflowRunStats(),
  };

  const {
    getResearchPlanTool,
    createResearchPlanTool,
    updateResearchPlanStepTool,
    listSourcesTool,
    webSearchTool,
    verifyEvidenceTool,
    grepCachedSourcesTool,
  } = createRunTools(context);

  const logJudgeStep = createAgentStepLogger(context.stats, "judgeAgent");
  const logSummarizerStep = createAgentStepLogger(
    context.stats,
    "summarizerAgent",
  );
  const logResearcherStep = createAgentStepLogger(
    context.stats,
    "researcherAgent",
  );

  const judgeAgent = new ToolLoopAgent({
    model: lightweightModel,
    onStepFinish: logJudgeStep,
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
      openrouter: {
        serviceTier: "flex"
      }
    },
    instructions: judgeAgentPrompt,
    output: Output.object({
      schema: judgeVerificationResult,
    }),
    stopWhen: stepCountIs(10),
  });

  let activeSubmissionToken: string | null = null;
  let acceptedSubmissionToken: string | null = null;

  const submitEvidenceTool = tool({
    description:
      "Submit your final candidate evidence set for judge approval. Use this only when you believe the query is sufficiently answered and the evidence has already been checked and cleaned up. Rejections mean revise and continue; acceptance returns the submissionToken required to finish.",
    inputSchema: z.object({
      evidence: z.array(researchEvidenceSchema).min(1),
    }),
    outputSchema: z.object({
      accepted: z.boolean(),
      details: z.string().nullable(),
      keepSourceUrls: z.array(z.string()),
      fixes: z.array(z.string()),
      submissionToken: z.string().nullable(),
    }),
    execute: async ({ evidence }) => {
      const dedupedEvidence = dedupeResearchEvidence(evidence);
      const judgedSources = buildJudgeSources(context, dedupedEvidence);
      const result = await judgeAgent.generate({
        prompt: `User query: ${context.query}\nCandidate sources: ${JSON.stringify(
          judgedSources,
        )}`,
      });

      context.judge = result.output;
      if (result.output.conclusion !== "accepted") {
        context.approvedSourceUrls = [];
        acceptedSubmissionToken = null;
        console.log("Submit evidence rejected:", context.judge);
        return {
          accepted: false,
          details: result.output.details,
          keepSourceUrls: result.output.keepSourceUrls,
          fixes: result.output.fixes,
          submissionToken: null,
        };
      }

      context.approvedSourceUrls = judgedSources
        .filter((source) => source.quotes.some((quote) => quote.quoteFound))
        .map((source) => source.sourceUrl);
      context.researchEvidence = dedupedEvidence.filter((item) =>
        context.approvedSourceUrls.includes(item.sourceUrl),
      );

      console.log("Submit evidence accepted:", {
        approvedSourceUrls: context.approvedSourceUrls,
      });

      acceptedSubmissionToken = activeSubmissionToken;

      return {
        accepted: true,
        details: null,
        keepSourceUrls: context.approvedSourceUrls,
        fixes: [],
        submissionToken: activeSubmissionToken,
      };
    },
  });

  const summarizerAgent = new ToolLoopAgent({
    model: lightweightModel,
    onStepFinish: logSummarizerStep,
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
      openrouter: {
        serviceTier: "flex"
      }
    },
    instructions:
      summarizerAgentPrompt,
    stopWhen: stepCountIs(10),
  });

  const researcherAgent = new ToolLoopAgent({
    model: researcherModel,
    onStepFinish: logResearcherStep,
    providerOptions: {
      openrouter: {
        reasoning: {
          effort: RESEARCHER_REASONING_EFFORT,
        },
        serviceTier: "flex"
      },
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    output: Output.object({
      schema: z.object({
        submissionToken: z.string(),
      }),
    }),
    tools: {
      getResearchPlanTool,
      createResearchPlanTool,
      updateResearchPlanStepTool,
      webSearchTool,
      listSourcesTool,
      verifyEvidenceTool,
      submitEvidenceTool,
      grepCachedSourcesTool,
    },
    stopWhen: stepCountIs(MAX_RESEARCH_AGENT_STEPS),
    instructions: researchAgentPrompt,
  });

  async function runResearchStage() {
    context.judge = { conclusion: "needs_revision", details: null, keepSourceUrls: [], fixes: [] };
    context.approvedSourceUrls = [];
    context.researchEvidence = [];
    activeSubmissionToken = randomUUID();
    acceptedSubmissionToken = null;

    const output = await researcherAgent.generate({
      prompt: `User query: ${context.query}`,
    });

    let returnedSubmissionToken: string | null = null;
    try {
      returnedSubmissionToken = output.output.submissionToken;
    } catch (error) {
      if (
        context.judge.conclusion === "accepted" &&
        acceptedSubmissionToken !== null
      ) {
        returnedSubmissionToken = acceptedSubmissionToken;
      } else {
        throw error;
      }
    }

    if (
      !activeSubmissionToken ||
      returnedSubmissionToken !== activeSubmissionToken
    ) {
      throw new Error(
        "Researcher returned without successfully calling submitEvidenceTool.",
      );
    }

    if (context.researchEvidence.length > 0 && context.usedSources.length === 0) {
      throw new Error(
        "No sources were cached in the research stage, but evidence was returned. This should not happen.",
      );
    }

    if (context.judge.conclusion !== "accepted") {
      throw new Error("Researcher returned without accepted judge approval.");
    }

    const approvedEvidence = getApprovedEvidence(context);

    console.log("Research agent output:", {
      evidenceCount: context.researchEvidence.length,
      usedSourcesCount: context.usedSources.length,
      citedSourceUrls: [
        ...new Set(context.researchEvidence.map((item) => item.sourceUrl)),
      ],
      verifiedCount: approvedEvidence.filter((item) => item.quoteFound).length,
    });

    activeSubmissionToken = null;
    acceptedSubmissionToken = null;
  }

  async function runSummarizationStage() {
    const approvedEvidence = getApprovedEvidence(context);
    const judgeFeedback =
      context.judge.conclusion === "needs_revision"
        ? `\nJudge feedback: ${context.judge.details}`
        : "";

    const summary = await summarizerAgent.generate({
      prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
        approvedEvidence,
      )}${judgeFeedback}`,
    });

    context.summary = summary.text;
    console.log("Summarizer output generated.");
  }

  await runResearchStage();
  await runSummarizationStage();

  return context;
}
