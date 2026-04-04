import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { z } from "zod";
import type { stage, WorkflowContext } from "./types";
import {
  judgeVerificationResult,
  researchEvidence,
  sourceQualifiedResult,
} from "./types";
import { createRunTools } from "./tools";
import {
  judgeAgentPrompt,
  researchAgentPrompt,
  sourceAgentPrompt,
  sourceToolDescription,
} from "./prompts";
import { wrapLanguageModel } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { enrichResearchEvidence } from "./evidence";
import { createAgentStepLogger, createWorkflowRunStats } from "./stats";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY as string,
});

const selectedModel = wrapLanguageModel({
  model: openrouter.chat("openai/gpt-oss-120b"),
  middleware: devToolsMiddleware(),
});

const MAX_STEP_COUNT = 10;
const MAX_JUDGE_FEEDBACK_ATTEMPTS = 2;
const MAX_SOURCE_AGENT_STEPS = 5;
const MAX_RESEARCH_AGENT_STEPS = 18;

function compactSources(context: WorkflowContext) {
  return context.usedSources.map((source) => ({
    url: source.url,
    title: source.title,
    description: source.description,
    authors: source.authors,
    publishedDate: source.publishedDate,
    sourceName: source.sourceName,
  }));
}

function getNextStage(currentStage: stage): stage {
  switch (currentStage) {
    case "init":
      return "research";
    case "research":
      return "evaluation";
    case "evaluation":
      return "summarization";
    case "summarization":
      return "done";
    default:
      return "done";
  }
}

export async function research(query: string) {
  let context: WorkflowContext = {
    query,
    currentStage: "init",
    fetchedSources: [],
    usedSources: [],
    researchEvidence: [],
    verifiedResearchEvidence: [],
    judge: { conclusion: "needs_revision", details: null },
    summary: "",
    researchPlan: [],
    stats: createWorkflowRunStats(),
    judgeFeedbackAttempts: 0,
  };

  const {
    getResearchPlanTool,
    saveResearchPlanTool,
    webSearchTool,
    webPageParseTool,
    verifyEvidenceTool,
    searchCachedSourcesTool,
  } = createRunTools(context);

  const logSourceStep = createAgentStepLogger(context.stats, "sourceAgent");
  const logJudgeStep = createAgentStepLogger(context.stats, "judgeAgent");
  const logSummarizerStep = createAgentStepLogger(
    context.stats,
    "summarizerAgent",
  );
  const logResearcherStep = createAgentStepLogger(
    context.stats,
    "researcherAgent",
  );

  const sourceAgent = new ToolLoopAgent({
    model: selectedModel,
    instructions: sourceAgentPrompt,
    output: Output.object({
      schema: z.object({
        sources: z.array(sourceQualifiedResult),
      }),
    }),
    providerOptions: {
      openai: {
        serviceTier: "flex",
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    tools: {
      webSearch: webSearchTool,
      parsePageTool: webPageParseTool,
    },
    stopWhen: stepCountIs(MAX_SOURCE_AGENT_STEPS),
    onStepFinish: logSourceStep,
  });

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

  const sourceTool = tool({
    description: sourceToolDescription,
    inputSchema: z.object({
      query: z.string().describe("The query to find and verify sources for"),
      corrections: z
        .string()
        .optional()
        .describe(
          "Additional constraints or missing coverage that should shape the search",
        ),
      previousSources: z
        .array(z.string())
        .optional()
        .describe("Source URLs that should not be returned again"),
    }),
    outputSchema: z.object({
      sources: z
        .array(sourceQualifiedResult)
        .describe(
          "A list of verified authoritative sources relevant to the query",
        ),
    }),
    execute: async ({ query, corrections, previousSources }) => {
      console.log("sourceTool called:", {
        query,
        corrections: corrections ?? null,
        previousSources: previousSources ?? [],
      });

      const promptParts = [`Query: ${query}`];

      if (corrections) {
        promptParts.push(`Corrections: ${corrections}`);
      }

      if (previousSources && previousSources.length > 0) {
        promptParts.push(
          `Previous sources to avoid: ${previousSources.join(", ")}`,
        );
      }

      const output = await sourceAgent.generate({
        prompt: promptParts.join("\n"),
      });

      const previousUrlSet = new Set(previousSources ?? []);
      const groundedUrlSet = new Set(context.usedSources.map((source) => source.url));
      const sources = output.output.sources.filter(
        (source) =>
          !previousUrlSet.has(source.url) && groundedUrlSet.has(source.url),
      );

      if (sources.length !== output.output.sources.length) {
        console.log("sourceTool dropped ungrounded sources:", {
          returned: output.output.sources.map((source) => source.url),
          kept: sources.map((source) => source.url),
        });
      }

      console.log(
        "sourceTool returned sources:",
        sources.map((source) => source.url),
      );

      return { sources };
    },
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
        evidence: z.array(researchEvidence),
      }),
    }),
    tools: {
      getResearchPlanTool,
      saveResearchPlanTool,
      getSourcesTool: sourceTool,
      verifyEvidenceTool,
      searchCachedSourcesTool,
    },
    stopWhen: stepCountIs(MAX_RESEARCH_AGENT_STEPS),
    instructions: researchAgentPrompt,
  });

  async function runAgentForStage() {
    if (context.currentStage === "done" || context.currentStage === "init") {
      return;
    }

    switch (context.currentStage) {
      case "research": {
        const prompt =
          context.judgeFeedbackAttempts > 0 &&
          context.judge.conclusion === "needs_revision"
            ? `User query: ${context.query}\nCached used sources count: ${context.usedSources.length}\nCurrent research plan: ${JSON.stringify(context.researchPlan)}\nPrevious research evidence: ${JSON.stringify(context.researchEvidence)}\nPrevious used source URLs: ${JSON.stringify(context.usedSources.map((source) => source.url))}\nJudge feedback: ${context.judge.details}`
            : `User query: ${context.query}\nCached used sources count: ${context.usedSources.length}\nCurrent research plan: ${JSON.stringify(context.researchPlan)}\nCached used source URLs: ${JSON.stringify(context.usedSources.map((source) => source.url))}`;

        const output = await researcherAgent.generate({
          prompt,
        });

        context.researchEvidence = output.output.evidence;
        context.verifiedResearchEvidence = [];

        if (
          context.researchEvidence.length === 0 &&
          context.usedSources.length === 0 &&
          context.researchPlan.some((item) => item.status === "completed")
        ) {
          context.researchPlan = context.researchPlan.map((item) =>
            item.status === "completed" ? { ...item, status: "pending" } : item,
          );

          console.log(
            "Research stage produced no evidence and no sources. Resetting completed plan items to pending.",
          );
        }

        if (
          context.usedSources.length === 0 &&
          context.researchEvidence.length > 0
        ) {
          throw new Error(
            "No sources were qualified in the research stage, but evidence was returned. This should not happen.",
          );
        }

        if (context.judge.conclusion === "needs_revision") {
          context.judge = { conclusion: "needs_revision", details: null };
        }

        console.log("Research agent output:", {
          evidenceCount: context.researchEvidence.length,
          usedSourcesCount: context.usedSources.length,
          sourceUrls: [
            ...new Set(context.researchEvidence.map((item) => item.sourceUrl)),
          ],
        });
        return;
      }
      case "evaluation": {
        context.verifiedResearchEvidence = enrichResearchEvidence(
          context.researchEvidence,
          context.usedSources,
        );

        console.log("Verified research evidence:", {
          count: context.verifiedResearchEvidence.length,
          verifiedCount: context.verifiedResearchEvidence.filter(
            (item) => item.quoteFound,
          ).length,
          sourceUrls: [
            ...new Set(
              context.verifiedResearchEvidence.map((item) => item.sourceUrl),
            ),
          ],
        });

        const output = await judgeAgent.generate({
          prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
            context.verifiedResearchEvidence,
          )}\nUsed sources: ${JSON.stringify(compactSources(context))}`,
        });

        context.judge = output.output;

        console.log("Judge agent output:", context.judge);
        if (output.output.conclusion === "needs_revision") {
          if (context.judgeFeedbackAttempts >= MAX_JUDGE_FEEDBACK_ATTEMPTS) {
            const summaryOutput = await summarizerAgent.generate({
              prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
                context.verifiedResearchEvidence,
              )}\nUsed sources: ${JSON.stringify(
                compactSources(context),
              )}\nJudge conclusion: ${context.judge.conclusion}\nJudge feedback: ${
                context.judge.details ?? "none"
              }`,
            });
            context.summary = summaryOutput.output;
            console.log(
              "Maximum judge feedback attempts reached. Summarizer fallback output:",
              context.summary,
            );
            context.currentStage = "done";
            console.log(
              "Maximum judge feedback attempts reached. Ending workflow with best-effort summary.",
            );
            return;
          }

          context.currentStage = "init";
          context.judgeFeedbackAttempts += 1;
          console.log(
            "Judge feedback indicates revision needed. Restarting research stage.",
          );
          return;
        }

        console.log("Evaluation complete. Moving to summarization stage.");
        return;
      }
      case "summarization": {
        const output = await summarizerAgent.generate({
          prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
            context.verifiedResearchEvidence,
          )}\nUsed sources: ${JSON.stringify(
            compactSources(context),
          )}\nJudge conclusion: ${context.judge.conclusion}\nJudge feedback: ${
            context.judge.details ?? "none"
          }`,
        });
        context.summary = output.output;
        console.log("Summarizer agent output:", context.summary);
      }
    }
  }

  let stepCount = 0;

  while (context.currentStage !== "done") {
    if (stepCount > MAX_STEP_COUNT) {
      return context;
    }

    await runAgentForStage();
    context.currentStage = getNextStage(context.currentStage);
    stepCount++;
  }

  return context;
}
