import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import { firecrawlClient } from "../firecrawl";

export const webSearchTool = tool({
  description:
    "Search the web for information. Useful for gathering raw information. Returns a set of results, each with a title, url and body preview text.",
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
    const results = await searchText(query, {
      backend: "auto",
      maxResults: 8,
    });
    console.log(`Web search results for query "${query}":`, results);

    return results.map((result) => ({
      title: result.title,
      url: result.href,
      body: result.body,
    }));
  },
});

export const webPageParseTool = tool({
  description:
    "Given a URL, fetch the page and extract compact structured content. Use markdown for readable page text; metadata is returned from the scrape response.",
  inputSchema: z.object({
    url: z.string().describe("The URL of the page to parse"),
    formats: z
      .array(z.literal("markdown"))
      .describe("The output formats to extract from the page"),
  }),
  outputSchema: z.object({
    markdown: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  execute: async ({ url, formats }) => {
    const result = await firecrawlClient.scrape(url, {
      formats,
    });

    console.log(`Web page parse results for URL "${url}":`, result);

    return {
      markdown:
        typeof result.markdown === "string" && result.markdown.length > 0
          ? result.markdown
          : null,
      metadata:
        result.metadata && typeof result.metadata === "object"
          ? result.metadata
          : {},
    };
  },
});
