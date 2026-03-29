import Firecrawl from "@mendable/firecrawl-js";

export const firecrawlClient = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY as string,
});
