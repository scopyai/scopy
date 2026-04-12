import Exa from "exa-js";

const exaApiKey = process.env.EXA_API_KEY;

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

export async function searchText(query: string) {
  if (!query.trim()) {
    throw new Error("query is required");
  }

  const response = await exa.search(
    query,
    {
      numResults: 10,
      type: "auto",
      contents: {
        text: true,
        highlights: {
          maxCharacters: 4000
        }
      }
    }
  );

  return response.results.map((result) => ({
    title: result.title ?? result.url,
    url: result.url,
    highlights:
      result.highlights?.filter(Boolean) || [],
    text: result.text?.trim() || "",
    author: result.author ?? null,
    publishedDate: result.publishedDate ?? null,
  }));
}
