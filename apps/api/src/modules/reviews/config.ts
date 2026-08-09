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
  semanticIndex: {
    // The latest Keycloak run sustained about 48 chunks/second. Keep uploads
    // within the 20-second review budget and always prioritize changed files.
    maxUploadChunks: 800,
  },
  openai: {
    serviceTier: "flex" as "flex" | "priority" | "default",
  },
}
