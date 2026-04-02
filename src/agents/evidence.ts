import type {
  enrichedResearchEvidenceType,
  researchEvidenceType,
  sourceQualifiedType,
} from "./types";

type TextMatch = {
  found: boolean;
  matchType: "exact" | "normalized" | "not_found";
};

function normalizeChar(char: string): string {
  switch (char) {
    case "\u2018":
    case "\u2019":
    case "\u201A":
    case "\u201B":
    case "\u2032":
      return "'";
    case "\u201C":
    case "\u201D":
    case "\u201E":
    case "\u201F":
    case "\u2033":
      return '"';
    case "\u2010":
    case "\u2011":
    case "\u2012":
    case "\u2013":
    case "\u2014":
    case "\u2015":
      return "-";
    default:
      return char.toLowerCase();
  }
}

function isSearchableChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function buildNormalizedText(raw: string): string {
  let text = "";
  let previousWasSpace = true;

  for (let index = 0; index < raw.length; index++) {
    const char = normalizeChar(raw[index] ?? "");

    if (isSearchableChar(char)) {
      text += char;
      previousWasSpace = false;
      continue;
    }

    if (!previousWasSpace && text.length > 0) {
      text += " ";
    }
    previousWasSpace = true;

    if (/\s/.test(char)) {
      if (!previousWasSpace && text.length > 0) {
        text += " ";
      }
    }
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
  }

  return text;
}

function findTextMatch(raw: string, query: string): TextMatch {
  if (!raw.trim() || !query.trim()) {
    return {
      found: false,
      matchType: "not_found",
    };
  }

  const exactStart = raw.indexOf(query);
  if (exactStart >= 0) {
    return {
      found: true,
      matchType: "exact",
    };
  }

  const normalizedSource = buildNormalizedText(raw);
  const normalizedQuery = buildNormalizedText(query);

  if (!normalizedQuery) {
    return {
      found: false,
      matchType: "not_found",
    };
  }

  const normalizedStart = normalizedSource.indexOf(normalizedQuery);
  if (normalizedStart < 0) {
    return {
      found: false,
      matchType: "not_found",
    };
  }

  return {
    found: true,
    matchType: "normalized",
  };
}

export function enrichResearchEvidence(
  evidence: researchEvidenceType[],
  usedSources: sourceQualifiedType[],
): enrichedResearchEvidenceType[] {
  const sourceByUrl = new Map(
    usedSources.map((source) => [source.url, source]),
  );

  return evidence.map((item) => {
    const source = sourceByUrl.get(item.sourceUrl);

    if (!source) {
      return {
        ...item,
        sourceFound: false,
        quoteFound: false,
        quoteMatchType: "not_found",
      };
    }

    const quoteMatch = findTextMatch(source.body, item.evidenceQuote);

    return {
      ...item,
      sourceFound: true,
      quoteFound: quoteMatch.found,
      quoteMatchType: quoteMatch.matchType,
    };
  });
}
