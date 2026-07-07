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
    maxSteps: 40,
  },
  subagent: {
    reasoningEffort: "high" as ReviewReasoningEffort,
    maxSteps: 40,
  },
  verification: {
    reasoningEffort: "high" as ReviewReasoningEffort,
    maxSteps: 18,
    minApprovedConfidence: 0.9,
    minMainReviewPriority: "high" as "critical" | "high" | "medium" | "low",
    maxFailedOpenEscalationsPerTask: 5,
  },
  deduplication: {
    maxSteps: 4,
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
