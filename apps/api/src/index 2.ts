import "dotenv/config";
import { research } from "./agents/agents";
import { initRunLogging } from "./logging";

function resolveChunkIds(
  retrievedChunksById: Record<string, {
    sourceUrl: string;
    sourceTitle: string;
  }>,
  chunkIds: string[],
) {
  return chunkIds.map((chunkId) => {
    const chunk = retrievedChunksById[chunkId];
    return {
      chunkId,
      sourceUrl: chunk?.sourceUrl ?? null,
      sourceTitle: chunk?.sourceTitle ?? null,
    };
  });
}

async function main() {
  initRunLogging();

  const res = await research(
    // "who has bigger seeds: radish or cabbage? and what other distinctions do they have (seeds)?",
    // "Rank the top battery chemistries for grid storage by cost, safety, lifespan, and supply-chain risk",
    // "List the primary biological mechanisms behind Alzheimer's",
    // "What's the most efficient way to solve the problem of graded simliarity (don't confuse with fingerprinting) of two texts? I need to compare two big texts buy their structure and by the words they use, paragraphs, structure, etc. My goal is to be able to reliably answer the question of whether two long texts are almost identical. Not by the meaning but by structure. What are the best ways?"
    // "What were the results of the 2025 French Open Finals?",
    // "What are the main causes of the 2008 financial crisis?",
    "Who was the architect of Kazan's kremlin? The one kremlin that was built before it was conquered by Ivan the Terrible"
    // "Which countries have been most successful at reducing smoking rates, and what policies appear to matter most?",
  );

  console.log(
    JSON.stringify(
      {
        summary: res.summary,
        judge: {
          ...res.judge,
          keepChunks: resolveChunkIds(
            res.retrievedChunksById,
            res.judge.keepChunkIds,
          ),
          dropChunks: resolveChunkIds(
            res.retrievedChunksById,
            res.judge.dropChunkIds,
          ),
        },
        approvedChunks: resolveChunkIds(
          res.retrievedChunksById,
          res.approvedChunkIds,
        ),
        evidenceCount: res.researchEvidence.length,
        usedSourcesCount: res.usedSources.length,
        usedSourceUrls: res.usedSources.map((source) => source.url),
        stats: res.stats,
      },
      null,
      2,
    ),
  );
}

main();
