import { tool } from "ai";
import { z } from "zod";
import { searchText } from "./search-engine";
import {
  researchPlanItem,
  researchPlanStatus,
  WorkflowContext,
  shortSourceSchema,
  superShortSourceSchema
} from "./types";
import { QdrantRetrievalStore } from "./retrieval";

const MAX_MATCHES = 8;

const retrievedChunkSchema = z.array(
  z.object({
    chunkId: z.string(),
    sourceUrl: z.string(),
    sourceTitle: z.string(),
    chunkText: z.string(),
    chunkIndex: z.number().int(),
    startChar: z.number().int(),
    endChar: z.number().int(),
    score: z.number(),
  }),
);

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

export function createRunTools(
  context: WorkflowContext,
  retrievalRunId: string,
) {
  const retrievalStore = new QdrantRetrievalStore(retrievalRunId);
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
      "Search the web. Returns source metadata plus highlight snippets for triage, caches each result's full text locally, and ingests it to storage for later use with searchCachedSourceChunksTool. Highlights are not final evidence.",
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

      try {
        await retrievalStore.ingestSources(results);
      } catch (error) {
        console.warn("Retrieval ingest failed during webSearchTool:", error);
      }

      console.log(`Web search results for query "${query}":`, {
        count: results.length,
        results: results.map((result) => ({
          url: result.url,
          title: result.title,
          publishedDate: result.publishedDate,
          author: result.author,
          highlights: result.highlights,
        })),
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

  const listSourcesTool = tool({
    description:
      "List the sources already collected in this run. Returns only source metadata, not full text. Use this to inspect what is already available before semantic chunk search or another web search.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      sources: z.array(superShortSourceSchema),
    }),
    execute: async () => {
      console.log("listSourcesTool results:", {
        count: context.usedSources.length,
        sources: context.usedSources.map((source) => ({
          url: source.url,
          title: source.title,
          authors: source.authors,
          publishedDate: source.publishedDate,
          highlights: source.highlights,
        })),
      });

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

  const searchCachedSourceChunksTool = tool({
    description:
      "Search cached source chunks. Use this after source selection to retrieve the most relevant passages for a claim, question, or missing facet. Returns candidate chunks, not final verified evidence.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "Semantic retrieval query for the missing claim, comparison, or policy facet. Good: 'OECD countries with the largest smoking declines over the past decade', 'Brazil policies linked to smoking decline'.",
        ),
      sourceUrls: z
        .array(z.string())
        .max(12)
        .optional()
        .describe(
          "Optional source URLs to restrict retrieval to already-selected sources. Prefer setting this once you know which sources you trust for the current facet.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_MATCHES)
        .default(6)
        .describe("Maximum number of chunks to return."),
    }),
    outputSchema: z.object({
      matches: retrievedChunkSchema.describe(
        "List of semantically retrieved chunks from cached sources.",
      ),
    }),
    execute: async ({ query, sourceUrls, limit }) => {
      const matches = await retrievalStore.search(
        sourceUrls
          ? {
              query,
              sourceUrls,
              limit,
            }
          : {
              query,
              limit,
            },
      );
      for (const match of matches) {
        context.retrievedChunksById[match.chunkId] = match;
      }
      return { matches };
    },
  });

  return {
    getResearchPlanTool,
    createResearchPlanTool,
    updateResearchPlanStepTool,
    webSearchTool,
    searchCachedSourceChunksTool,
    listSourcesTool,
  };
}
