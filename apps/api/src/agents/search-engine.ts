import Exa from "exa-js";
import { scoreSearchResults } from "./source-scorer";
import { recordSourceScoring } from "./stats";
import type { workflowRunStats } from "./types";

const exaApiKey = process.env.EXA_API_KEY;
const DEFAULT_EXCLUDED_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "pinterest.com",
  "linkedin.com",
  "quora.com",
  "snapchat.com",
];

if (!exaApiKey) {
  throw new Error(
    "Missing EXA_API_KEY. Ensure .env is loaded before using Exa search.",
  );
}

const exa = new Exa(exaApiKey);

export type SearchResult = {
  title: string;
  url: string;
  highlights: string[];
  text: string;
  author: string | null;
  publishedDate: string | null;
};

export async function searchText(query: string, stats?: workflowRunStats) {
  if (!query.trim()) {
    throw new Error("query is required");
  }

  const response = await exa.search(
    query,
    {
      numResults: 5,
      type: "auto",
      excludeDomains: DEFAULT_EXCLUDED_DOMAINS,
      contents: {
        text: {
          includeHtmlTags: false,
        },
        highlights: {
          maxCharacters: 4000
        }
      }
    }
  );

  const results = response.results.map((result) => ({
    title: result.title ?? result.url,
    url: result.url,
    highlights:
      result.highlights?.filter(Boolean) || [],
    text: result.text?.trim() || "",
    author: result.author ?? null,
    publishedDate: result.publishedDate ?? null,
  }));

  try {
    const { keptResults, rejectedScores, usage } = await scoreSearchResults(query, results);

    if (stats) {
      recordSourceScoring(
        stats,
        usage
          ? {
              inputSources: results.length,
              keptSources: keptResults.length,
              rejectedSources: rejectedScores.length,
              usage,
            }
          : {
              inputSources: results.length,
              keptSources: keptResults.length,
              rejectedSources: rejectedScores.length,
            },
      );
    }

    console.log("Source scoring results:", {
      query,
      inputCount: results.length,
      keptCount: keptResults.length,
      rejectedCount: rejectedScores.length,
      usage,
      kept: keptResults.map((result) => ({
        url: result.url,
        score: result.sourceScore,
        title: result.title,
      })),
      rejected: rejectedScores,
    });

    return keptResults.map(({ sourceScore: _sourceScore, ...result }) => result);
  } catch (error) {
    if (stats) {
      recordSourceScoring(stats, {
        inputSources: results.length,
        keptSources: results.length,
        rejectedSources: 0,
        failed: true,
      });
    }

    console.warn("Source scoring failed; using unscored Exa results:", error);
    return results;
  }
}
