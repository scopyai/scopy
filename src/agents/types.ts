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

export type sourceScoringRunStats = {
  calls: number;
  failedCalls: number;
  inputSources: number;
  keptSources: number;
  rejectedSources: number;
  tokenUsage: tokenUsageStats;
};

export type workflowRunStats = {
  steps: number;
  tokenUsage: tokenUsageStats;
  toolCalls: toolCallStats;
  sourceScoring: sourceScoringRunStats;
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
  chunkId: z
    .string()
    .describe("Stable identifier of the retrieved chunk used as evidence."),
  relevanceNote: z
    .string()
    .describe(
      "Short note describing what this chunk contributes to the answer.",
    ),
});
export type researchEvidenceSchemaType = z.infer<typeof researchEvidenceSchema>;

export type retrievedChunkType = {
  chunkId: string;
  sourceUrl: string;
  sourceTitle: string;
  chunkText: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  score: number;
};

export type enrichedResearchEvidenceType = researchEvidenceSchemaType & {
  sourceUrl: string;
  sourceTitle: string;
  chunkText: string;
};

export const judgeVerificationResult = z.object({
  conclusion: z.enum(["accepted", "needs_revision"]),
  details: z
    .string()
    .nullable()
    .describe(
      "Short summary of the judge decision. Use null when conclusion is accepted.",
    ),
  keepChunkIds: z
    .array(z.string())
    .describe(
      "Chunk IDs from the submitted evidence that are already good enough to keep for the next revision pass.",
    ),
  dropChunkIds: z
    .array(z.string())
    .describe(
      "Chunk IDs from the submitted evidence that should be removed for the next revision pass.",
    ),
  fixes: z
    .array(z.string())
    .describe(
      "Short specific fixes or missing pieces the researcher should address next. Use an empty list when conclusion is accepted.",
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
  retrievedChunksById: Record<string, retrievedChunkType>;
  approvedChunkIds: string[]; // chunk ids that were approved by the judge and can be used for the final answer
  researchEvidence: researchEvidenceSchemaType[]; // evidence collected by researcher
  judge: judgeVerificationResultType;
  summary: string;
  researchPlan: researchPlanItemType[];
  stats: workflowRunStats;
};
