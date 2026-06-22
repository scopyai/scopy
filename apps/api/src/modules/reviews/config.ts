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
  },
  subagent: {
    reasoningEffort: "high" as ReviewReasoningEffort,
  },
  openai: {
    serviceTier: "flex" as "flex" | "priority" | "default",
  },
}
