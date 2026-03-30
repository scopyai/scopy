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

  fetchedSources: sourceEngineResultType[];
  usedSources: sourceQualifiedType[];
  researchEvidence: researchEvidenceType[];
  judge: judgeVerificationResultType;
  summary: string;

  judgeFeedbackAttempts: number;
};
