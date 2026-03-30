import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import { firecrawlClient } from "../firecrawl";
import { WorkflowContext } from "./types";

export function createRunTools(context: WorkflowContext) {
  const webSearchTool = tool({
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
      const existingSource = context.usedSources.find(
        (source) => source.url === url,
      );

      if (existingSource && existingSource.body) {
        return existingSource;
      }

      const result = await firecrawlClient.scrape(url, {
        formats,
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

  return {
    webSearchTool,
    webPageParseTool,
  };
}
