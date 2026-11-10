import { type Request, type Response } from 'express';
import openai, { assertAiKeyConfigured } from '../config/openai.js';
import { PRIMARY_AI_MODEL as AI_MODEL } from '../config/aiModels.js';

const AI_PROVIDER = 'OpenRouter';

function sanitizeError(error: any): string {
    const raw = typeof error?.error?.message === 'string'
        ? error.error.message
        : typeof error?.message === 'string'
            ? error.message
            : 'AI request failed';
    const text = raw.replace(/\s+/g, ' ').trim();
    return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

// GET /api/ai-test — reports provider/model/config status without secrets
export const aiTestGet = (_req: Request, res: Response) => {
    let keyConfigured = false;
    try {
        assertAiKeyConfigured();
        keyConfigured = true;
    } catch {
        keyConfigured = false;
    }

    res.json({
        success: true,
        provider: AI_PROVIDER,
        model: AI_MODEL,
        keyConfigured,
        method: 'GET',
        usage: 'POST {"prompt": "Say hello in one sentence."} to run a live request',
    });
};

// POST /api/ai-test — makes ONE request to the configured provider
export const aiTestPost = async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

    if (!prompt) {
        return res.status(400).json({ success: false, error: 'prompt is required.' });
    }

    try {
        assertAiKeyConfigured();

        const response = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
        });

        const content = response.choices?.[0]?.message?.content ?? '';

        res.json({
            success: true,
            provider: AI_PROVIDER,
            model: AI_MODEL,
            prompt,
            response: content,
        });
    } catch (error: any) {
        const status = typeof error?.status === 'number' ? error.status : 500;
        const httpStatus = status >= 400 && status < 600 ? status : 500;
        console.error('ai-test request failed:', status, sanitizeError(error));
        res.status(httpStatus).json({
            success: false,
            provider: AI_PROVIDER,
            model: AI_MODEL,
            status,
            error: sanitizeError(error),
        });
    }
};
