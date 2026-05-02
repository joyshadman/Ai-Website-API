import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { toNodeHandler } from 'better-auth/node';
import { fromNodeHeaders } from 'better-auth/node';
import prisma from './lib/prisma.js';
const app = express();
const port = 3000;
const trustedOrigins = (process.env.TRUSTED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const corsOptions = {
    origin(origin, callback) {
        // Allow non-browser requests (no Origin header)
        if (!origin)
            return callback(null, true);
        // Always allow explicit trusted origins
        if (trustedOrigins.includes(origin))
            return callback(null, true);
        // Dev convenience: allow any localhost port
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev && /^http:\/\/localhost:\d+$/.test(origin))
            return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
let requireAuth = null;
if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL && process.env.DATABASE_URL) {
    const { auth } = await import('./lib/auth.js');
    app.all('/api/auth/{*any}', toNodeHandler(auth));
    requireAuth = async (req, res) => {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        if (!session?.user?.id) {
            res.status(401).json({ error: 'Unauthorized' });
            return null;
        }
        return session;
    };
    app.get('/api/me', async (req, res) => {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!session?.user)
            return res.status(401).json({ error: 'Unauthorized' });
        return res.json({ user: session.user });
    });
    // ---- Projects CRUD (auth required) ----
    app.get('/api/projects', async (req, res) => {
        const session = await requireAuth?.(req, res);
        if (!session)
            return;
        const projects = await prisma.websiteProject.findMany({
            where: { userId: session.user.id },
            orderBy: { updatedAt: 'desc' },
            include: {
                versions: { orderBy: { timestamp: 'desc' }, take: 20 },
                conversation: { orderBy: { timestamp: 'asc' }, take: 200 },
            },
        });
        return res.json({ projects });
    });
    app.post('/api/projects', async (req, res) => {
        const session = await requireAuth?.(req, res);
        if (!session)
            return;
        const body = req.body;
        const name = (body.name || 'Untitled Project').trim().slice(0, 80) || 'Untitled Project';
        const initialPrompt = (body.prompt || '').trim().slice(0, 800);
        const currentCode = (body.html || '').trim();
        if (!initialPrompt)
            return res.status(400).json({ error: 'prompt is required' });
        const projectCreateData = {
            name,
            initial_prompt: initialPrompt,
            current_code: currentCode || null,
            userId: session.user.id,
            conversation: {
                create: [
                    { role: 'user', content: initialPrompt },
                    ...(currentCode ? [{ role: 'assistant', content: currentCode }] : []),
                ],
            },
        };
        if (currentCode) {
            projectCreateData.versions = {
                create: [{ code: currentCode, description: 'Initial generation' }],
            };
        }
        const project = await prisma.websiteProject.create({
            data: projectCreateData,
            include: { versions: true, conversation: true },
        });
        return res.status(201).json({ project });
    });
    app.get('/api/projects/:id', async (req, res) => {
        const session = await requireAuth?.(req, res);
        if (!session)
            return;
        const project = await prisma.websiteProject.findFirst({
            where: { id: req.params.id, userId: session.user.id },
            include: {
                versions: { orderBy: { timestamp: 'desc' }, take: 50 },
                conversation: { orderBy: { timestamp: 'asc' }, take: 500 },
            },
        });
        if (!project)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ project });
    });
    app.put('/api/projects/:id', async (req, res) => {
        const session = await requireAuth?.(req, res);
        if (!session)
            return;
        const body = req.body;
        const update = {};
        if (typeof body.name === 'string')
            update.name = body.name.trim().slice(0, 80) || 'Untitled Project';
        if (typeof body.isPublished === 'boolean')
            update.isPublished = body.isPublished;
        let newHtml = null;
        if (typeof body.html === 'string') {
            newHtml = body.html.trim();
            update.current_code = newHtml || null;
        }
        const project = await prisma.websiteProject.findFirst({
            where: { id: req.params.id, userId: session.user.id },
        });
        if (!project)
            return res.status(404).json({ error: 'Not found' });
        const projectUpdateData = {
            ...update,
        };
        if (newHtml) {
            projectUpdateData.versions = {
                create: [
                    {
                        code: newHtml,
                        description: body.description?.trim().slice(0, 200) || 'Update',
                    },
                ],
            };
        }
        const updated = await prisma.websiteProject.update({
            where: { id: project.id },
            data: {
                ...projectUpdateData,
            },
            include: { versions: { orderBy: { timestamp: 'desc' }, take: 50 } },
        });
        return res.json({ project: updated });
    });
    app.delete('/api/projects/:id', async (req, res) => {
        const session = await requireAuth?.(req, res);
        if (!session)
            return;
        const project = await prisma.websiteProject.findFirst({
            where: { id: req.params.id, userId: session.user.id },
        });
        if (!project)
            return res.status(404).json({ error: 'Not found' });
        await prisma.websiteProject.delete({ where: { id: project.id } });
        return res.status(204).send();
    });
}
else {
    console.warn('Auth route disabled: missing BETTER_AUTH_SECRET, BETTER_AUTH_URL, or DATABASE_URL');
}
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free';
const MAX_PROMPT_LENGTH = 800;
app.post('/api/generate', async (req, res) => {
    if (!requireAuth) {
        return res.status(500).json({ error: 'Auth is not configured on server.' });
    }
    const session = await requireAuth(req, res);
    if (!session)
        return;
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }
    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(500).json({ error: 'Server missing OPENROUTER_API_KEY.' });
    }
    const userPrompt = prompt.trim().slice(0, MAX_PROMPT_LENGTH);
    const systemPrompt = [
        'You are a senior web developer.',
        'Return ONLY valid HTML for a single-page website.',
        'Include embedded CSS and JavaScript inside <style> and <script> tags.',
        'Do not use markdown fences.',
        'Use semantic HTML and responsive layout.',
        'Make the design modern and visually strong.',
    ].join(' ');
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                // Optional but recommended by OpenRouter:
                'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5173',
                'X-Title': process.env.OPENROUTER_APP_NAME || 'AI Website Stack',
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`OpenRouter request failed (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        const html = (data.choices?.[0]?.message?.content || '').trim();
        if (!html) {
            throw new Error('AI returned empty output.');
        }
        return res.json({ html });
    }
    catch (error) {
        console.error('Generation failed:', error);
        return res.status(500).json({ error: 'Failed to generate website. Please try again.' });
    }
});
app.get('/', (req, res) => {
    res.send('Server is running!');
});
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
