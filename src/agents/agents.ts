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
import { createAgentStepLogger, createWorkflowRunStats } from "./stats";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY as string,
});

const RESEARCHER_MODEL_ID = "openai/gpt-5.4-mini";
const JUDGE_MODEL_ID = "openai/gpt-5.4-mini";
const SUMMARIZER_MODEL_ID = "openai/gpt-5.4-mini";
const RESEARCHER_REASONING_EFFORT = "low" as const;
const JUDGE_REASONING_EFFORT = "low" as const;
const SUMMARIZER_REASONING_EFFORT = "low" as const;

const researcherBaseModel = openrouter.chat(RESEARCHER_MODEL_ID);
const judgeBaseModel = openrouter.chat(JUDGE_MODEL_ID);
const summarizerBaseModel = openrouter.chat(SUMMARIZER_MODEL_ID);

const researcherModel =
  process.env.NODE_ENV === "production"
    ? researcherBaseModel
    : wrapLanguageModel({
        model: researcherBaseModel,
        middleware: devToolsMiddleware(),
      });

const judgeModel =
  process.env.NODE_ENV === "production"
    ? judgeBaseModel
    : wrapLanguageModel({
        model: judgeBaseModel,
        middleware: devToolsMiddleware(),
      });

const summarizerModel =
  process.env.NODE_ENV === "production"
    ? summarizerBaseModel
    : wrapLanguageModel({
        model: summarizerBaseModel,
        middleware: devToolsMiddleware(),
      });

const MAX_RESEARCH_AGENT_STEPS = 60;

function buildJudgeSources(
  context: WorkflowContext,
  evidence: researchEvidenceSchemaType[],
) {
  const enrichedEvidence = enrichResearchEvidence(context, evidence);
  const evidenceBySourceUrl = new Map<string, enrichedResearchEvidenceType[]>();

  for (const item of enrichedEvidence) {
    const existing = evidenceBySourceUrl.get(item.sourceUrl) ?? [];
    existing.push(item);
    evidenceBySourceUrl.set(item.sourceUrl, existing);
  }

  return [...evidenceBySourceUrl.entries()].map(([sourceUrl, chunks]) => {
    const source = context.usedSources.find((item) => item.url === sourceUrl);

    return {
      sourceUrl,
      title: source?.title ?? sourceUrl,
      highlights: source?.highlights ?? [],
      authors: source?.authors ?? [],
      publishedDate: source?.publishedDate ?? null,
      chunks,
    };
  });
}

function getApprovedEvidence(
  context: WorkflowContext,
): enrichedResearchEvidenceType[] {
  const approvedChunkIdSet = new Set(context.approvedChunkIds);
  return enrichResearchEvidence(
    context,
    dedupeResearchEvidence(context.researchEvidence),
  ).filter((item) => approvedChunkIdSet.has(item.chunkId));
}

function dedupeResearchEvidence(
  evidence: researchEvidenceSchemaType[],
): researchEvidenceSchemaType[] {
  const seen = new Set<string>();
  const deduped: researchEvidenceSchemaType[] = [];

  for (const item of evidence) {
    const key = [item.chunkId.trim(), item.relevanceNote.trim()].join("\n");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function enrichResearchEvidence(
  context: WorkflowContext,
  evidence: researchEvidenceSchemaType[],
): enrichedResearchEvidenceType[] {
  return evidence.map((item) => {
    const chunk = context.retrievedChunksById[item.chunkId];
    if (!chunk) {
      throw new Error(`Unknown evidence chunkId submitted: ${item.chunkId}`);
    }

    return {
      ...item,
      sourceUrl: chunk.sourceUrl,
      sourceTitle: chunk.sourceTitle,
      chunkText: chunk.chunkText,
    };
  });
}

export async function research(query: string) {
  console.log("Agent model setup:", {
    provider: "openrouter",
    researcherAgent: {
      model: RESEARCHER_MODEL_ID,
      reasoningEffort: RESEARCHER_REASONING_EFFORT,
    },
    judgeAgent: {
      model: JUDGE_MODEL_ID,
    },
    summarizerAgent: {
      model: SUMMARIZER_MODEL_ID,
    },
  });

  const context: WorkflowContext = {
    query,
    usedSources: [],
    retrievedChunksById: {},
    approvedChunkIds: [],
    researchEvidence: [],
    judge: {
      conclusion: "needs_revision",
      details: null,
      keepChunkIds: [],
      dropChunkIds: [],
      fixes: [],
    },
    summary: "",
    researchPlan: [],
    stats: createWorkflowRunStats(),
  };
  const retrievalRunId = randomUUID();

  const {
    getResearchPlanTool,
    createResearchPlanTool,
    updateResearchPlanStepTool,
    listSourcesTool,
    webSearchTool,
    searchCachedSourceChunksTool,
  } = createRunTools(context, retrievalRunId);

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
    model: judgeModel,
    onStepFinish: logJudgeStep,
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
      openrouter: {
        serviceTier: "flex",
        reasoning: {
          effort: JUDGE_REASONING_EFFORT,
        }
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
      keepChunkIds: z.array(z.string()),
      dropChunkIds: z.array(z.string()),
      fixes: z.array(z.string()),
      submissionToken: z.string().nullable(),
    }),
    execute: async ({ evidence }) => {
      const dedupedEvidence = dedupeResearchEvidence(evidence);
      const judgedSources = buildJudgeSources(context, dedupedEvidence);

      console.log("submitEvidenceTool requested:", {
        evidence: dedupedEvidence,
        sources: judgedSources,
      });

      const result = await judgeAgent.generate({
        prompt: `User query: ${context.query}\nCandidate sources: ${JSON.stringify(
          judgedSources,
        )}`,
      });

      context.judge = result.output;
      if (result.output.conclusion !== "accepted") {
        context.approvedChunkIds = [];
        acceptedSubmissionToken = null;
        console.log("Submit evidence rejected:", context.judge);
        return {
          accepted: false,
          details: result.output.details,
          keepChunkIds: result.output.keepChunkIds,
          dropChunkIds: result.output.dropChunkIds,
          fixes: result.output.fixes,
          submissionToken: null,
        };
      }

      context.approvedChunkIds = result.output.keepChunkIds;
      context.researchEvidence = dedupedEvidence;

      console.log("Submit evidence accepted:", {
        approvedChunkIds: context.approvedChunkIds,
      });

      acceptedSubmissionToken = activeSubmissionToken;

      return {
        accepted: true,
        details: null,
        keepChunkIds: context.approvedChunkIds,
        dropChunkIds: [],
        fixes: [],
        submissionToken: activeSubmissionToken,
      };
    },
  });

  const summarizerAgent = new ToolLoopAgent({
    model: summarizerModel,
    onStepFinish: logSummarizerStep,
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
      openrouter: {
        serviceTier: "flex",
        reasoning: {
          effort: SUMMARIZER_REASONING_EFFORT,
        }
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
      submitEvidenceTool,
      searchCachedSourceChunksTool,
    },
    stopWhen: stepCountIs(MAX_RESEARCH_AGENT_STEPS),
    instructions: researchAgentPrompt,
  });

  async function runResearchStage() {
    console.log("Research stage started:", {
      query: context.query,
      retrievalRunId,
    });

    context.judge = {
      conclusion: "needs_revision",
      details: null,
      keepChunkIds: [],
      dropChunkIds: [],
      fixes: [],
    };
    context.approvedChunkIds = [];
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
        ...new Set(approvedEvidence.map((item) => item.sourceUrl)),
      ],
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

    console.log("Summarization stage started:", {
      query: context.query,
      approvedEvidence,
      judge: context.judge,
    });

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
