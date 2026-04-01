import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { sourceQualifiedType, stage, WorkflowContext } from "./types";
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

const selectedModel = wrapLanguageModel({
  model: openai("gpt-5.4"),
  middleware: devToolsMiddleware(),
});

const MAX_STEP_COUNT = 10;
const MAX_JUDGE_FEEDBACK_ATTEMPTS = 3;
const MAX_SOURCE_AGENT_STEPS = 8;

function logAgentStep(
  agentName: string,
  {
    stepNumber,
    usage,
    toolCalls,
    toolResults,
  }: {
    stepNumber: number;
    usage: { totalTokens: number | undefined };
    toolCalls: Array<{ toolName: string }>;
    toolResults: Array<{ toolName: string }>;
  },
) {
  console.log(`Agent ${agentName} step ${stepNumber}:`, {
    totalTokens: usage.totalTokens ?? 0,
    toolCalls: toolCalls.map((toolCall) => toolCall.toolName),
    toolResults: toolResults.map((toolResult) => toolResult.toolName),
  });
}

const judgeAgent = new ToolLoopAgent({
  model: selectedModel,
  onStepFinish: async ({ stepNumber, usage, toolCalls, toolResults }) => {
    logAgentStep("judgeAgent", {
      stepNumber,
      usage,
      toolCalls,
      toolResults,
    });
  },
  instructions: judgeAgentPrompt,
  output: Output.object({
    schema: judgeVerificationResult,
  }),
  stopWhen: stepCountIs(10),
});

const summarizerAgent = new ToolLoopAgent({
  model: selectedModel,
  onStepFinish: async ({ stepNumber, usage, toolCalls, toolResults }) => {
    logAgentStep("summarizerAgent", {
      stepNumber,
      usage,
      toolCalls,
      toolResults,
    });
  },
  instructions:
    "You receive the user query, research evidence, and used sources. Write a direct answer grounded only in the supplied evidence. Answer the full question, not just one part. For comparison questions, state the basis of comparison, the result of the comparison, the main distinctions, and any important caveats or ambiguities if the evidence requires them.",
  stopWhen: stepCountIs(10),
});

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
    judgeFeedbackAttempts: 0,
  };

  const { webSearchTool, webPageParseTool, verifyEvidenceTool } =
    createRunTools(context);

  const sourceAgent = new ToolLoopAgent({
    model: selectedModel,
    instructions: sourceAgentPrompt,
    output: Output.object({
      schema: z.object({
        sources: z.array(sourceQualifiedResult),
      }),
    }),
    tools: {
      webSearch: webSearchTool,
      parsePageTool: webPageParseTool,
    },
    stopWhen: stepCountIs(MAX_SOURCE_AGENT_STEPS),
    onStepFinish: async ({ stepNumber, usage, toolCalls, toolResults }) => {
      logAgentStep("sourceAgent", {
        stepNumber,
        usage,
        toolCalls,
        toolResults,
      });
    },
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
      const sources = output.output.sources.filter(
        (source) => !previousUrlSet.has(source.url),
      );

      console.log(
        "sourceTool returned sources:",
        sources.map((source) => source.url),
      );

      return { sources };
    },
  });

  const researcherAgent = new ToolLoopAgent({
    model: selectedModel,
    onStepFinish: async ({ stepNumber, usage, toolCalls, toolResults }) => {
      logAgentStep("researcherAgent", {
        stepNumber,
        usage,
        toolCalls,
        toolResults,
      });
    },
    output: Output.object({
      schema: z.object({
        evidence: z.array(researchEvidence),
      }),
    }),
    tools: {
      getSourcesTool: sourceTool,
      verifyEvidenceTool,
    },
    stopWhen: stepCountIs(10),
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
            ? `User query: ${context.query}\nPrevious research evidence: ${JSON.stringify(context.researchEvidence)}\nPrevious used source URLs: ${JSON.stringify(context.usedSources.map((source) => source.url))}\nJudge feedback: ${context.judge.details}`
            : `User query: ${context.query}`;

        const output = await researcherAgent.generate({
          prompt,
        });

        context.researchEvidence = output.output.evidence;
        context.verifiedResearchEvidence = [];

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

        console.log("Research agent output:", context.researchEvidence);
        return;
      }
      case "evaluation": {
        context.verifiedResearchEvidence = enrichResearchEvidence(
          context.researchEvidence,
          context.usedSources,
        );

        console.log(
          "Verified research evidence:",
          context.verifiedResearchEvidence,
        );

        const output = await judgeAgent.generate({
          prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
            context.verifiedResearchEvidence,
          )}\nUsed sources: ${JSON.stringify(context.usedSources)}`,
        });

        context.judge = output.output;

        console.log("Judge agent output:", context.judge);
        if (output.output.conclusion === "needs_revision") {
          if (context.judgeFeedbackAttempts >= MAX_JUDGE_FEEDBACK_ATTEMPTS) {
            context.currentStage = "done";
            console.log(
              "Maximum judge feedback attempts reached. Ending workflow.",
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
          )}\nUsed sources: ${JSON.stringify(context.usedSources)}`,
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
