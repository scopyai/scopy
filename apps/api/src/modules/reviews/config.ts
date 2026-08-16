export type ReviewReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

export const reviewAgentConfig = {
  main: {
    reasoningEffort: "medium" as ReviewReasoningEffort,
    maxSteps: 40,
  },
  subagent: {
    reasoningEffort: "high" as ReviewReasoningEffort,
    maxSteps: 40,
    concurrency: 1,
    requireCompleteFileCoverage: true,
  },
  verifier: {
    reasoningEffort: "medium" as ReviewReasoningEffort,
    maxSteps: 18,
    concurrency: 4,
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
  },
  retry: {
    maxRetries: 2,
    reportComposerDelaysMs: [
      250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    ],
  },
  semanticIndex: {
    maxUploadChunks: 800,
  },
  openai: {
    serviceTier: "flex" as "flex" | "priority" | "default",
  },
}
