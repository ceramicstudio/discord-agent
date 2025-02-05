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
               For your context, the message included will contain a user's ID. This is because
               you will be generating a meme based on a message sent by a user. This is their username: ${username}.
               In most cases it will not make sense to integrate the username into the caption, and instead 
               create a funny and relevant caption in response to the message itself without addressing the user.
               In about 10% cases, you can choose to integrate the username into the caption. Only integrate 
               this type of direct response to the user in the caption if the user's message is snarky, sarcastic, or otherwise
               joking around. In the majority of other cases where the user is seeking information or help, do not integrate the username.
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
               {"topText": "Debugging in production", "bottomText": "It's like playing Jenga on a rollercoaster"}
               {"topText": "JavaScript developers", "bottomText": "Undefined is not a function... again"}
               {"topText": "Me writing code at 3AM", "bottomText": "Works perfectly. No idea how."}
               {"topText": "Stack Overflow down", "bottomText": "Guess I'll learn programming today"}
               {"topText": "When ChatGPT suggests a fix", "bottomText": "And it actually works 😳"}
               {"topText": "When you finally fix the bug", "bottomText": "But it breaks everything else"}
               {"topText": "Me: I should really fix this bug", "bottomText": "Also me: *adds more bugs*"}
               {"topText": "It's fine...", "bottomText": "Everything's fine."}
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
