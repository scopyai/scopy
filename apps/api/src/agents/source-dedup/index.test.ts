import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compareDocumentsByParagraphs,
  compareNormalizedHeadings,
  compareSourcesForNearDuplicate,
  compareUrlsForDuplicateCandidate,
  normalizeUrlForDedup,
} from "./index";

function readFixture(name: string) {
  return readFileSync(path.resolve(process.cwd(), "sources", name), "utf8");
}

const duplicateText = readFixture("s41419-025-08186-8");
const duplicateCopyText = readFixture("s41419-025-08186-8-copy");
const differentOneText = readFixture("not-dedup-one");
const differentTwoText = readFixture("not-dedup-two");

describe("source dedup", () => {
  it("normalizeUrlForDedup strips safe tracking parameters only", () => {
    const normalized = normalizeUrlForDedup(
      "https://www.nature.com/articles/s41419-025-08186-8?utm_source=x&fbclid=123&download=true",
    );

    expect(normalized.normalizedUrl).toBe(
      "https://nature.com/articles/s41419-025-08186-8?download=true",
    );
  });

  it("compareUrlsForDuplicateCandidate treats same path on different hosts as candidate only", () => {
    const result = compareUrlsForDuplicateCandidate(
      "http://www.npg.nature.com/articles/s41419-025-08186-8",
      "http://www.nature.com/articles/s41419-025-08186-8",
    );

    expect(result.isCandidate).toBe(true);
    expect(result.reason).toBe("same_path_different_host");
  });

  it("compareNormalizedHeadings recognizes copied pages as structurally identical", () => {
    const result = compareNormalizedHeadings(duplicateText, duplicateCopyText);

    expect(result.matchesThreshold).toBe(true);
    expect(result.similarity).toBe(1);
    expect({
      leftHeadings: result.leftHeadings.length,
      rightHeadings: result.rightHeadings.length,
      similarity: result.similarity,
    }).toEqual({
      leftHeadings: 589,
      rightHeadings: 589,
      similarity: 1,
    });
  });

  it("compareDocumentsByParagraphs keeps different springer articles separate", () => {
    const result = compareDocumentsByParagraphs(differentOneText, differentTwoText);

    expect(result.matchesThreshold).toBe(false);
    expect({
      leftParagraphCount: result.leftParagraphCount,
      rightParagraphCount: result.rightParagraphCount,
      matchedParagraphPairs: result.matchedParagraphPairs,
      comparedParagraphPairs: result.comparedParagraphPairs,
      matchRatio: result.matchRatio,
      averageMatchedParagraphSimilarity: result.averageMatchedParagraphSimilarity,
    }).toEqual({
      leftParagraphCount: 1282,
      rightParagraphCount: 1112,
      matchedParagraphPairs: 691,
      comparedParagraphPairs: 1152,
      matchRatio: 0.6214028776978417,
      averageMatchedParagraphSimilarity: 1,
    });
  });

  it("compareSourcesForNearDuplicate marks copied nature pages as duplicates", () => {
    const result = compareSourcesForNearDuplicate(
      {
        url: "http://www.npg.nature.com/articles/s41419-025-08186-8",
        text: duplicateText,
      },
      {
        url: "http://www.nature.com/articles/s41419-025-08186-8",
        text: duplicateCopyText,
      },
    );

    expect(result.isNearDuplicate).toBe(true);
    expect(result.urlCandidate.reason).toBe("same_path_different_host");
    expect({
      headingsSimilarity: result.headings.similarity,
      paragraphMatchRatio: result.paragraphs.matchRatio,
      averageMatchedParagraphSimilarity: result.paragraphs.averageMatchedParagraphSimilarity,
      matchedParagraphPairs: result.paragraphs.matchedParagraphPairs,
    }).toEqual({
      headingsSimilarity: 1,
      paragraphMatchRatio: 1,
      averageMatchedParagraphSimilarity: 1,
      matchedParagraphPairs: 639,
    });
  });

  it("compareSourcesForNearDuplicate keeps different springer articles separate", () => {
    const result = compareSourcesForNearDuplicate(
      {
        url: "https://link.springer.com/article/10.1186/s40001-025-02886-9",
        text: differentOneText,
      },
      {
        url: "https://link.springer.com/article/10.1007/s12035-025-05602-0",
        text: differentTwoText,
      },
    );

    expect(result.isNearDuplicate).toBe(false);
    expect(result.reason).toBe("url_not_duplicate_candidate");
  });
});
