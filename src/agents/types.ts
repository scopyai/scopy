import { z } from "zod";

export type agentName =
  | "researcherAgent"
  | "judgeAgent"
  | "summarizerAgent";

// stats

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


// sources

export const sourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  highlights: z.array(z.string()),
  text: z.string(),
  authors: z.array(z.string()),
  publishedDate: z.string().nullable(),
});

export const shortSourceSchema = sourceSchema.omit({ text: true });
export type shortSourceSchemaType = z.infer<typeof shortSourceSchema>;

export const superShortSourceSchema = sourceSchema.omit({ text: true, highlights: true });
export type superShortSourceSchemaType = z.infer<typeof superShortSourceSchema>;

export type sourceSchemaType = z.infer<typeof sourceSchema>;

export const researchEvidenceSchema = z.object({
  sourceUrl: z
    .string()
    .describe("URL of the cached source that contains this evidence."),
  evidenceQuote: z
    .string()
    .describe(
      "Exact quote from the source that supports, contradicts, or qualifies part of the answer.",
    ),
  locatingPhrase: z
    .string()
    .describe(
      "Short exact nearby phrase from the same source that helps locate the evidence quote in the cached source text.",
    ),
});
export type researchEvidenceSchemaType = z.infer<typeof researchEvidenceSchema>;

export const evidenceMatchOptions = z.enum(["exact", "normalized", "not_found"]);
export type evidenceMatchOptionsType = z.infer<typeof evidenceMatchOptions>;

export const enrichedResearchEvidenceSchema = researchEvidenceSchema.extend({
  sourceFound: z.boolean(),
  quoteFound: z.boolean(),
  quoteMatchType: evidenceMatchOptions,
});
export type enrichedResearchEvidenceType = z.infer<
  typeof enrichedResearchEvidenceSchema
>;

export const judgeVerificationResult = z.object({
  conclusion: z.enum(["accepted", "needs_revision"]),
  details: z
    .string()
    .nullable()
    .describe(
      "Details on what is missing or wrong with the sources/evidence and how to improve them. Use null when conclusion is accepted.",
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
  id: z.number(),
  step: z.string(),
  status: researchPlanStatus,
});
export type researchPlanItemType = z.infer<typeof researchPlanItem>;

export type WorkflowContext = {
  query: string;

  usedSources: sourceSchemaType[]; // store for all sources collected throught the run
  approvedSourceUrls: string[]; // urls that were approved by the judge and can be used for the final answer
  researchEvidence: researchEvidenceSchemaType[]; // evidence collected by researcher
  judge: judgeVerificationResultType;
  summary: string;
  researchPlan: researchPlanItemType[];
  stats: workflowRunStats;
};
