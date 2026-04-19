import "dotenv/config";
import { research } from "./agents/agents";
import { initRunLogging } from "./logging";

async function main() {
  initRunLogging();

  const res = await research(
    // "who has bigger seeds: radish or cabbage? and what other distinctions do they have (seeds)?",
    // "Rank the top battery chemistries for grid storage by cost, safety, lifespan, and supply-chain risk",
    "List the primary biological mechanisms behind Alzheimer's"
    // "What were the results of the 2025 French Open Finals?",
    // "What are the main causes of the 2008 financial crisis?",
    // "Which countries have been most successful at reducing smoking rates, and what policies appear to matter most?",
  );

  console.log(
    JSON.stringify(
      {
        summary: res.summary,
        judge: res.judge,
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
