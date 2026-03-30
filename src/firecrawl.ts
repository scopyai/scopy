import Firecrawl from "@mendable/firecrawl-js";

const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

if (!firecrawlApiKey) {
  throw new Error(
    "Missing FIRECRAWL_API_KEY. Ensure .env is loaded before importing firecrawl client.",
  );
}

export const firecrawlClient = new Firecrawl({
  apiKey: firecrawlApiKey,
});
