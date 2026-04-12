import { type LanguageModelUsage } from "ai";
import type { agentName, workflowRunStats } from "./types";

type StepStatsInput = {
  stepNumber: number;
  usage: LanguageModelUsage;
  toolCalls: Array<{ toolName: string }>;
  toolResults: Array<{ toolName: string }>;
  reasoningText?: string | undefined;
};

function createEmptyTokenUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  };
}

function createEmptyToolCallStats() {
  return {
    requested: 0,
    completed: 0,
    requestedByName: {} as Record<string, number>,
    completedByName: {} as Record<string, number>,
  };
}

function createEmptyAgentStats() {
  return {
    stepCount: 0,
    tokenUsage: createEmptyTokenUsage(),
    toolCalls: createEmptyToolCallStats(),
  };
}

function incrementNamedCounts(
  counts: Record<string, number>,
  names: string[],
) {
  for (const name of names) {
    counts[name] = (counts[name] ?? 0) + 1;
  }
}

function addUsageTotals(
  target: workflowRunStats["tokenUsage"],
  usage: LanguageModelUsage,
) {
  target.inputTokens += usage.inputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? 0;
  target.reasoningTokens +=
    usage.outputTokenDetails.reasoningTokens ?? usage.reasoningTokens ?? 0;
  target.cachedInputTokens +=
    usage.inputTokenDetails.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
}

export function createWorkflowRunStats(): workflowRunStats {
  return {
    steps: 0,
    tokenUsage: createEmptyTokenUsage(),
    toolCalls: createEmptyToolCallStats(),
    byAgent: {
      researcherAgent: createEmptyAgentStats(),
      judgeAgent: createEmptyAgentStats(),
      summarizerAgent: createEmptyAgentStats(),
    },
  };
}

export function recordAgentStep(
  stats: workflowRunStats,
  agentName: agentName,
  { stepNumber, usage, toolCalls, toolResults, reasoningText }: StepStatsInput,
) {
  const requestedToolNames = toolCalls.map((toolCall) => toolCall.toolName);
  const completedToolNames = toolResults.map((toolResult) => toolResult.toolName);
  const agentStats = stats.byAgent[agentName];

  stats.steps += 1;
  agentStats.stepCount += 1;

  addUsageTotals(stats.tokenUsage, usage);
  addUsageTotals(agentStats.tokenUsage, usage);

  stats.toolCalls.requested += requestedToolNames.length;
  stats.toolCalls.completed += completedToolNames.length;
  agentStats.toolCalls.requested += requestedToolNames.length;
  agentStats.toolCalls.completed += completedToolNames.length;

  incrementNamedCounts(stats.toolCalls.requestedByName, requestedToolNames);
  incrementNamedCounts(stats.toolCalls.completedByName, completedToolNames);
  incrementNamedCounts(agentStats.toolCalls.requestedByName, requestedToolNames);
  incrementNamedCounts(agentStats.toolCalls.completedByName, completedToolNames);

  console.log(`Agent ${agentName} step ${stepNumber}:`, {
    totalTokens: usage.totalTokens ?? 0,
    toolCalls: requestedToolNames,
    toolResults: completedToolNames,
  });

  if (agentName === "researcherAgent" && reasoningText) {
    console.log(`Agent ${agentName} step ${stepNumber} reasoning:`);
    console.log(reasoningText);
  }
}

export function createAgentStepLogger(
  stats: workflowRunStats,
  agentName: agentName,
) {
  return async (step: StepStatsInput) => {
    recordAgentStep(stats, agentName, step);
  };
}
