import {
    Service,
    type IAgentRuntime,
    ServiceType,
    type Provider,
    Memory,
    State,
    elizaLogger,
    generateText,
    ModelClass
} from "@elizaos/core";
import { tavily } from "@tavily/core";
import type { SearchOptions, SearchResponse } from "./webTypes.ts";

export type TavilyClient = ReturnType<typeof tavily>; // declaring manually because original package does not export its types

/**
 * Determines if a query needs external search based on patterns and keywords
 */
function needsExternalSearch(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    
    // Time indicators
    const timePatterns = [
        /current|latest|recent|today|now|update|updates/,
        /this week|this month|this year/,
        /yesterday|tomorrow/
    ];
    
    // Price and market related
    const pricePatterns = [
        /price|value|worth|cost|trading at|market cap|marketcap/,
        /how much is|how much are|what is the price|what are the prices/,
        /\$[a-z]+|[a-z]+\$/i  // Dollar sign followed by token symbol or vice versa
    ];
    
    // News related
    const newsPatterns = [
        /news|announcement|announcements|released|launch|launched/,
        /what happened|what's happening|what is happening/
    ];
    
    // Crypto and token related
    const cryptoPatterns = [
        /token|crypto|cryptocurrency|blockchain|coin|btc|eth|sol|avax/,
        /bitcoin|ethereum|solana|avalanche|polygon|binance|arbitrum/,
        /defi|nft|dao|airdrop|gas fee|gas fees|liquidity/
    ];
    
    // AI protocols related
    const aiProtocolPatterns = [
        /ai protocol|ml protocol|machine learning protocol/,
        /anthropic|openai|claude|gpt|llama|mistral|gemini/,
        /bittensor|anthropic|hugging face|huggingface/
    ];

    // Check if any pattern matches
    for (const patternList of [timePatterns, pricePatterns, newsPatterns, cryptoPatterns, aiProtocolPatterns]) {
        for (const pattern of patternList) {
            if (pattern.test(lowerQuery)) {
                return true;
            }
        }
    }

    return false;
}

export class WebSearchService {
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
            
            // Use pattern matching instead of inference
            const requiresExternalSearch = needsExternalSearch(message.content.text);
            
            if (requiresExternalSearch) {
                const searchOptions: SearchOptions = {
                    limit: 3,
                    type: "general",
                    includeAnswer: true,
                    searchDepth: "basic",
                    includeImages: false,
                    days: 3,
                };
                const latestNews = await webSearchService.search(
                    message.content.text,
                    searchOptions
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
