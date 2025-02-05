import axios from 'axios';
import { ClientOptions, OpenAI } from 'openai';

const IMGFLIP_API = "https://api.imgflip.com";

interface MemeTemplate {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  box_count: number;
}

const openai = new OpenAI(
  {
    apiKey: process.env.OPENAI_API_KEY,
  }
)


export const memeCategories: Record<string, string[]> = {
  "confusion": ["61579", "91538330"], // One Does Not Simply, Woman Yelling at a Cat
  "excitement": ["93895088", "217743513"], // Pikachu Shocked, Buff Doge vs. Cheems
  "frustration": ["97984", "129242436"], // Disappointed Black Guy, Change My Mind
  "happiness": ["4087833", "188390779"], // Happy Leonardo DiCaprio, Surprised Pikachu
  "logic": ["89370399", "438680"], // Roll Safe Think About It, Batman Slapping Robin
  "sarcasm": ["61532", "181913649"], // The Most Interesting Man, Dr. Evil Air Quotes
  "surprise": ["61520", "155067746"], // Surprised Pikachu, This Is Fine
};


export async function getMemeTemplates(): Promise<MemeTemplate[]> {
  try {
    const response = await axios.get(`${IMGFLIP_API}/get_memes`);
    if (response.data.success) {
      return response.data.data.memes;
    }
    throw new Error("Failed to fetch memes");
  } catch (error) {
    console.error("Error fetching meme templates:", error);
    return [];
  }
}

export async function getMemeTheme(message: string): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "user", content: `Determine the best meme theme for this message: "${message}". 
               Themes: confusion, excitement, frustration, happiness, logic, sarcasm, surprise.
               Only return a single word from the themes above.`,
      }],
      max_tokens: 10,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error determining meme theme:", error);
    return null;
  }
}

export async function generateMemeCaption(message: string, username: string, context: string): Promise<{ topText: string; bottomText: string } | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",

      messages: [{
        role: "user", content: `Generate a funny meme caption for the message: "${message}". 
               If the caption integrates a response to the user, include the regular username instead of the user's id.
               This is the username: ${username}.
               Only integrate the username if it makes sense in the context of the caption. Most memes and captions
               won't make sense with a username integrated, so only do it if it makes sense.
               The most important thing is that the caption is funny and relevant to the message.
               Finally here is some useful context you can use when generating the caption: ${context}.
               This context is meant to help you generate a more relevant caption based on the knowledge you have and
               your personality quirks.
               Provide a response in this JSON format:
               {"topText": "<top text>", "bottomText": "<bottom text>"}
               Example:
               {"topText": "Big Data", "bottomText": "Big Data Everywhere"}
               Ensure it's short, humorous, and meme-appropriate.`,
      }],
      max_tokens: 50,
      temperature: 0.8,
    });

    if (response.choices[0].message.content) {
      return JSON.parse(response.choices[0].message.content.trim());
    }

    return null;
  } catch (error) {
    console.error("Error generating meme caption:", error);
    return null;
  }
}

export async function createMeme(templateId: string, topText: string, bottomText: string): Promise<string | null> {
  try {
    const response = await axios.post(`${IMGFLIP_API}/caption_image`, null, {
      params: {
        template_id: templateId,
        username: process.env.IMGFLIP_USERNAME,
        password: process.env.IMGFLIP_PASSWORD,
        text0: topText,
        text1: bottomText,
      },
    });

    if (response.data.success) {
      return response.data.data.url;
    }

    throw new Error(response.data.error_message || "Failed to generate meme");
  } catch (error) {
    console.error("Error creating meme:", error);
    return null;
  }
}
