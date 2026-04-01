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

      console.log(`Web search results for query "${query}":`, results);

      return results.map((result) => ({
        title: result.title,
        url: result.href,
        body: result.body,
      }));
    },
  });

  const webPageParseTool = tool({
    description:
      'Verification and extraction step for a specific URL. Use this after webSearch to open a candidate page, read the actual page content, and verify that it is authoritative and relevant. This tool returns the page markdown and metadata from the live page, which you should use for evidence and source qualification. If you plan to keep, quote, or rely on a URL, you must call this tool first. This tool is not for discovery; it is for inspecting a URL you already found.',
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

      console.log(`Web page parse results for URL "${url}":`, result);

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
      const verifiedEvidence = enrichResearchEvidence(evidence, context.usedSources);

      console.log("verifyEvidenceTool results:", verifiedEvidence);

      return {
        evidence: verifiedEvidence,
      };
    },
  });

  return {
    webSearchTool,
    webPageParseTool,
    verifyEvidenceTool,
  };
}
