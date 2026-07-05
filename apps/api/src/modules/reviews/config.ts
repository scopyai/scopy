export type ReviewReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

export const reviewAgentConfig = {
  main: {
    reasoningEffort: "low" as ReviewReasoningEffort,
    maxSteps: 80,
  },
  subagent: {
    reasoningEffort: "high" as ReviewReasoningEffort,
    maxSteps: 40,
  },
  naturalLanguageLinter: {
    maxSteps: 5,
  },
  repositoryContext: {
    maxSteps: 40,
  },
  openai: {
    serviceTier: "flex" as "flex" | "priority" | "default",
  },
}
