import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { SearchResult } from "./search-engine";

type RetrievalSource = Pick<
  SearchResult,
  "url" | "title" | "text" | "publishedDate"
>;

export type RetrievedChunk = {
  chunkId: string;
  sourceUrl: string;
  sourceTitle: string;
  chunkText: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  score: number;
};

type SourceChunk = {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  chunkText: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  publishedDate: string | null;
};

type RetrievalConfig = {
  collection: string;
  inferenceModel: string;
  vectorSize: number;
  chunkSize: number;
  chunkOverlap: number;
};

const DEFAULT_COLLECTION = "research_source_chunks";
const DEFAULT_INFERENCE_MODEL = "sentence-transformers/all-minilm-l6-v2";
const DEFAULT_VECTOR_SIZE = 384;
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function uuidFromHash(value: string) {
  const hex = hash(value).slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function clampOverlap(chunkSize: number, chunkOverlap: number) {
  return Math.max(0, Math.min(chunkOverlap, chunkSize - 1));
}

function trimBounds(text: string, start: number, end: number) {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/.test(text[nextStart] ?? "")) {
    nextStart += 1;
  }

  while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1] ?? "")) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
}

function chooseChunkEnd(text: string, start: number, chunkSize: number) {
  const targetEnd = Math.min(text.length, start + chunkSize);
  if (targetEnd >= text.length) {
    return text.length;
  }

  for (let index = targetEnd; index > start + Math.floor(chunkSize * 0.6); index -= 1) {
    if (/\s/.test(text[index] ?? "")) {
      return index;
    }
  }

  return targetEnd;
}

function chunkSource(runId: string, source: RetrievalSource, config: RetrievalConfig) {
  if (!source.text.trim()) {
    return [];
  }

  const chunks: SourceChunk[] = [];
  const overlap = clampOverlap(config.chunkSize, config.chunkOverlap);
  let start = 0;
  let chunkIndex = 0;

  while (start < source.text.length) {
    const rawEnd = chooseChunkEnd(source.text, start, config.chunkSize);
    const { start: chunkStart, end: chunkEnd } = trimBounds(
      source.text,
      start,
      rawEnd,
    );

    if (chunkEnd <= chunkStart) {
      if (rawEnd >= source.text.length) {
        break;
      }

      start = rawEnd;
      continue;
    }

    chunks.push({
      id: uuidFromHash(`${runId}\n${source.url}\n${chunkIndex}`),
      sourceUrl: source.url,
      sourceTitle: source.title,
      chunkText: source.text.slice(chunkStart, chunkEnd),
      chunkIndex,
      startChar: chunkStart,
      endChar: chunkEnd,
      publishedDate: source.publishedDate,
    });

    if (chunkEnd >= source.text.length) {
      break;
    }

    start = Math.max(chunkEnd - overlap, chunkStart + 1);
    chunkIndex += 1;
  }

  return chunks;
}

export class QdrantRetrievalStore {
  private readonly runId: string;
  private readonly client: QdrantClient | null;
  private readonly config: RetrievalConfig;
  private collectionEnsured = false;
  private readonly collectionReady: Promise<void>;
  private indexedSources = new Map<string, string>();

  constructor(runId: string) {
    this.runId = runId;
    this.client = process.env.QDRANT_URL
      ? new QdrantClient({
          url: process.env.QDRANT_URL,
          ...(process.env.QDRANT_API_KEY
            ? { apiKey: process.env.QDRANT_API_KEY }
            : {}),
        })
      : null;
    this.config = {
      collection: DEFAULT_COLLECTION,
      inferenceModel: DEFAULT_INFERENCE_MODEL,
      vectorSize: DEFAULT_VECTOR_SIZE,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    };
    this.collectionReady = this.initializeCollection();
  }

  isEnabled() {
    return Boolean(this.client);
  }

  async ingestSources(sources: RetrievalSource[]) {
    if (!this.client) {
      console.warn(
        "Retrieval ingest skipped: set QDRANT_URL to enable Qdrant chunk retrieval.",
      );
      return;
    }

    await this.collectionReady;

    for (const source of sources) {
      await this.ingestSource(source);
    }
  }

  async search(options: {
    query: string;
    sourceUrls?: string[];
    limit?: number;
  }): Promise<RetrievedChunk[]> {
    if (!this.client) {
      throw new Error("Missing QDRANT_URL for semantic chunk retrieval.");
    }

    const filter: Record<string, unknown> = {
      must: [
        {
          key: "runId",
          match: { value: this.runId },
        },
      ],
    };

    if (options.sourceUrls && options.sourceUrls.length > 0) {
      filter.should = options.sourceUrls.map((sourceUrl) => ({
        key: "sourceUrl",
        match: { value: sourceUrl },
      }));
    }

    try {
      const response = await this.client.query(this.config.collection, {
        query: {
          text: options.query,
          model: this.config.inferenceModel,
        },
        limit: options.limit ?? 6,
        with_payload: true,
        filter,
      });

      const matches = (response.points ?? [])
        .map((point) => {
          const payload = point.payload ?? {};
          if (
            typeof payload.chunkText !== "string" ||
            typeof payload.sourceUrl !== "string" ||
            typeof payload.sourceTitle !== "string" ||
            typeof payload.chunkIndex !== "number" ||
            typeof payload.startChar !== "number" ||
            typeof payload.endChar !== "number"
          ) {
            return null;
          }

          return {
            chunkId: String(point.id),
            sourceUrl: payload.sourceUrl,
            sourceTitle: payload.sourceTitle,
            chunkText: payload.chunkText,
            chunkIndex: payload.chunkIndex,
            startChar: payload.startChar,
            endChar: payload.endChar,
            score: typeof point.score === "number" ? point.score : 0,
          } satisfies RetrievedChunk;
        })
        .filter((item): item is RetrievedChunk => item !== null);

      console.log("searchCachedSourceChunksTool results:", {
        query: options.query,
        sourceUrls: options.sourceUrls ?? [],
        matchesCount: matches.length,
        matchedSourceUrls: [...new Set(matches.map((match) => match.sourceUrl))],
        matches: matches.map((match) => ({
          chunkId: match.chunkId,
          sourceUrl: match.sourceUrl,
          sourceTitle: match.sourceTitle,
          chunkIndex: match.chunkIndex,
          startChar: match.startChar,
          endChar: match.endChar,
          score: match.score,
          chunkText: match.chunkText,
        })),
      });

      return matches;
    } catch (error) {
      const apiError = error as {
        status?: number;
        statusText?: string;
        data?: { status?: { error?: string } };
      };
      console.error("Qdrant retrieval search failed:", {
        query: options.query,
        sourceUrls: options.sourceUrls ?? [],
        collection: this.config.collection,
        inferenceModel: this.config.inferenceModel,
        qdrantStatus: apiError.status,
        qdrantStatusText: apiError.statusText,
        qdrantError: apiError.data?.status?.error,
        error,
      });
      throw error;
    }
  }

  private async initializeCollection() {
    if (this.collectionEnsured || !this.client) {
      return;
    }

    const exists = await this.client.collectionExists(this.config.collection);
    if (!exists.exists) {
      try {
        await this.client.createCollection(this.config.collection, {
          vectors: {
            size: this.config.vectorSize,
            distance: "Cosine",
          },
          on_disk_payload: true,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

        if (!message.includes("already exists")) {
          throw error;
        }
      }
    }

    for (const [fieldName, fieldSchema] of [
      ["runId", "keyword"],
      ["sourceUrl", "keyword"],
    ] as const) {
      try {
        await this.client.createPayloadIndex(this.config.collection, {
          wait: true,
          field_name: fieldName,
          field_schema: fieldSchema,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

        if (
          !message.includes("already exists") &&
          !message.includes("duplicate")
        ) {
          throw error;
        }
      }
    }

    this.collectionEnsured = true;
  }

  private async ingestSource(source: RetrievalSource) {
    if (!this.client || !source.text.trim()) {
      return;
    }

    const fingerprint = hash(source.text);
    if (this.indexedSources.get(source.url) === fingerprint) {
      return;
    }

    const chunks = chunkSource(this.runId, source, this.config);
    if (chunks.length === 0) {
      return;
    }

    await this.client.upsert(this.config.collection, {
      wait: true,
      points: chunks.map((chunk) => ({
        id: chunk.id,
        vector: {
          text: chunk.chunkText,
          model: this.config.inferenceModel,
        },
        payload: {
          runId: this.runId,
          sourceUrl: chunk.sourceUrl,
          sourceTitle: chunk.sourceTitle,
          chunkText: chunk.chunkText,
          chunkIndex: chunk.chunkIndex,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          publishedDate: chunk.publishedDate,
        },
      })),
    });

    this.indexedSources.set(source.url, fingerprint);

    console.log("Retrieval ingest results:", {
      sourceUrl: source.url,
      chunkCount: chunks.length,
      collection: this.config.collection,
      inferenceModel: this.config.inferenceModel,
    });
  }
}
