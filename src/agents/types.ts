import { z } from "zod";

export type stage =
  | "initial"
  | "source-finder"
  | "source-qualifier"
  | "researcher"
  | "judge"
  | "summarizer"
  | "done";

export type runnableStage = Exclude<stage, "initial" | "done">;

export const sourceEngineResult = z.object({
  url: z.url(),
  title: z.string(),
  description: z.string(),
});
export type sourceEngineType = z.infer<typeof sourceEngineResult>;

export const sourceQualifiedResult = sourceEngineResult.extend({
  body: z.string(),
  metadata: z.record(z.string(), z.string()),
  authors: z.array(z.string()),
  publishedDate: z.date().optional(),
  sourceName: z.string().optional(),
});
export type sourceQualifiedType = z.infer<typeof sourceQualifiedResult>;

export const researchEvidence = z.object({
  source: sourceQualifiedResult,
  evidenceQuote: z.string(),
});
export type researchEvidenceType = z.infer<typeof researchEvidence>;

export const judgeVerificationResult = z.object({
  sourcesRelevant: z.boolean(),
  researchRelevant: z.boolean(),
  sourcesIrrelevantDetails: z.string().optional(), // just strings for now, later adapting to structural output
  researchIrrelevantDetails: z.string().optional(),
});
export type judgeVerificationResultType = z.infer<
  typeof judgeVerificationResult
>;

export type WorkflowContext = {
  query: string;

  currentStage: stage;

  fetchedSources: sourceEngineType[];
  qualifiedSources: sourceEngineType[];
  fetchedSourceDetails: sourceQualifiedType[];
  authoritativeSources: sourceQualifiedType[];
  researchEvidence: researchEvidenceType[];

  judge: judgeVerificationResultType;
  summary: string;
};
