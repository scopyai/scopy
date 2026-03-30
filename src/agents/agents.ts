import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";
import type { stage, WorkflowContext, runnableStage } from "./types";
import {
  judgeVerificationResult,
  researchEvidence,
  sourceEngineResult,
  sourceQualifiedResult,
} from "./types";
import { webPageParseTool, webSearchTool } from "./tools";
import { z } from "zod";
import {
  judgeAgentPrompt,
  researchAgentPrompt,
  sourceFinderPrompt,
  sourceFinderToolDescription,
  sourceQualifierPrompt,
  sourceQualifierToolDescription,
} from "./prompts";

// TODO: edit prompts

const MAX_STEP_COUNT = 10;
const MAX_JUDGE_FEEDBACK_ATTEMPTS = 3;

const sourceFinderAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  instructions: sourceFinderPrompt,
  output: Output.object({
    schema: z.object({
      sources: z.array(sourceEngineResult),
    }),
  }),
  tools: {
    webSearch: webSearchTool,
  },
  stopWhen: stepCountIs(10),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(
      `Agent sourceFinderAgent step ${stepNumber}:`,
      usage.totalTokens,
    );
  },
});

const sourceFinderTool = tool({
  description: sourceFinderToolDescription,
  inputSchema: z.object({
    query: z.string().describe("The query to find sources for"),
    corrections: z
      .string()
      .optional()
      .describe(
        "Any corrections or adjustments to the query based on previous search results",
      ),
    previousSources: z
      .array(z.string())
      .optional()
      .describe(
        "Input the URLs of sources found in previous steps to avoid duplicates",
      ),
  }),
  outputSchema: z.object({
    sources: z
      .array(sourceEngineResult)
      .describe("A list of sources relevant to the query"),
  }),
  execute: async ({ query, corrections, previousSources }) => {
    let adjustedQuery = query;
    if (corrections) {
      adjustedQuery += `\n\nCorrections: ${corrections}`;
    }

    if (previousSources && previousSources.length > 0) {
      adjustedQuery += `\n\nPrevious sources to avoid: ${previousSources.join(
        ", ",
      )}`;
    }

    console.log("Source Finder Agent - Adjusted Query:", adjustedQuery);

    const output = await sourceFinderAgent.generate({
      prompt: adjustedQuery,
    });

    return output.output;
  },
});

const sourceQualifierAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(
      `Agent sourceQualifierAgent step ${stepNumber}:`,
      usage.totalTokens,
    );
  },
  tools: {
    parsePageTool: webPageParseTool,
    getSourcesTool: sourceFinderTool,
  },
  output: Output.object({
    schema: z.object({
      sources: z.array(sourceQualifiedResult),
    }),
  }),
  stopWhen: stepCountIs(10),
  instructions: sourceQualifierPrompt,
});

const sourceQualifierTool = tool({
  description: sourceQualifierToolDescription,
  inputSchema: z.object({
    query: z.string().describe("The query to find and verify sources for"),
  }),
  outputSchema: z.object({
    sources: z
      .array(sourceQualifiedResult)
      .describe(
        "A list of verified authoritative sources relevant to the query",
      ),
  }),
  execute: async ({ query }) => {
    const output = await sourceQualifierAgent.generate({
      prompt: `Query: ${query}`,
    });
    return output.output;
  },
});

const researcherAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent researcherAgent step ${stepNumber}:`, usage.totalTokens);
  },
  output: Output.object({
    schema: z.object({
      evidence: z.array(researchEvidence),
    }),
  }),
  tools: {
    getSourcesTool: sourceQualifierTool,
  },
  stopWhen: stepCountIs(10),
  instructions: researchAgentPrompt,
});

const judgeAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent judgeAgent step ${stepNumber}:`, usage.totalTokens);
  },
  instructions: judgeAgentPrompt,
  output: Output.object({
    schema: judgeVerificationResult,
  }),
  stopWhen: stepCountIs(10),
});

const summarizerAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent summarizerAgent step ${stepNumber}:`, usage.totalTokens);
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
          ? `User query: ${context.query}\nPrevious research evidence: ${JSON.stringify(context.researchEvidence)}\nJudge feedback: ${context.judge.details}`
          : `User query: ${context.query}`;
      const output = await researcherAgent.generate({
        prompt: prompt,
      });
      context.researchEvidence = output.output.evidence;

      context.usedSources = output.toolResults.flatMap((toolResult) => {
        try {
          return z
            .object({ sources: z.array(sourceQualifiedResult) })
            .parse(toolResult.output).sources;
        } catch {
          return [];
        }
      });

      if (context.usedSources.length === 0) {
        console.log(output);

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
        context.currentStage = "init"; // because it will switch to research stage immediately after this
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
      return;
    }
    context = await runAgentForStage(context);
    context.currentStage = getNextStage(context.currentStage);

    stepCount++;
  }

  return context;
}
