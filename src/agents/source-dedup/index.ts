const MAX_TEXT_LENGTH_RATIO = 2.5;
const HEADING_SIMILARITY_THRESHOLD = 0.8;
const PARAGRAPH_SIMILARITY_THRESHOLD = 0.8;
const DOCUMENT_MATCH_RATIO_THRESHOLD = 0.75;
const ALIGNMENT_LOOKAHEAD = 2;
const NGRAM_SIZE = 5;

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "s",
  "sessionid",
  "si",
  "source",
  "code",
  "error"
]);

export type NormalizedUrlParts = {
  originalUrl: string;
  normalizedUrl: string;
  host: string | null;
  pathname: string | null;
  search: string | null;
};

export type UrlCandidateResult = {
  isCandidate: boolean;
  reason: string;
  left: NormalizedUrlParts;
  right: NormalizedUrlParts;
};

export type HeadingComparisonResult = {
  leftHeadings: string[];
  rightHeadings: string[];
  similarity: number;
  matchesThreshold: boolean;
};

export type ParagraphComparisonResult = {
  leftParagraphCount: number;
  rightParagraphCount: number;
  matchedParagraphPairs: number;
  comparedParagraphPairs: number;
  matchRatio: number;
  averageMatchedParagraphSimilarity: number;
  matchesThreshold: boolean;
};

export type NearDuplicateResult = {
  isNearDuplicate: boolean;
  reason: string;
  textLengthRatio: number;
  urlCandidate: UrlCandidateResult;
  headings: HeadingComparisonResult;
  paragraphs: ParagraphComparisonResult;
};

function stripLeadingWww(hostname: string) {
  return hostname.replace(/^www\./, "");
}

function normalizePathname(pathname: string) {
  const normalized = pathname.replace(/\/{2,}/g, "/");
  if (normalized === "/") {
    return normalized;
  }

  return normalized.replace(/\/+$/g, "");
}

function shouldDropParam(name: string, value: string) {
  const loweredName = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(loweredName)) {
    return true;
  }

  if (TRACKING_PARAM_PREFIXES.some((prefix) => loweredName.startsWith(prefix))) {
    return true;
  }

  return loweredName === "error" && value === "cookies_not_supported";
}

export function normalizeUrlForDedup(rawUrl: string): NormalizedUrlParts {
  try {
    const url = new URL(rawUrl);
    const normalizedParams = new URLSearchParams();

    for (const [name, value] of url.searchParams.entries()) {
      if (shouldDropParam(name, value)) {
        continue;
      }

      normalizedParams.append(name, value);
    }

    normalizedParams.sort();

    const protocol = url.protocol.toLowerCase();
    const host = stripLeadingWww(url.hostname.toLowerCase());
    const pathname = normalizePathname(url.pathname);
    const search = normalizedParams.toString();
    const normalizedUrl = `${protocol}//${host}${pathname}${search ? `?${search}` : ""}`;

    return {
      originalUrl: rawUrl,
      normalizedUrl,
      host,
      pathname,
      search: search || null,
    };
  } catch {
    return {
      originalUrl: rawUrl,
      normalizedUrl: rawUrl.trim(),
      host: null,
      pathname: null,
      search: null,
    };
  }
}

export function compareUrlsForDuplicateCandidate(
  leftUrl: string,
  rightUrl: string,
): UrlCandidateResult {
  const left = normalizeUrlForDedup(leftUrl);
  const right = normalizeUrlForDedup(rightUrl);

  if (left.normalizedUrl === right.normalizedUrl) {
    return {
      isCandidate: true,
      reason: "normalized_url_match",
      left,
      right,
    };
  }

  if (
    left.pathname &&
    right.pathname &&
    left.pathname === right.pathname &&
    left.host !== right.host
  ) {
    return {
      isCandidate: true,
      reason: "same_path_different_host",
      left,
      right,
    };
  }

  if (
    left.host &&
    right.host &&
    left.host === right.host &&
    left.pathname &&
    right.pathname &&
    left.pathname === right.pathname
  ) {
    return {
      isCandidate: true,
      reason: "same_host_same_path",
      left,
      right,
    };
  }

  return {
    isCandidate: false,
    reason: "url_patterns_not_suspicious",
    left,
    right,
  };
}

function normalizeComparisonText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeadingCandidate(line: string) {
  if (!line) {
    return false;
  }

  const wordCount = line.split(/\s+/).length;
  if (wordCount < 1 || wordCount > 16) {
    return false;
  }

  if (line.length < 3 || line.length > 120) {
    return false;
  }

  if (/\bhttps?:\/\//i.test(line)) {
    return false;
  }

  if (/^#+\s*/.test(line)) {
    return true;
  }

  if (/^\d+(\.\d+)*\s+\S+/.test(line)) {
    return true;
  }

  if (/^[A-Z0-9][A-Z0-9\s/&-]{2,}$/.test(line)) {
    return true;
  }

  const normalized = normalizeComparisonText(line);
  if (!normalized) {
    return false;
  }

  return wordCount <= 10 && !/[.!?]$/.test(line);
}

export function extractNormalizedHeadings(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(isHeadingCandidate)
    .map(normalizeComparisonText)
    .filter(Boolean);
}

function lcsLength<T>(left: T[], right: T[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
      } else {
        current[j] = Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
      }
    }

    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return previous[right.length] ?? 0;
}

export function compareNormalizedHeadings(
  leftText: string,
  rightText: string,
): HeadingComparisonResult {
  const leftHeadings = extractNormalizedHeadings(leftText);
  const rightHeadings = extractNormalizedHeadings(rightText);

  if (leftHeadings.length === 0 || rightHeadings.length === 0) {
    return {
      leftHeadings,
      rightHeadings,
      similarity: 0,
      matchesThreshold: false,
    };
  }

  const similarity =
    lcsLength(leftHeadings, rightHeadings) /
    Math.min(leftHeadings.length, rightHeadings.length);

  return {
    leftHeadings,
    rightHeadings,
    similarity,
    matchesThreshold: similarity >= HEADING_SIMILARITY_THRESHOLD,
  };
}

export function splitNormalizedParagraphs(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => normalizeComparisonText(paragraph))
    .filter(Boolean);
}

export function createWordNgramList(paragraph: string, size = NGRAM_SIZE) {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length < size) {
    return words.length === 0 ? [] : [words.join(" ")];
  }

  const grams: string[] = [];
  for (let index = 0; index <= words.length - size; index += 1) {
    grams.push(words.slice(index, index + size).join(" "));
  }

  return grams;
}

export function compareParagraphByNgrams(leftParagraph: string, rightParagraph: string) {
  const leftNgrams = createWordNgramList(leftParagraph);
  const rightNgrams = createWordNgramList(rightParagraph);

  if (leftNgrams.length === 0 || rightNgrams.length === 0) {
    return 0;
  }

  return lcsLength(leftNgrams, rightNgrams) / Math.min(leftNgrams.length, rightNgrams.length);
}

export function compareDocumentsByParagraphs(
  leftText: string,
  rightText: string,
): ParagraphComparisonResult {
  const leftParagraphs = splitNormalizedParagraphs(leftText);
  const rightParagraphs = splitNormalizedParagraphs(rightText);

  if (leftParagraphs.length === 0 || rightParagraphs.length === 0) {
    return {
      leftParagraphCount: leftParagraphs.length,
      rightParagraphCount: rightParagraphs.length,
      matchedParagraphPairs: 0,
      comparedParagraphPairs: 0,
      matchRatio: 0,
      averageMatchedParagraphSimilarity: 0,
      matchesThreshold: false,
    };
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let matchedParagraphPairs = 0;
  let comparedParagraphPairs = 0;
  let matchedSimilarityTotal = 0;

  while (leftIndex < leftParagraphs.length && rightIndex < rightParagraphs.length) {
    let bestSimilarity = -1;
    let bestLeftOffset = 0;
    let bestRightOffset = 0;

    for (let leftOffset = 0; leftOffset <= ALIGNMENT_LOOKAHEAD; leftOffset += 1) {
      for (let rightOffset = 0; rightOffset <= ALIGNMENT_LOOKAHEAD; rightOffset += 1) {
        const nextLeft = leftParagraphs[leftIndex + leftOffset];
        const nextRight = rightParagraphs[rightIndex + rightOffset];

        if (!nextLeft || !nextRight) {
          continue;
        }

        const similarity = compareParagraphByNgrams(nextLeft, nextRight);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestLeftOffset = leftOffset;
          bestRightOffset = rightOffset;
        }
      }
    }

    if (bestSimilarity < 0) {
      break;
    }

    comparedParagraphPairs += 1;

    if (bestSimilarity >= PARAGRAPH_SIMILARITY_THRESHOLD) {
      matchedParagraphPairs += 1;
      matchedSimilarityTotal += bestSimilarity;
      leftIndex += bestLeftOffset + 1;
      rightIndex += bestRightOffset + 1;
      continue;
    }

    if (leftParagraphs.length - leftIndex >= rightParagraphs.length - rightIndex) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  const denominator = Math.min(leftParagraphs.length, rightParagraphs.length);
  const matchRatio = denominator === 0 ? 0 : matchedParagraphPairs / denominator;
  const averageMatchedParagraphSimilarity =
    matchedParagraphPairs === 0 ? 0 : matchedSimilarityTotal / matchedParagraphPairs;

  return {
    leftParagraphCount: leftParagraphs.length,
    rightParagraphCount: rightParagraphs.length,
    matchedParagraphPairs,
    comparedParagraphPairs,
    matchRatio,
    averageMatchedParagraphSimilarity,
    matchesThreshold: matchRatio >= DOCUMENT_MATCH_RATIO_THRESHOLD,
  };
}

export function compareSourcesForNearDuplicate(
  left: { url: string; text: string },
  right: { url: string; text: string },
): NearDuplicateResult {
  const leftLength = left.text.trim().length;
  const rightLength = right.text.trim().length;
  const minLength = Math.min(leftLength, rightLength);
  const maxLength = Math.max(leftLength, rightLength);
  const textLengthRatio = minLength === 0 ? Number.POSITIVE_INFINITY : maxLength / minLength;

  const urlCandidate = compareUrlsForDuplicateCandidate(left.url, right.url);
  if (textLengthRatio > MAX_TEXT_LENGTH_RATIO) {
    return {
      isNearDuplicate: false,
      reason: "text_length_ratio_too_high",
      textLengthRatio,
      urlCandidate,
      headings: {
        leftHeadings: [],
        rightHeadings: [],
        similarity: 0,
        matchesThreshold: false,
      },
      paragraphs: {
        leftParagraphCount: 0,
        rightParagraphCount: 0,
        matchedParagraphPairs: 0,
        comparedParagraphPairs: 0,
        matchRatio: 0,
        averageMatchedParagraphSimilarity: 0,
        matchesThreshold: false,
      },
    };
  }

  if (!urlCandidate.isCandidate) {
    return {
      isNearDuplicate: false,
      reason: "url_not_duplicate_candidate",
      textLengthRatio,
      urlCandidate,
      headings: {
        leftHeadings: [],
        rightHeadings: [],
        similarity: 0,
        matchesThreshold: false,
      },
      paragraphs: {
        leftParagraphCount: 0,
        rightParagraphCount: 0,
        matchedParagraphPairs: 0,
        comparedParagraphPairs: 0,
        matchRatio: 0,
        averageMatchedParagraphSimilarity: 0,
        matchesThreshold: false,
      },
    };
  }

  const headings = compareNormalizedHeadings(left.text, right.text);
  if (!headings.matchesThreshold) {
    return {
      isNearDuplicate: false,
      reason: "heading_similarity_too_low",
      textLengthRatio,
      urlCandidate,
      headings,
      paragraphs: {
        leftParagraphCount: 0,
        rightParagraphCount: 0,
        matchedParagraphPairs: 0,
        comparedParagraphPairs: 0,
        matchRatio: 0,
        averageMatchedParagraphSimilarity: 0,
        matchesThreshold: false,
      },
    };
  }

  const paragraphs = compareDocumentsByParagraphs(left.text, right.text);
  return {
    isNearDuplicate: paragraphs.matchesThreshold,
    reason: paragraphs.matchesThreshold
      ? "paragraph_similarity_high"
      : "paragraph_similarity_too_low",
    textLengthRatio,
    urlCandidate,
    headings,
    paragraphs,
  };
}
