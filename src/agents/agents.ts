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
import { judgeAgentPrompt, researchAgentPrompt } from "./prompts";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { enrichResearchEvidence } from "./evidence";
import { createAgentStepLogger, createWorkflowRunStats } from "./stats";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY as string,
});

const researcherBaseModel = openrouter.chat("openai/gpt-5.4-mini");
const lightweightBaseModel = openrouter.chat("openai/gpt-oss-120b:free");

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

const MAX_RESEARCH_AGENT_STEPS = 45;

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
    context.researchEvidence,
    context.usedSources,
  ).filter((item) => approvedSourceUrlSet.has(item.sourceUrl));
}

function getApprovedSources(context: WorkflowContext) {
  const approvedSourceUrlSet = new Set(context.approvedSourceUrls);
  return context.usedSources.filter((source) => approvedSourceUrlSet.has(source.url));
}

export async function research(query: string) {
  const context: WorkflowContext = {
    query,
    usedSources: [],
    approvedSourceUrls: [],
    researchEvidence: [],
    judge: { conclusion: "needs_revision", details: null },
    summary: "",
    researchPlan: [],
    stats: createWorkflowRunStats(),
  };

  const {
    getResearchPlanTool,
    saveResearchPlanTool,
    listSourcesTool,
    webSearchTool,
    verifyEvidenceTool,
    searchCachedSourcesTool,
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
    },
    instructions: judgeAgentPrompt,
    output: Output.object({
      schema: judgeVerificationResult,
    }),
    stopWhen: stepCountIs(10),
  });

  let activeSubmissionToken: string | null = null;

  const submitEvidenceTool = tool({
    description:
      "Submit your draft evidence for final verification and judge approval. This tool verifies the quotes against cached full text, asks the judge subagent for approval, and only returns a submissionToken when the evidence is accepted. You may only finish after this tool returns accepted=true with a submissionToken.",
    inputSchema: z.object({
      evidence: z.array(researchEvidenceSchema).min(1),
    }),
    outputSchema: z.object({
      accepted: z.boolean(),
      details: z.string().nullable(),
      submissionToken: z.string().nullable(),
    }),
    execute: async ({ evidence }) => {
      const judgedSources = buildJudgeSources(context, evidence);
      const result = await judgeAgent.generate({
        prompt: `User query: ${context.query}\nCandidate sources: ${JSON.stringify(
          judgedSources,
        )}`,
      });

      context.judge = result.output;
      if (result.output.conclusion !== "accepted") {
        context.approvedSourceUrls = [];
        console.log("Submit evidence rejected:", context.judge);
        return {
          accepted: false,
          details: result.output.details,
          submissionToken: null,
        };
      }

      context.approvedSourceUrls = judgedSources
        .filter((source) => source.quotes.some((quote) => quote.quoteFound))
        .map((source) => source.sourceUrl);
      context.researchEvidence = evidence.filter((item) =>
        context.approvedSourceUrls.includes(item.sourceUrl),
      );

      console.log("Submit evidence accepted:", {
        approvedSourceUrls: context.approvedSourceUrls,
      });

      return {
        accepted: true,
        details: null,
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
    },
    instructions:
      "You receive the user query, research evidence, used sources, and optionally judge feedback. Write a direct answer grounded only in the supplied evidence. Answer the full question, not just one part. For comparison questions, state the basis of comparison, the result of the comparison, the main distinctions, and any important caveats or ambiguities if the evidence requires them. You may perform simple calculations, unit conversions, ordering by magnitude, and direct inferences when the quoted evidence contains the needed inputs. If the judge feedback says the evidence is incomplete, still provide the best-supported answer and explicitly state the limitation instead of refusing to answer.",
    stopWhen: stepCountIs(10),
  });

  const researcherAgent = new ToolLoopAgent({
    model: researcherModel,
    onStepFinish: logResearcherStep,
    providerOptions: {
      openrouter: {
        reasoning: {
          effort: "medium",
        },
        openai: {
          serviceTier: "flex",
        } satisfies OpenAILanguageModelResponsesOptions,
      },
    },
    output: Output.object({
      schema: z.object({
        submissionToken: z.string(),
      }),
    }),
    tools: {
      getResearchPlanTool,
      saveResearchPlanTool,
      webSearchTool,
      listSourcesTool,
      verifyEvidenceTool,
      submitEvidenceTool,
      searchCachedSourcesTool,
    },
    stopWhen: stepCountIs(MAX_RESEARCH_AGENT_STEPS),
    instructions: researchAgentPrompt,
  });

  async function runResearchStage() {
    context.judge = { conclusion: "needs_revision", details: null };
    context.approvedSourceUrls = [];
    context.researchEvidence = [];
    activeSubmissionToken = randomUUID();

    const output = await researcherAgent.generate({
      prompt: `User query: ${context.query}`,
    });

    const returnedSubmissionToken = output.output.submissionToken;
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
  }

  async function runSummarizationStage() {
    const approvedEvidence = getApprovedEvidence(context);
    const approvedSources = getApprovedSources(context);
    const judgeFeedback =
      context.judge.conclusion === "needs_revision"
        ? `\nJudge feedback: ${context.judge.details}`
        : "";

    const summary = await summarizerAgent.generate({
      prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
        approvedEvidence,
      )}\nUsed sources: ${JSON.stringify(approvedSources)}${judgeFeedback}`,
    });

    context.summary = summary.text;
    console.log("Summarizer output generated.");
  }

  await runResearchStage();
  await runSummarizationStage();

  return context;
}
