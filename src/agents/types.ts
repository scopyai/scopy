import { z } from "zod";

export type stage =
  | "init"
  | "research"
  | "evaluation"
  | "summarization"
  | "done";

export type runnableStage = Exclude<stage, "init" | "done">;

export const sourceEngineResult = z.object({
  url: z.url(),
  title: z.string(),
  description: z.string(),
});

export const sourceQualifiedResult = sourceEngineResult.extend({
  body: z.string(),
  metadata: z.record(z.string(), z.string()),
  authors: z.array(z.string()),
  publishedDate: z.date().optional(),
  sourceName: z.string().optional(),
});
export type sourceQualifiedType = z.infer<typeof sourceQualifiedResult>;

export const researchEvidence = z.object({
  sourceUrl: z.url(),
  evidenceQuote: z.string(),
});
export type researchEvidenceType = z.infer<typeof researchEvidence>;

// export const judgeVerificationResult = z.object({
//   sourcesRelevant: z.boolean(),
//   researchRelevant: z.boolean(),
//   sourcesIrrelevantDetails: z.string().optional(), // just strings for now, later adapting to structural output
//   researchIrrelevantDetails: z.string().optional(),
// });

export const judgeVerificationResult = z.discriminatedUnion("conclusion", [
  z.object({
    conclusion: z.literal("relevant"),
  }),
  z.object({
    conclusion: z.literal("needs_revision"),
    details: z
      .string()
      .describe(
        "Details on what is missing or wrong with the sources/evidence and how to improve them",
      ),
  }),
]);

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
