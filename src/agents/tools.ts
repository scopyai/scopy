import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import { firecrawlClient } from "../firecrawl";
import {
  enrichedResearchEvidence,
  researchEvidence,
  WorkflowContext,
} from "./types";
import { enrichResearchEvidence } from "./evidence";

const matchesSchema = z.array(
  z.object({
    sourceUrl: z.string(),
    sourceTitle: z.string(),
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

export function createRunTools(context: WorkflowContext) {
  const webSearchTool = tool({
    description:
      "Discovery step for finding candidate URLs. Use this first to search the web and collect possible sources. The results only contain shallow search-engine snippets and are not verified page contents. Do not treat the snippet text as evidence. If a result looks promising or might be kept as a source, call parsePageTool on that URL to inspect the actual page before using it.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    outputSchema: z.array(
      z.object({
        title: z.string().describe("The title of the search result"),
        url: z.string().describe("The URL of the search result"),
        body: z
          .string()
          .describe("A preview of the content of the search result"),
      }),
    ),
    execute: async ({ query }) => {
      const existingUrls = context.fetchedSources.map((source) => source.url);

      const results = await searchText(query, {
        backend: "auto",
        maxResults: 8,
      });

      const filteredResults = results.filter(
        (result) => !existingUrls.includes(result.href),
      );
      for (const result of filteredResults) {
        context.fetchedSources.push({
          url: result.href,
          title: result.title,
          description: result.body,
        });
      }

      console.log(`Web search results for query "${query}":`, {
        count: results.length,
        urls: results.map((result) => result.href),
      });

      return results.map((result) => ({
        title: result.title,
        url: result.href,
        body: result.body,
      }));
    },
  });

  const webPageParseTool = tool({
    description:
      "Verification and extraction step for a specific URL. Use this after webSearch to open a candidate page, read the actual page content, and verify that it is authoritative and relevant. This tool returns the page markdown and metadata from the live page, which you should use for evidence and source qualification. If you plan to keep, quote, or rely on a URL, you must call this tool first. This tool is not for discovery; it is for inspecting a URL you already found.",
    inputSchema: z.object({
      url: z.string().describe("The URL of the page to parse"),
    }),
    outputSchema: z.object({
      markdown: z.string().nullable(),
      metadata: z.record(z.string(), z.unknown()),
    }),
    execute: async ({ url }) => {
      const existingSource = context.usedSources.find(
        (source) => source.url === url,
      );

      if (existingSource && existingSource.body) {
        return {
          markdown: existingSource.body || null,
          metadata: Object.fromEntries(
            existingSource.metadata.map(({ key, value }) => [key, value]),
          ),
        };
      }

      const result = await firecrawlClient.scrape(url, {
        formats: ["markdown"],
      });

      console.log(`Web page parse results for URL "${url}":`, {
        hasMarkdown:
          typeof result.markdown === "string" && result.markdown.length > 0,
        metadataKeys:
          result.metadata && typeof result.metadata === "object"
            ? Object.keys(result.metadata)
            : [],
      });

      const res = {
        markdown:
          typeof result.markdown === "string" && result.markdown.length > 0
            ? result.markdown
            : null,
        metadata:
          result.metadata && typeof result.metadata === "object"
            ? result.metadata
            : {},
      };

      const fetchedSource = context.fetchedSources.find(
        (source) => source.url === url,
      );

      const metadataTitle =
        "og:title" in res.metadata &&
        typeof res.metadata["og:title"] === "string"
          ? res.metadata["og:title"]
          : url;

      const metadataDescription =
        typeof result.metadata?.description === "string"
          ? result.metadata.description
          : "";

      context.usedSources.push({
        url,
        title: fetchedSource ? fetchedSource.title : metadataTitle,
        description: fetchedSource
          ? fetchedSource.description
          : metadataDescription,
        body: res.markdown ?? "",
        metadata: Object.entries(res.metadata).map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : JSON.stringify(value),
        })),
        authors: result.metadata?.authors
          ? Array.isArray(result.metadata.authors)
            ? result.metadata.authors.map((author) =>
                typeof author === "string" ? author : JSON.stringify(author),
              )
            : [String(result.metadata.authors)]
          : [],
        publishedDate:
          typeof result.metadata?.publishedDate === "string"
            ? result.metadata.publishedDate
            : null,
        sourceName:
          typeof result.metadata?.sourceName === "string"
            ? result.metadata.sourceName
            : null,
      });

      return res;
    },
  });

  const verifyEvidenceTool = tool({
    description:
      "Check whether one or more evidence quotes actually exist in the already parsed cached source pages. Use this after drafting evidence and before returning it. If quoteFound is false, the quote is not safely grounded and should be corrected, replaced, or removed before finalizing the answer.",
    inputSchema: z.object({
      evidence: z
        .array(researchEvidence)
        .describe(
          "Evidence items to verify against cached parsed source pages by source URL.",
        ),
    }),
    outputSchema: z.object({
      evidence: z.array(enrichedResearchEvidence),
    }),
    execute: async ({ evidence }) => {
      const verifiedEvidence = enrichResearchEvidence(
        evidence,
        context.usedSources,
      );

      console.log("verifyEvidenceTool results:", {
        count: verifiedEvidence.length,
        verifiedCount: verifiedEvidence.filter((item) => item.quoteFound).length,
        missingCount: verifiedEvidence.filter((item) => !item.quoteFound).length,
      });

      return {
        evidence: verifiedEvidence,
      };
    },
  });

  const searchCachedSourcesTool = tool({
    description:
      "Search across the full text of already parsed cached source pages in usedSources. Use this before searching the web again when you suspect the current run already has the needed quote, fact, or nearby wording. Returns surrounding text extracts so you can extract grounded quotes from existing sources.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Literal text to search for in cached source bodies."),
      contextOutChars: z
        .number()
        .int()
        .min(0)
        .max(4000)
        .optional()
        .describe(
          "Number of characters of surrounding context to include on both sides of each match. Defaults to 200.",
        ),
      maxMatches: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Maximum number of matches to return across all cached sources. Defaults to 8.",
        ),
    }),
    outputSchema: z.object({
      matches: matchesSchema.describe(
        "List of matches with surrounding context extracts from cached source bodies.",
      ),
    }),
    execute: async ({ query, contextOutChars, maxMatches }) => {
      const outChars = contextOutChars ?? 200;
      const maxReturnedMatches = maxMatches ?? 8;
      const matches: matchesType = [];

      for (const source of context.usedSources) {
        if (!source.body) {
          continue;
        }

        const body = source.body.toLowerCase();
        let searchFrom = 0;

        while (matches.length < maxReturnedMatches) {
          const matchStart = body.indexOf(query.toLowerCase(), searchFrom);

          if (matchStart < 0) {
            break;
          }

          const matchEnd = matchStart + query.length;
          const extractData = buildExtract(
            source.body,
            matchStart,
            matchEnd,
            outChars,
          );

          matches.push({
            sourceUrl: source.url,
            sourceTitle: source.title,
            matchedText: source.body.slice(matchStart, matchEnd),
            extract: extractData.extract,
            extractStart: extractData.extractStart,
            extractEnd: extractData.extractEnd,
            matchStart,
            matchEnd,
          });

          searchFrom = matchStart + Math.max(query.length, 1);
        }

        if (matches.length >= maxReturnedMatches) {
          break;
        }
      }

      console.log("searchCachedSourcesTool results:", {
        query,
        matchesCount: matches.length,
        sourceUrls: [...new Set(matches.map((match) => match.sourceUrl))],
      });

      return { matches };
    },
  });

  return {
    webSearchTool,
    webPageParseTool,
    verifyEvidenceTool,
    searchCachedSourcesTool,
  };
}
