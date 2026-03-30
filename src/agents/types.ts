import { z } from "zod";

export type stage =
  | "init"
  | "research"
  | "evaluation"
  | "summarization"
  | "done";

export type runnableStage = Exclude<stage, "init" | "done">;

export const sourceEngineResult = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
});

export const sourceQualifiedResult = sourceEngineResult.extend({
  body: z.string(),
  metadata: z.record(z.string(), z.string()),
  authors: z.array(z.string()),
  publishedDate: z.string().optional(),
  sourceName: z.string().optional(),
});
export type sourceQualifiedType = z.infer<typeof sourceQualifiedResult>;

export const researchEvidence = z.object({
  sourceUrl: z.string(),
  evidenceQuote: z.string(),
});
export type researchEvidenceType = z.infer<typeof researchEvidence>;

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

export type WorkflowContext = {
  query: string;

  currentStage: stage;

  usedSources: sourceQualifiedType[];
  researchEvidence: researchEvidenceType[];
  judge: judgeVerificationResultType;
  summary: string;

  judgeFeedbackAttempts: number;
};
