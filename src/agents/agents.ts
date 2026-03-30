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

// TODO: edit prompts

const MAX_STEP_COUNT = 10;
const MAX_JUDGE_FEEDBACK_ATTEMPTS = 3;

const sourceFinderAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  instructions:
    "You are finding sources for the query. If you receive corrections, you should adjust the query accordingly for the next search step. If you receive previous sources, you should avoid returning those sources in the next search results. You should use the web search tool to find sources.",
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
  description:
    "Use this tool to find sources for a query. This tool will invoke a subagent that specializes in finding sources. You will get a list of filtered relevant sources from a search engine in response.",
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
      output: z.array(sourceQualifiedResult),
    }),
  }),
  stopWhen: stepCountIs(10),
  instructions:
    "You receive a search query. You need to fetch the information and verify the validity and authoritativeness of the sources and return a list of qualified sources. You should use the web scraping tool to check the sources data if needed.",
});

const sourceQualifierTool = tool({
  description:
    "Use this tool to get verified sources for a query. This tool will invoke a subagent that specializes in qualifying sources. You will get a list of verified authoritative sources in response.",
  inputSchema: z.object({
    query: z.string().describe("The query to find and verify sources for"),
  }),
  outputSchema: z.object({
    output: z
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
  instructions:
    "You receive a user query and your goal is to request sources for this query and then answer the question of the user or verify the user's claim based on verified sources you can get via tools. You can also optionally receive a feedback from the judge agent to adjust your research.",
});

const judgeAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent judgeAgent step ${stepNumber}:`, usage.totalTokens);
  },
  instructions:
    "You receive the user query, the research evidence and the sources. You need to judge whether the sources are relevant and authoritative for the query and whether the research evidence is relevant and sufficient to answer the query. You must always return both fields. Set details to null when conclusion is relevant",
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
      context.usedSources = output.toolResults.flatMap((toolResult) =>
        z.array(sourceQualifiedResult).parse(toolResult.output),
      );

      if (context.judge.conclusion === "needs_revision") {
        context.judge = { conclusion: "needs_revision", details: "" };
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
      if (
        output.output.conclusion === "needs_revision" &&
        !context.judge.details
      ) {
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
    judge: { conclusion: "needs_revision", details: "" },
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
