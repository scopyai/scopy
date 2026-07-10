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
    maxSteps: 16,
  },
  subagent: {
    reasoningEffort: "low" as ReviewReasoningEffort,
    maxSteps: 40,
  },
  verifier: {
    reasoningEffort: "medium" as ReviewReasoningEffort,
    maxSteps: 18,
    maxFindingsPerCall: 8,
    maxFailedOpenEscalations: 5,
  },
  naturalLanguageLinter: {
    maxSteps: 5,
  },
  reportComposer: {
    reasoningEffort: "low" as ReviewReasoningEffort,
    maxSteps: 2,
  },
  repositoryContext: {
    maxSteps: 40,
    maxAgeDays: 14,
  },
  openai: {
    serviceTier: "flex" as "flex" | "priority" | "default",
  },
}
