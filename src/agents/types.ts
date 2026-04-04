import { z } from "zod";

export type stage =
  | "init"
  | "research"
  | "evaluation"
  | "summarization"
  | "done";

export type agentName =
  | "researcherAgent"
  | "sourceAgent"
  | "judgeAgent"
  | "summarizerAgent";

export type runnableStage = Exclude<stage, "init" | "done">;

export type tokenUsageStats = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
};

export type toolCallStats = {
  requested: number;
  completed: number;
  requestedByName: Record<string, number>;
  completedByName: Record<string, number>;
};

export type agentRunStats = {
  stepCount: number;
  tokenUsage: tokenUsageStats;
  toolCalls: toolCallStats;
};

export type workflowRunStats = {
  steps: number;
  tokenUsage: tokenUsageStats;
  toolCalls: toolCallStats;
  byAgent: Record<agentName, agentRunStats>;
};

export const sourceEngineResult = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
});
export type sourceEngineResultType = z.infer<typeof sourceEngineResult>;

export const sourceQualifiedResult = sourceEngineResult.extend({
  body: z.string(),
  metadata: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
  authors: z.array(z.string()),
  publishedDate: z.string().nullable(),
  sourceName: z.string().nullable(),
});
export type sourceQualifiedType = z.infer<typeof sourceQualifiedResult>;

export const researchEvidence = z.object({
  sourceUrl: z
    .string()
    .describe("The URL of the source from which this evidence is extracted."),
  evidenceQuote: z
    .string()
    .describe(
      "An exact quote from the source that supports, contradicts, or qualifies the answer to the query.",
    ),
  locatingPhrase: z
    .string()
    .describe(
      "A short exact phrase copied from the same source near the evidence quote to help locate it in the source content.",
    ),
});
export type researchEvidenceType = z.infer<typeof researchEvidence>;

export const evidenceMatchType = z.enum(["exact", "normalized", "not_found"]);
export type evidenceMatchTypeType = z.infer<typeof evidenceMatchType>;

export const enrichedResearchEvidence = researchEvidence.extend({
  sourceFound: z.boolean(),
  quoteFound: z.boolean(),
  quoteMatchType: evidenceMatchType,
});
export type enrichedResearchEvidenceType = z.infer<
  typeof enrichedResearchEvidence
>;

export const judgeVerificationResult = z.object({
  conclusion: z.enum(["relevant", "needs_revision"]),
  details: z
    .string()
    .nullable()
    .describe(
      "Details on what is missing or wrong with the sources/evidence and how to improve them. Use null when conclusion is relevant.",
    ),
});

export type judgeVerificationResultType = z.infer<
  typeof judgeVerificationResult
>;

export const researchPlanStatus = z.enum([
  "pending",
  "in_progress",
  "completed",
]);
export type researchPlanStatusType = z.infer<typeof researchPlanStatus>;

export const researchPlanItem = z.object({
  step: z.string(),
  status: researchPlanStatus,
});
export type researchPlanItemType = z.infer<typeof researchPlanItem>;

export type WorkflowContext = {
  query: string;

  currentStage: stage;

  fetchedSources: sourceEngineResultType[];
  usedSources: sourceQualifiedType[];
  researchEvidence: researchEvidenceType[];
  verifiedResearchEvidence: enrichedResearchEvidenceType[];
  judge: judgeVerificationResultType;
  summary: string;
  researchPlan: researchPlanItemType[];
  stats: workflowRunStats;

  judgeFeedbackAttempts: number;
};
