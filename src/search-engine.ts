export type Backend = "auto" | "google" | "duckduckgo" | "yandex";
export type SafeSearch = "on" | "moderate" | "off";
export type TimeLimit = "d" | "w" | "m" | "y";

export interface SearchOptions {
  backend?: Backend;
  profile?: string;
  proxyUrl?: string;
  region?: string;
  safesearch?: SafeSearch;
  timelimit?: TimeLimit;
  page?: number;
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  href: string;
  body: string;
  engine: string;
  provider: string;
  count?: number;
}

export interface SearchResponse {
  status: number;
  results: SearchResult[];
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const ENV_BASE_URL = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env?.SCRAPER_BASE_URL;

export async function searchText(
  query: string,
  options: SearchOptions = {},
  config: {
    baseUrl?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<SearchResult[]> {
  if (!query.trim()) {
    throw new Error("query is required");
  }

  const baseUrl = (config.baseUrl ?? ENV_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );

  const body: Record<string, unknown> = {
    query,
    backend: options.backend ?? "auto",
    region: options.region ?? "us-en",
    safesearch: options.safesearch ?? "moderate",
    page: options.page ?? 1,
    maxResults: options.maxResults ?? 10,
  };

  if (options.profile) body.profile = options.profile;
  if (options.proxyUrl) body.proxyUrl = options.proxyUrl;
  if (options.timelimit) body.timelimit = options.timelimit;

  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify(body),
  };

  const res = await fetch(`${baseUrl}/search`, init);

  if (!res.ok) {
    throw new Error(`Search request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SearchResponse;
  return data.results;
}
