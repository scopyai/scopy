import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { sourceQualifiedType, stage, WorkflowContext } from "./types";
import {
  judgeVerificationResult,
  researchEvidence,
  sourceQualifiedResult,
} from "./types";
import { webPageParseTool, webSearchTool } from "./tools";
import {
  judgeAgentPrompt,
  researchAgentPrompt,
  sourceAgentPrompt,
  sourceToolDescription,
} from "./prompts";
import { wrapLanguageModel } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";

const selectedModel = wrapLanguageModel({
  model: openai("gpt-5.4"),
  middleware: devToolsMiddleware(),
});

const MAX_STEP_COUNT = 10;
const MAX_JUDGE_FEEDBACK_ATTEMPTS = 3;
const MAX_SOURCE_AGENT_STEPS = 8;

let latestQualifiedSourcesFromTool: sourceQualifiedType[] = [];

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

function normalizeUrlForComparison(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function dedupeQualifiedSources(parsedSources: sourceQualifiedType[]) {
  return Array.from(
    new Map(
      parsedSources.map((source) => [
        normalizeUrlForComparison(source.url),
        source,
      ]),
    ).values(),
  );
}

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

    let output;
    try {
      output = await sourceAgent.generate({
        prompt: promptParts.join("\n"),
      });
    } catch (error) {
      console.error("sourceAgent failed:", error);
      throw error;
    }

    let sources = dedupeQualifiedSources(output.output.sources);

    if (previousSources && previousSources.length > 0) {
      const previousUrlSet = new Set(
        previousSources.map(normalizeUrlForComparison),
      );
      sources = sources.filter(
        (source) => !previousUrlSet.has(normalizeUrlForComparison(source.url)),
      );
    }

    latestQualifiedSourcesFromTool = dedupeQualifiedSources([
      ...latestQualifiedSourcesFromTool,
      ...sources,
    ]);

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
  },
  stopWhen: stepCountIs(10),
  instructions: researchAgentPrompt,
});

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
    "You receive the research results and the user query. You need to summarize the evidence to answer the user query.",
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

async function runAgentForStage(
  context: WorkflowContext,
): Promise<WorkflowContext> {
  if (context.currentStage === "done" || context.currentStage === "init") {
    return context;
  }

  switch (context.currentStage) {
    case "research": {
      const prompt =
        context.judgeFeedbackAttempts > 0 &&
        context.judge.conclusion === "needs_revision"
          ? `User query: ${context.query}\nPrevious research evidence: ${JSON.stringify(context.researchEvidence)}\nPrevious used source URLs: ${JSON.stringify(context.usedSources.map((source) => source.url))}\nJudge feedback: ${context.judge.details}`
          : `User query: ${context.query}`;

      latestQualifiedSourcesFromTool = [];

      const output = await researcherAgent.generate({
        prompt,
      });

      context.researchEvidence = output.output.evidence;
      context.usedSources = dedupeQualifiedSources(
        latestQualifiedSourcesFromTool,
      );
      latestQualifiedSourcesFromTool = [];

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
      return context;
    }
    case "evaluation": {
      const output = await judgeAgent.generate({
        prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
          context.researchEvidence,
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
          return context;
        }

        context.currentStage = "init";
        context.judgeFeedbackAttempts += 1;
        console.log(
          "Judge feedback indicates revision needed. Restarting research stage.",
        );
        return context;
      }

      console.log("Evaluation complete. Moving to summarization stage.");
      return context;
    }
    case "summarization": {
      const output = await summarizerAgent.generate({
        prompt: `User query: ${context.query}\nResearch evidence: ${JSON.stringify(
          context.researchEvidence,
        )}\nUsed sources: ${JSON.stringify(context.usedSources)}`,
      });
      context.summary = output.output;
      console.log("Summarizer agent output:", context.summary);

      return context;
    }
  }
}

export async function research(query: string) {
  let context: WorkflowContext = {
    query,
    currentStage: "init",
    usedSources: [],
    researchEvidence: [],
    judge: { conclusion: "needs_revision", details: null },
    summary: "",
    judgeFeedbackAttempts: 0,
  };

  let stepCount = 0;

  while (context.currentStage !== "done") {
    if (stepCount > MAX_STEP_COUNT) {
      return context;
    }

    context = await runAgentForStage(context);
    context.currentStage = getNextStage(context.currentStage);
    stepCount++;
  }

  return context;
}
