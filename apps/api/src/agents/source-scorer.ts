import { generateText, Output, type LanguageModelUsage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { SearchResult } from "./search-engine";

const SOURCE_SCORE_THRESHOLD = 0.5;
const DEFAULT_SOURCE_SCORER_MODEL_ID = "openai/gpt-oss-120b:free";

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openrouter = openrouterApiKey
  ? createOpenRouter({
      apiKey: openrouterApiKey,
    })
  : null;

const sourceScoreSchema = z.object({
  scores: z.array(
    z.object({
      url: z.string(),
      score: z.number().min(0).max(1),
    }),
  ),
});

type SourceScore = {
  url: string;
  score: number;
};

export type ScoredSearchResult = SearchResult & {
  sourceScore: number;
};

function clampScore(score: number) {
  return Math.max(0, Math.min(1, score));
}

export async function scoreSearchResults(
  query: string,
  results: SearchResult[],
): Promise<{
  keptResults: ScoredSearchResult[];
  rejectedScores: SourceScore[];
  usage?: LanguageModelUsage;
}> {
  if (!openrouter || results.length === 0) {
    return {
      keptResults: results.map((result) => ({ ...result, sourceScore: 1 })),
      rejectedScores: [],
    };
  }

  const model = openrouter.chat(DEFAULT_SOURCE_SCORER_MODEL_ID);

  const candidateSources = results.map((result) => ({
    url: result.url,
    title: result.title,
    author: result.author,
    publishedDate: result.publishedDate,
    highlights: result.highlights,
  }));

  const { output, usage } = await generateText({
    model,
    output: Output.object({
      schema: sourceScoreSchema,
    }),
    providerOptions: {
      openrouter: {
        reasoning: {
          effort: "low",
        },
      },
    },
    prompt: [
      "You score web search results for research authority and usefulness.",
      "Return exactly one score from 0 to 1 for every source URL.",
      "Higher score means more likely to be directly useful and sufficiently trustworthy for answering the query well.",
      "Lower score means more likely to be marketing, low-quality, redundant, off-topic, or otherwise weak.",
      "Judge source quality in the context of the query rather than by one fixed notion of authority.",
      "Do not reject a source only because it is a blog or personal site if the query is practical or implementation-oriented and the source appears technically serious and directly useful.",
      "Still penalize vendor marketing pages, generic SEO content, shallow explainers, low-quality aggregators, and sources unlikely to directly support the answer.",
      "Reward sources that match the user's requested frame, such as method choice, evaluation setup, implementation detail, comparison basis, timeframe, or caveat.",
      "",
      `User query: ${query}`,
      `Sources: ${JSON.stringify(candidateSources)}`,
    ].join("\n"),
  });

  const scoreByUrl = new Map<string, number>();
  for (const item of output.scores) {
    scoreByUrl.set(item.url, clampScore(item.score));
  }

  const keptResults: ScoredSearchResult[] = [];
  const rejectedScores: SourceScore[] = [];

  for (const result of results) {
    const score = clampScore(scoreByUrl.get(result.url) ?? 0);
    if (score < SOURCE_SCORE_THRESHOLD) {
      rejectedScores.push({
        url: result.url,
        score,
      });
      continue;
    }

    keptResults.push({
      ...result,
      sourceScore: score,
    });
  }

  return {
    keptResults,
    rejectedScores,
    usage,
  };
}
