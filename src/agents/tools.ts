import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import {
  researchPlanItem,
  researchPlanStatus,
  WorkflowContext,
  researchEvidenceSchema,
  enrichedResearchEvidenceSchema,
  shortSourceSchema,
  superShortSourceSchema
} from "./types";
import { enrichResearchEvidence } from "./evidence";

const MAX_MATCHES = 10;
const CONTEXT_OUT_CHARS = 200;

const matchesSchema = z.array(
  z.object({
    sourceUrl: z.string(),
    matchedText: z.string(),
    extract: z.string(),
    extractStart: z.number().int(),
    extractEnd: z.number().int(),
    matchStart: z.number().int(),
    matchEnd: z.number().int(),
  }),
);

type matchesType = z.infer<typeof matchesSchema>;

function buildExtract(
  body: string,
  matchStart: number,
  matchEnd: number,
  contextChars: number,
) {
  const extractStart = Math.max(0, matchStart - contextChars);
  const extractEnd = Math.min(body.length, matchEnd + contextChars);
  const prefix = extractStart > 0 ? "..." : "";
  const suffix = extractEnd < body.length ? "..." : "";

  return {
    extract: `${prefix}${body.slice(extractStart, extractEnd)}${suffix}`,
    extractStart,
    extractEnd,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addToSources(
  context: WorkflowContext,
  input: {
    url: string;
    title: string;
    highlights: string[];
    text: string;
    author: string | null;
    publishedDate: string | null;
  },
) {
  const existingIndex = context.usedSources.findIndex(
    (source) => source.url === input.url,
  );

  const nextSource = {
    url: input.url,
    title: input.title,
    highlights: input.highlights,
    text: input.text,
    authors: input.author ? [input.author] : [],
    publishedDate: input.publishedDate,
  };

  if (existingIndex < 0) {
    context.usedSources.push(nextSource);
    return;
  }

  const existing = context.usedSources[existingIndex];
  if (!existing) {
    context.usedSources.push(nextSource);
    return;
  }

  context.usedSources[existingIndex] = {
    ...existing,
    title: nextSource.title || existing.title,
    highlights:
      nextSource.highlights.length >= existing.highlights.length
        ? nextSource.highlights
        : existing.highlights,
    text:
      nextSource.text.length >= existing.text.length
        ? nextSource.text
        : existing.text,
    authors:
      nextSource.authors.length > 0 ? nextSource.authors : existing.authors,
    publishedDate: nextSource.publishedDate ?? existing.publishedDate,
  };
}

function buildSearchPattern(
  pattern: string,
  options: { isRegex: boolean; isCaseSensitive: boolean },
) {
  const sourcePattern = options.isRegex ? pattern : escapeRegExp(pattern);
  const flags = `g${options.isCaseSensitive ? "" : "i"}`;
  return new RegExp(sourcePattern, flags);
}

export function createRunTools(context: WorkflowContext) {
  const getResearchPlanTool = tool({
    description:
      "Read the persistent research plan for this run. Each step has a stable id. Use this at the start and whenever you need to check what is still pending.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      plan: z.array(researchPlanItem),
    }),
    execute: async () => {
      console.log("getResearchPlanTool results:", {
        count: context.researchPlan.length,
        statuses: context.researchPlan.map((item) => item.status),
      });

      return { plan: context.researchPlan };
    },
  });

  const createResearchPlanTool = tool({
    description:
      "Create the initial research plan for this run. Provide only short step texts. This tool assigns stable numeric ids and sets every step to pending.",
    inputSchema: z.object({
      steps: z.array(z.string().min(1)).min(1).max(8),
    }),
    outputSchema: z.object({
      plan: z.array(researchPlanItem),
    }),
    execute: async ({ steps }) => {
      const hadExistingPlan = context.researchPlan.length > 0;

      if (!hadExistingPlan) {
        context.researchPlan = steps.map((step, index) => ({
          id: index + 1,
          step,
          status: "pending" as const,
        }));
      }

      console.log("createResearchPlanTool results:", {
        count: context.researchPlan.length,
        items: context.researchPlan.map((item) => ({
          id: item.id,
          step: item.step,
          status: item.status,
        })),
        hadExistingPlan,
      });

      return { plan: context.researchPlan };
    },
  });

  const updateResearchPlanStepTool = tool({
    description:
      "Update one research plan step by its stable id. Use this after the initial plan exists to mark a step pending, in_progress, or completed.",
    inputSchema: z.object({
      id: z.number().describe("Stable id of the plan step to update."),
      status: researchPlanStatus.describe("New status for this step."),
    }),
    outputSchema: z.object({
      plan: z.array(researchPlanItem),
    }),
    execute: async ({ id, status }) => {
      const existingIndex = context.researchPlan.findIndex((item) => item.id === id);

      if (existingIndex < 0) {
        throw new Error(`Research plan step not found: ${id}`);
      }

      const existing = context.researchPlan[existingIndex];
      if (!existing) {
        throw new Error(`Research plan step not found: ${id}`);
      }

      const updatedItem = {
        ...existing,
        status,
      };

      context.researchPlan[existingIndex] = updatedItem;

      console.log("updateResearchPlanStepTool results:", {
        id,
        status,
        items: context.researchPlan.map((item) => ({
          id: item.id,
          step: item.step,
          status: item.status,
        })),
      });

      return {
        plan: context.researchPlan,
      };
    },
  });

  const webSearchTool = tool({
    description:
      "Search the web. Returns source metadata plus highlight snippets for triage, and caches each result's full text locally for later use with grepCachedSourcesTool. Highlights are not final evidence.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "A focused web search query for one missing facet. Prefer short retrieval-style queries, not answer-shaped prompts.",
        ),
    }),
    outputSchema: z.array(
      shortSourceSchema
    ),
    execute: async ({ query }) => {
      const results = await searchText(query);

      for (const result of results) {
        addToSources(context, {
          url: result.url,
          title: result.title,
          highlights: result.highlights,
          text: result.text,
          author: result.author,
          publishedDate: result.publishedDate,
        });
      }

      console.log(`Web search results for query "${query}":`, {
        count: results.length,
        urls: results.map((result) => result.url),
      });

      return results.map((result) => ({
        title: result.title,
        url: result.url,
        publishedDate: result.publishedDate,
        authors: result.author ? [result.author] : [],
        highlights: result.highlights,
      }));
    },
  });

  const verifyEvidenceTool = tool({
    description:
      "Verify that evidence quotes in your current draft exist in the cached full-text sources. Use this on the draft you intend to submit. Fix, replace, or remove any item where quoteFound is false before submission.",
    inputSchema: z.object({
      evidence: z
        .array(researchEvidenceSchema)
        .describe(
          "Evidence items to verify against cached source pages by source URL.",
        ),
    }),
    outputSchema: z.object({
      evidence: z.array(enrichedResearchEvidenceSchema),
    }),
    execute: async ({ evidence }) => {
      const verifiedEvidence = enrichResearchEvidence(
        evidence,
        context.usedSources,
      );

      console.log("verifyEvidenceTool results:", {
        count: verifiedEvidence.length,
        verifiedCount: verifiedEvidence.filter((item) => item.quoteFound)
          .length,
        missingCount: verifiedEvidence.filter((item) => !item.quoteFound)
          .length,
      });

      return {
        evidence: verifiedEvidence,
      };
    },
  });

  const listSourcesTool = tool({
    description:
      "List the sources already collected in this run. Returns only source metadata, not full text.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      sources: z.array(superShortSourceSchema),
    }),
    execute: async () => {
      return {
        sources: context.usedSources.map((source) => ({
          url: source.url,
          title: source.title,
          authors: source.authors,
          publishedDate: source.publishedDate,
        })),
      };
    },
  });

  const grepCachedSourcesTool = tool({
    description:
      "Find literal text matches in cached source bodies. This is grep over cached page text, not semantic retrieval. Returns matching text plus surrounding extracts. Supports regular expressions when needed.",
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe(
          'Text to locate in cached source bodies. Best inputs are short literal anchors likely to appear verbatim, such as names, numbers, headings, or distinctive clauses. Good: "largest declines were observed", "plain packaging", "Chile.*tax". Bad: "which countries reduced smoking the most", "what policies worked best".',
        ),
      isRegex: z
        .boolean()
        .default(false)
        .describe(
          "Treat pattern as a regular expression. Keep this true only when you intentionally use regex syntax such as .*, |, groups, or character classes.",
        ),
      isCaseSensitive: z
        .boolean()
        .default(false)
        .describe("Make search case-sensitive. Use only when letter casing matters."),
    }),
    outputSchema: z.object({
      matches: matchesSchema.describe(
        "List of matches with surrounding context extracts from cached source texts.",
      ),
    }),
    execute: async ({
      pattern,
      isRegex,
      isCaseSensitive,
    }) => {
      const searchPattern = buildSearchPattern(pattern, {
        isRegex,
        isCaseSensitive,
      });
      const matches: matchesType = [];

      for (const source of context.usedSources) {
        if (!source.text) {
          continue;
        }

        searchPattern.lastIndex = 0;
        let match = searchPattern.exec(source.text);

        while (match && matches.length < MAX_MATCHES) {
          if (match[0].length === 0) {
            searchPattern.lastIndex += 1;
            match = searchPattern.exec(source.text);
            continue;
          }

          const matchStart = match.index;
          const matchEnd = matchStart + match[0].length;
          const extractData = buildExtract(
            source.text,
            matchStart,
            matchEnd,
            CONTEXT_OUT_CHARS,
          );

          matches.push({
            sourceUrl: source.url,
            matchedText: match[0],
            extract: extractData.extract,
            extractStart: extractData.extractStart,
            extractEnd: extractData.extractEnd,
            matchStart,
            matchEnd,
          });

          match = searchPattern.exec(source.text);
        }

        if (matches.length >= MAX_MATCHES) {
          break;
        }
      }

      console.log("grepCachedSourcesTool results:", {
        pattern,
        isRegex: isRegex ?? false,
        isCaseSensitive: isCaseSensitive ?? false,
        matchesCount: matches.length,
        sourceUrls: [...new Set(matches.map((match) => match.sourceUrl))],
      });

      return { matches };
    },
  });

  return {
    getResearchPlanTool,
    createResearchPlanTool,
    updateResearchPlanStepTool,
    webSearchTool,
    verifyEvidenceTool,
    grepCachedSourcesTool,
    listSourcesTool,
  };
}
