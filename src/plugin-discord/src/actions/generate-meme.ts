import {
    Action,
    ActionExample,
    composeContext,
    elizaLogger,
    generateText,
    HandlerCallback,
    IAgentRuntime,
    Media,
    Memory,
    ModelClass,
    State,
} from "@elizaos/core";

const imgflipApiBaseUrl = "https://api.imgflip.com";

function sanitizeText(text: string): string {
    return text
        .replace(/[^\x20-\x7E]/g, '') // Only allow basic ASCII printable characters
        .replace(/[<>]/g, '') // Remove angle brackets
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/\\n/g, ' ') // Replace literal \n with space
        .replace(/\\t/g, ' ') // Replace literal \t with space
        .replace(/[^\w\s!?.,-]/g, '') // Only allow basic punctuation
        .trim();
}

interface ImgflipTemplate {
    id: string;
    name: string;
    url: string;
    width: number;
    height: number;
    box_count: number;
}

interface ImgflipSearchResponse {
    success: boolean;
    data: {
        memes: ImgflipTemplate[];
    };
    error_message?: string;
}

interface ImgflipCaptionResponse {
    success: boolean;
    data: {
        url: string;
        page_url: string;
    };
    error_message?: string;
}

async function findImgflipTemplate(
    runtime: IAgentRuntime,
    message: string,
    username?: string
): Promise<string> {
    const context = `
# Task: Find the most CHAOTIC and UNEXPECTED imgflip.com template for a meme.
The message${username ? ` from ${username}` : ''} is:
${sanitizeText(message)}

# Instructions:
- Be absolutely WILD and UNPREDICTABLE
- Go wild! 
- ACTIVELY AVOID making sense - the more absurd the connection, the better
- Choose templates that seem completely unrelated to create maximum cognitive dissonance
- Think of the most cursed combinations possible
- Combine serious templates with silly messages and vice versa
- Aim for maximum shock value and unexpected humor
- Break conventional meme formats whenever possible
Only respond with the template name, do not include any other text.`;

    const response = await generateText({
        runtime,
        context,
        modelClass: ModelClass.MEDIUM,
    });

    return sanitizeText(response);
}

async function getImgflipTemplate(template: string): Promise<ImgflipTemplate> {
    try {
        const formData = new URLSearchParams({
            username: process.env.IMGFLIP_USERNAME!,
            password: process.env.IMGFLIP_PASSWORD!,
            query: sanitizeText(template),
        });

        elizaLogger.info(`Searching for meme template: ${template}`);
        const response = await fetch(`${imgflipApiBaseUrl}/search_memes`, {
            method: "POST",
            body: formData,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        if (!response.ok) {
            throw new Error(`Search API failed with status: ${response.status}`);
        }

        const result: ImgflipSearchResponse = await response.json();

        if (!result.success || !result.data.memes.length) {
            const allMemesResponse = await fetch(`${imgflipApiBaseUrl}/get_memes`);
            const allMemes: ImgflipSearchResponse = await allMemesResponse.json();

            if (!allMemes.success || !allMemes.data.memes.length) {
                throw new Error("Failed to retrieve any meme templates");
            }

            // Introduce chaos by potentially picking completely random templates
            if (Math.random() < 0.4) {  // 40% chance of pure randomness
                const randomTemplate = allMemes.data.memes[Math.floor(Math.random() * allMemes.data.memes.length)];
                elizaLogger.info(`Chaos mode activated! Randomly selected template: ${randomTemplate.name}`);
                return randomTemplate;
            }

            // Find potential matches but include partial matches and loose connections
            const matches = allMemes.data.memes.filter((meme) => {
                const templateLower = template.toLowerCase();
                const memeLower = meme.name.toLowerCase();
                return memeLower.includes(templateLower) || 
                       templateLower.includes(memeLower) ||
                       template.split(' ').some(word => 
                           memeLower.includes(word.toLowerCase())
                       );
            });

            if (matches.length > 0) {
                const randomIndex = Math.floor(Math.pow(Math.random(), 2) * matches.length);
                const selectedMatch = matches[randomIndex];
                elizaLogger.info(`Found ${matches.length} matching templates, chaotically selected: ${selectedMatch.name}`);
                return selectedMatch;
            }

            const randomIndex = Math.floor(Math.pow(Math.random(), 2) * allMemes.data.memes.length);
            const randomTemplate = allMemes.data.memes[randomIndex];
            elizaLogger.info(`No matches found, chaotically selected template: ${randomTemplate.name}`);
            return randomTemplate;
        }

        const allResults = result.data.memes;
        const selectionPool = Math.random() < 0.3 ? 
            allResults : 
            allResults.slice(0, Math.min(5, allResults.length));
        
        const randomIndex = Math.floor(Math.pow(Math.random(), 2) * selectionPool.length);
        const selectedTemplate = selectionPool[randomIndex];
        
        elizaLogger.info(`Chaotically selected template "${selectedTemplate.name}" from ${selectionPool.length} results`);
        return selectedTemplate;

    } catch (error) {
        elizaLogger.error(`Error getting meme template: ${error.message}`);
        throw new Error(`Failed to get meme template: ${error.message}`);
    }
}

async function generateMemeCaptions(
    runtime: IAgentRuntime,
    message: string,
    state: State,
    imgflipTemplate: string,
    captionsCount: number,
    username?: string
): Promise<string[]> {
    const template = `
# About Arony:
{{bio}}
{{lore}}

# Task: Generate ABSOLUTELY CHAOTIC captions for a meme.
The template is: **${sanitizeText(imgflipTemplate)}**
The message${username ? ` from ${username}` : ''} is:
${sanitizeText(message)}
Generate **${captionsCount}** captions for the meme.

# Instructions:
- Be as UNHINGED and RANDOM as possible
- You do not have to address the user in the captions - only focus on the meme, and only tag them if it fits the meme. In most cases it won't make sense to do so
- Mix different styles, tones, and references chaotically
- Include unexpected pop culture references
- Use DRAMATIC capitalization and punctuation!!!
- Create maximum cognitive dissonance
- Break the fourth wall
- Mix formal and informal language unpredictably
- Add surreal or absurdist elements
- Reference meme culture in unexpected ways
- Use only standard readable characters (no emojis or special characters)
Only respond with the captions - one per line, do not include any other text.`;

    const context = await composeContext({
        state,
        template,
    });

    const response = await generateText({
        runtime,
        context,
        modelClass: ModelClass.MEDIUM,
    });

    return response.split("\n").map(caption => sanitizeText(caption));
}

async function genereateMeme(
    imgflipTemplate: ImgflipTemplate,
    captions: string[]
): Promise<string> {
    const formData = new URLSearchParams({
        template_id: imgflipTemplate.id,
        username: process.env.IMGFLIP_USERNAME!,
        password: process.env.IMGFLIP_PASSWORD!,
    });

    captions.forEach((text, index) => {
        const sanitizedText = sanitizeText(text);
        formData.append(`boxes[${index}][text]`, sanitizedText);
        formData.append(`boxes[${index}][color]`, "#FFFFFF");
        formData.append(`boxes[${index}][outline_color]`, "#000000");
    });

    const response = await fetch(`${imgflipApiBaseUrl}/caption_image`, {
        method: "POST",
        body: formData,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });

    const result: ImgflipCaptionResponse = await response.json();

    if (!result.success || !result.data.url) {
        throw new Error("Failed to generate meme: " + result.error_message);
    }

    return result.data.url;
}

async function generateMemeText(
    runtime: IAgentRuntime,
    state: State,
    imgflipTemplate: string,
    captions: string[],
    username?: string
): Promise<string> {
    const template = `
# About Arony:
{{bio}}
{{lore}}

# Task: Generate an ABSOLUTELY UNHINGED comment for the meme in the character's voice.
The imgflip template used for the meme is: **${sanitizeText(imgflipTemplate)}**
${username ? `The message is from ${username}` : ''}
The captions used for the meme are:
${captions.map(caption => sanitizeText(caption)).join("\n")}

# Instructions:
- Be CHAOTIC and RANDOM
- Mix multiple tones and styles
- Use basic punctuation for emphasis
- Break the fourth wall
- Reference meme culture in bizarre ways
- Create maximum cognitive dissonance
- Be as unpredictable as possible
- Use only standard readable characters (no emojis or special characters)
Do not include hashtags.
Only respond with the text - do not include any other text.`;

    const context = await composeContext({
        state,
        template,
    });

    const response = await generateText({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
    });

    return sanitizeText(response);
}

export interface Meme {
    url: string;
    text: string;
}

export async function generateMemeActionHandler(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    username?: string
): Promise<Meme> {
    const template = await findImgflipTemplate(runtime, message.content.text, username);
    const imgflipTemplate = await getImgflipTemplate(template);
    const captions = await generateMemeCaptions(
        runtime,
        message.content.text,
        state,
        template,
        imgflipTemplate.box_count,
        username
    );

    const url = await genereateMeme(imgflipTemplate, captions);
    const text = await generateMemeText(
        runtime,
        state,
        imgflipTemplate.name,
        captions,
        username
    );

    return {
        url,
        text: sanitizeText(text),
    };
}

export const generateMemeAction: Action = {
    name: "GENERATE_MEME",
    similes: ["MAKE_MEME", "NEW_MEME", "GENERATE_NEW_MEME", "MAKE_NEW_MEME"],
    description: "The agent may decide to generate a meme based on user input, even if not explicitly requested.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => {
        const chaosWords = /meme|funny|hilarious|lol|lmao|🤣|😂|cursed|chaos|random|wild|unhinged/i;
        const baseProb = 0.4;
        const chaosBonus = chaosWords.test(message.content.text) ? 0.2 : 0;
        const shouldMakeMeme = Math.random() < (baseProb + chaosBonus) || /meme|funny|hilarious|lol|lmao|🤣|😂/i.test(message.content.text);

        if (!shouldMakeMeme) {
            return false;
        }

        const meme = await generateMemeActionHandler(runtime, message, state);

        const newMemory: Memory = {
            ...message,
            userId: message.agentId,
            content: {
                text: `${sanitizeText(meme.text)}\n${meme.url}`,
                attachments: [
                    {
                        url: meme.url,
                    } as Media,
                ],
                action: "GENERATE_MEME",
                source: message.content.source,
            },
        };

        await runtime.messageManager.createMemory(newMemory);
        callback(newMemory.content);

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I can't believe it's Monday again...",
                },
            },
            {
                user: "{{assistant}}",
                content: {
                    text: "Mondays be like...",
                    action: "GENERATE_MEME",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Debugging is just fixing your own mistakes in slow motion",
                },
            },
            {
                user: "{{assistant}}",
                content: {
                    text: "That sounds like a meme waiting to happen!",
                    action: "GENERATE_MEME",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I should probably get some sleep",
                },
            },
            {
                user: "{{assistant}}",
                content: {
                    text: "But what if you stay up just a little longer... (Here's a meme about it!)",
                    action: "GENERATE_MEME",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Coffee is my best friend",
                },
            },
            {
                user: "{{assistant}}",
                content: {
                    text: "Let me illustrate that with a meme!",
                    action: "GENERATE_MEME",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;