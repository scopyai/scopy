import { Agent, Output, stepCountIs, ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";
import type { stage, WorkflowContext, runnableStage } from "./types";
import { sourceEngineResult, sourceQualifiedResult } from "./types";
import { webPageParseTool, webSearchTool } from "./tools";
import { z } from "zod";

const sourceFinderAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  instructions: "You are finding sources for the user query.",
  output: Output.object({
    schema: z.array(sourceEngineResult),
  }),
  tools: {
    webSearch: webSearchTool,
  },
  stopWhen: stepCountIs(20),
});

const sourceQualifierAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent step ${stepNumber}:`, usage.totalTokens);
  },
  tools: {
    webParse: webPageParseTool,
  },
  output: Output.object({
    schema: z.array(sourceQualifiedResult),
  }),
  instructions:
    "You receive a list of sources and the user query. You need to verify the validity and authoritativeness of the sources and return a list of qualified sources. You should use the web scraping tool to check the sources data if needed.",
});

const researcherAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent step ${stepNumber}:`, usage.totalTokens);
  },
  instructions:
    "You receive a list of qualified sources and the user query. You need to find relevant information from the sources to answer the user query. You should use the web scraping tool to check the sources data if needed.",
});

const judgeAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent step ${stepNumber}:`, usage.totalTokens);
  },
  instructions:
    "You receive the research evidence and the user query. You need to judge whether the evidence is relevant to the query and whether it answers the query.",
});

const summarizerAgent = new ToolLoopAgent({
  model: openai("gpt-5.4"),
  onStepFinish: async ({ stepNumber, usage }) => {
    console.log(`Agent step ${stepNumber}:`, usage.totalTokens);
  },
  instructions:
    "You receive the research evidence and the user query. You need to summarize the evidence to answer the user query.",
});

// const agentNameMap = {
//   "source-finder": sourceFinderAgent,
//   "source-qualifier": sourceQualifierAgent,
//   researcher: researcherAgent,
//   judge: judgeAgent,
//   summarizer: summarizerAgent,
// } satisfies Record<runnableStage, Agent<never, any, any>>;

function getNextStage(currentStage: stage): stage {
  switch (currentStage) {
    case "initial":
      return "source-finder";
    case "source-finder":
      return "source-qualifier";
    case "source-qualifier":
      return "researcher";
    case "researcher":
      return "judge";
    case "judge":
      return "summarizer";
    case "summarizer":
      return "done";
    case "done":
      return "done";
  }
}

async function runAgentForStage(
  context: WorkflowContext,
): Promise<WorkflowContext> {
  if (context.currentStage === "initial" || context.currentStage === "done") {
    return context;
  }

  switch (context.currentStage) {
    case "source-finder": {
      const result = await sourceFinderAgent.generate({
        prompt: `User query: ${context.query}`,
      });

      context.qualifiedSources = result.output;

      const fetchedSources = result.steps
        .flatMap((step) => step.staticToolResults)
        .filter((toolResult) => toolResult.toolName === "webSearch")
        .flatMap((toolResult) => toolResult.output)
        .map(({ title, url, body }) => ({
          title,
          url,
          description: body,
        }));
      context.fetchedSources = fetchedSources;
      return context;
    }
    case "source-qualifier": {
      const result = await sourceQualifierAgent.generate({
        prompt: `User query: ${context.query}\nSources: ${JSON.stringify(context.fetchedSources)}`,
      });
      context.authoritativeSources = result.output;

      const fetchedSourceDetails = result.steps;

      return context;
    }
    default:
      return null as any;
  }
}

async function research(query: string) {
  let context: WorkflowContext = {
    query,
    currentStage: "source-finder",
    fetchedSources: [],
    qualifiedSources: [],
    fetchedSourceDetails: [],
    authoritativeSources: [],
    researchEvidence: [],
    judge: {
      sourcesRelevant: false,
      researchRelevant: false,
    },
    summary: "",
  };

  while (context.currentStage !== "done") {
    context.currentStage = getNextStage(context.currentStage);

    context = await runAgentForStage(context);
  }
}
