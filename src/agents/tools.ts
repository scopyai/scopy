import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import { firecrawlClient } from "../firecrawl";

export const webSearchTool = tool({
  description:
    "Search the web for information. Useful for gathering raw information. Returns set results, each with a title, url and body preview text.",
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
    const results = await searchText(query);
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
    "Given a URL, fetch the page and extract data in various formats. Useful for getting detailed information from a source.",
  inputSchema: z.object({
    url: z.string().describe("The URL of the page to parse"),
    formats: z
      .array(z.enum(["html", "json"]))
      .describe("The output formats to extract from the page"),
  }),
  outputSchema: z
    .any()
    .describe(
      "The extracted data from the page, in a flexible format that can include text content, metadata, etc.",
    ),
  execute: async ({ url, formats }) => {
    const result = await firecrawlClient.scrape(url, {
      formats,
    });

    console.log(`Web page parse results for URL "${url}":`, result);
    return result;
  },
});
