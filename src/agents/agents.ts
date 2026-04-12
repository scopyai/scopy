import { Output, stepCountIs, tool, ToolLoopAgent, wrapLanguageModel } from "ai";
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

const baseModel = openrouter.chat("openai/gpt-oss-120b");

const selectedModel =
  process.env.NODE_ENV === "production"
    ? baseModel
    : wrapLanguageModel({
        model: baseModel,
        middleware: devToolsMiddleware(),
      });

const MAX_RESEARCH_AGENT_STEPS = 30;

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
    model: selectedModel,
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

  const judgeEvidenceTool = tool({
    description:
      "Ask the judge subagent to evaluate your current draft evidence before you finalize. Call this after verifyEvidenceTool. If it returns needs_revision, continue researching in the same loop and fix the identified gaps.",
    inputSchema: z.object({
      evidence: z.array(researchEvidenceSchema).min(1),
    }),
    outputSchema: judgeVerificationResult,
    execute: async ({ evidence }) => {
      const judgedSources = buildJudgeSources(context, evidence);
      const result = await judgeAgent.generate({
        prompt: `User query: ${context.query}\nCandidate sources: ${JSON.stringify(
          judgedSources,
        )}`,
      });

      context.judge = result.output;
      context.approvedSourceUrls =
        result.output.conclusion === "accepted"
          ? judgedSources
              .filter((source) => source.quotes.some((quote) => quote.quoteFound))
              .map((source) => source.sourceUrl)
          : [];

      console.log("Judge evidence tool output:", context.judge);
      return result.output;
    },
  });

  const summarizerAgent = new ToolLoopAgent({
    model: selectedModel,
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
    model: selectedModel,
    onStepFinish: logResearcherStep,
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    output: Output.object({
      schema: z.object({
        evidence: z.array(researchEvidenceSchema),
      }),
    }),
    tools: {
      getResearchPlanTool,
      saveResearchPlanTool,
      webSearchTool,
      listSourcesTool,
      verifyEvidenceTool,
      judgeEvidenceTool,
      searchCachedSourcesTool,
    },
    stopWhen: stepCountIs(MAX_RESEARCH_AGENT_STEPS),
    instructions: researchAgentPrompt,
  });

  async function runResearchStage() {
    const output = await researcherAgent.generate({
      prompt: `User query: ${context.query}`,
    });

    context.researchEvidence = output.output.evidence.filter((item) =>
      context.approvedSourceUrls.includes(item.sourceUrl),
    );

    if (context.researchEvidence.length > 0 && context.usedSources.length === 0) {
      throw new Error(
        "No sources were cached in the research stage, but evidence was returned. This should not happen.",
      );
    }

    if (
      context.judge.conclusion === "needs_revision" &&
      context.judge.details === null
    ) {
      throw new Error(
        "Researcher returned without getting approval from the judge.",
      );
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
