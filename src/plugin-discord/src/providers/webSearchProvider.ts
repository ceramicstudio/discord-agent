import {
    Service,
    type IAgentRuntime,
    ServiceType,
    type Provider,
    Memory,
    State,
    elizaLogger
} from "@elizaos/core";
import { tavily } from "@tavily/core";
import type { IWebSearchService, SearchOptions, SearchResponse } from "./webTypes.ts";

export type TavilyClient = ReturnType<typeof tavily>; // declaring manually because original package does not export its types

export class WebSearchService  {
    public tavilyClient: TavilyClient

    async initialize(_runtime: IAgentRuntime): Promise<void> {
        const apiKey = process.env.TAVILY_API_KEY as string;
        if (!apiKey) {
            throw new Error("TAVILY_API_KEY is not set");
        }
        this.tavilyClient = tavily({ apiKey });
    }

    async search(
        query: string,
        options?: SearchOptions,
    ): Promise<SearchResponse> {
        try {
            const response = await this.tavilyClient.search(query, {
                includeAnswer: options?.includeAnswer || true,
                maxResults: options?.limit || 3,
                topic: options?.type || "general",
                searchDepth: options?.searchDepth || "basic",
                includeImages: options?.includeImages || false,
                days: options?.days || 3,
            });

            return response;
        } catch (error) {
            console.error("Web search error:", error);
            throw error;
        }
    }
}

export const webSearchProvider: Provider = {
  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State
  ): Promise<Error | string> => {
    try {
        const webSearchService = new WebSearchService();
        await webSearchService.initialize(_runtime);
        // if message.content.text contains "$", it's a search for a token
        if (message.content.text.includes("$")) {
            const latestNews = await webSearchService.search(
                'search latest crypto news about ' + message.content.text,
                // searchOptions
            );
            elizaLogger.info("Latest news: ", latestNews);
            return latestNews.answer || ""
        }
       
    

    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Unable to get storage provider";
    }
  },
};
