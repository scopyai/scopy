import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import {
  researchPlanItem,
  WorkflowContext,
  researchEvidenceSchema,
  enrichedResearchEvidenceSchema,
  shortSourceSchema,
  superShortSourceSchema
} from "./types";
import { enrichResearchEvidence } from "./evidence";

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
  options: { regex: boolean; caseSensitive: boolean },
) {
  const sourcePattern = options.regex ? pattern : escapeRegExp(pattern);
  const flags = `g${options.caseSensitive ? "" : "i"}`;
  return new RegExp(sourcePattern, flags);
}

export function createRunTools(context: WorkflowContext) {
  const getResearchPlanTool = tool({
    description:
      "Read the persistent research plan for this run. Use this at the start and whenever you need to check what is still pending.",
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

  const saveResearchPlanTool = tool({
    description:
      "Replace the persistent research plan for this run. Use this to create the initial plan and to mark steps pending, in_progress or completed as work progresses.",
    inputSchema: z.object({
      plan: z.array(researchPlanItem).min(1).max(8),
    }),
    outputSchema: z.object({
      plan: z.array(researchPlanItem),
    }),
    execute: async ({ plan }) => {
      const hasGroundedProgress =
        context.usedSources.length > 0 || context.researchEvidence.length > 0;

      context.researchPlan = hasGroundedProgress
        ? plan
        : plan.map((item) =>
            item.status === "completed" ? { ...item, status: "pending" } : item,
          );

      console.log("saveResearchPlanTool results:", {
        count: context.researchPlan.length,
        items: context.researchPlan.map((item) => ({
          step: item.step,
          status: item.status,
        })),
        downgradedCompletedWithoutEvidence:
          !hasGroundedProgress &&
          plan.some((item) => item.status === "completed"),
      });

      return { plan: context.researchPlan };
    },
  });

  const webSearchTool = tool({
    description:
      "Tool for searching the web. This returns source metadata plus highlight snippets for inspection, and it also caches each result's full text locally for later use with searchCachedSourcesTool. Do not treat returned highlights as final evidence without confirming the exact quote from cached full text.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
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
      "Check whether the quotes in your current evidence draft actually exist in the cached full-text sources. Use this on the draft you plan to submit before calling submitEvidenceTool. If quoteFound is false, that evidence item is not safely grounded and should be corrected, replaced, or removed before submission.",
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
      "List the sources collected so far in this run. Returns only metadata. You can use this to check what sources have been collected to decide whether to search the web again or use searchCachedSourcesTool to search already collected sources.",
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

  const searchCachedSourcesTool = tool({
    description:
      "Search across the full text of sources already fetched in this run. Treat this like ripgrep over cached page text, not like a semantic search engine. Use short literal anchors, exact phrases, names, numbers, headings, or focused regex patterns that are likely to appear verbatim in the text. Returns surrounding text extracts.",
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe("Literal text or regex pattern to search for in cached source bodies."),
      regex: z
        .boolean()
        .default(true)
        .describe("Set to true to treat pattern as a regular expression. Defaults to true."),
      caseSensitive: z
        .boolean()
        .default(false)
        .describe("Set to true for case-sensitive search. Defaults to false."),
      contextOutChars: z
        .number()
        .int()
        .min(0)
        .max(4000)
        .default(200)
        .describe(
          "Number of characters of surrounding context to include on both sides of each match. Defaults to 200.",
        ),
      maxMatches: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe(
          "Maximum number of matches to return across all cached sources. Defaults to 10.",
        ),
    }),
    outputSchema: z.object({
      matches: matchesSchema.describe(
        "List of matches with surrounding context extracts from cached source bodies.",
      ),
    }),
    execute: async ({
      pattern,
      regex,
      caseSensitive,
      contextOutChars,
      maxMatches,
    }) => {
      const searchPattern = buildSearchPattern(pattern, {
        regex,
        caseSensitive,
      });
      const matches: matchesType = [];

      for (const source of context.usedSources) {
        if (!source.text) {
          continue;
        }

        searchPattern.lastIndex = 0;
        let match = searchPattern.exec(source.text);

        while (match && matches.length < maxMatches) {
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
            contextOutChars,
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

        if (matches.length >= maxMatches) {
          break;
        }
      }

      console.log("searchCachedSourcesTool results:", {
        pattern,
        regex: regex ?? false,
        caseSensitive: caseSensitive ?? false,
        matchesCount: matches.length,
        sourceUrls: [...new Set(matches.map((match) => match.sourceUrl))],
      });

      return { matches };
    },
  });

  return {
    getResearchPlanTool,
    saveResearchPlanTool,
    webSearchTool,
    verifyEvidenceTool,
    searchCachedSourcesTool,
    listSourcesTool,
  };
}
