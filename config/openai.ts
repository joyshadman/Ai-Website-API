import OpenAI from 'openai';

export function assertAiKeyConfigured(): void {
    if (!process.env.AI_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
        throw new Error('OpenRouter API key is not configured. Set AI_API_KEY or OPENAI_API_KEY.');
    }
}

const apiKey = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
});

export default openai;
