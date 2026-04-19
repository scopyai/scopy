import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { sourceSchemaType } from "../types";
import type { NearDuplicateResult } from "./index";

const DEFAULT_DEDUP_LOG_PATH = "dedup.txt";

let dedupLogPath: string | null = null;
let dedupLogInitialized = false;

function formatSource(source: sourceSchemaType) {
  return [
    `URL: ${source.url}`,
    `Title: ${source.title}`,
    `Published Date: ${source.publishedDate ?? "null"}`,
    `Authors: ${source.authors.join(", ") || "none"}`,
    "Highlights:",
    source.highlights.length > 0
      ? source.highlights.map((highlight, index) => `  ${index + 1}. ${highlight}`).join("\n")
      : "  none",
    "Text:",
    source.text,
  ].join("\n");
}

export function initDedupDebugLog(logFilePath = DEFAULT_DEDUP_LOG_PATH) {
  const absolutePath = resolve(process.cwd(), logFilePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, "");
  dedupLogPath = absolutePath;
  dedupLogInitialized = true;
  return absolutePath;
}

export function appendDedupDebugEntry(input: {
  decision: string;
  keptSource: sourceSchemaType;
  rejectedSource: sourceSchemaType;
  comparison?: NearDuplicateResult;
}) {
  const absolutePath =
    dedupLogPath ?? resolve(process.cwd(), DEFAULT_DEDUP_LOG_PATH);

  if (!dedupLogInitialized) {
    initDedupDebugLog(absolutePath);
  }

  const sections = [
    `${"=".repeat(120)}\nDEDUP DECISION\n${"=".repeat(120)}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Metadata:\n${JSON.stringify(
      {
        decision: input.decision,
        keptUrl: input.keptSource.url,
        rejectedUrl: input.rejectedSource.url,
        comparison: input.comparison ?? null,
      },
      null,
      2,
    )}`,
    `${"-".repeat(120)}\nKEPT SOURCE\n${"-".repeat(120)}\n${formatSource(input.keptSource)}`,
    `${"-".repeat(120)}\nREJECTED SOURCE\n${"-".repeat(120)}\n${formatSource(input.rejectedSource)}`,
    "",
  ];

  appendFileSync(absolutePath, sections.join("\n"));
}
