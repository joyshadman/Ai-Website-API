import type OpenAI from 'openai';
import { type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import {
    deductCredits,
    finalize,
    releaseJob,
    reserveJob,
    runGenerationJob,
    writeStartMessages,
    type GenerationJob,
} from '../lib/generationJobs.js';
import { PLAIN_CSS_RULES } from '../lib/plainCssPrompt.js';
import { DESIGN_RULES } from '../lib/designPrompt.js';

// Single AI request per action: the prompt itself tells the model to expand a
// brief request into a full site, so there is no separate enhance round trip.
export function buildCreateMessages(initial_prompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [{
                role: 'system',
                content: `You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${initial_prompt}"

    CRITICAL REQUIREMENTS:
    - If the request is brief or vague, silently expand it into a detailed specification as you generate: decide concrete sections, layout, color palette, and typography. Never return the specification text itself — only the final HTML.
    - You MUST output valid HTML ONLY: one complete document from <!DOCTYPE html> to </html>.
    - Fully responsive, with great UX.
    - Include all necessary meta tags.
    - Use placeholder images from https://placehold.co/600x400

    ${PLAIN_CSS_RULES}

    ${DESIGN_RULES}

    CRITICAL HARD RULES:
    1. You MUST put ALL output ONLY into message.content.
    2. You MUST NOT place anything in "reasoning", "analysis", "reasoning_details", or any hidden fields.
    3. You MUST NOT include internal thoughts, explanations, analysis, comments, or markdown.
    4. Do NOT include markdown, explanations, notes, or code fences.

    The HTML should be complete and ready to render as-is, with no external CSS framework.`,
            }, {
                role: 'user',
                content: initial_prompt,
            }];
}

export const getUserCredit = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma.user.findUnique({
            where: { id: userid },
            select: { credits: true },
        });
        res.json({ credits: user?.credits ?? 0 });
    } catch (error: any) {
        console.error('Get credit error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

export const createUserProject = async (req: Request, res: Response) => {
    const userid = req.userId;
    let job: GenerationJob | null = null;

    try {
        const { initial_prompt } = req.body;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!initial_prompt?.trim()) {
            return res.status(400).json({ error: 'Please provide a prompt.' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userid },
        });

        if (!user || user.credits < 5) {
            return res.status(403).json({ error: 'Insufficient credit' });
        }

        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 50
                    ? initial_prompt.substring(0, 47) + '...'
                    : initial_prompt,
                initial_prompt: initial_prompt.trim(),
                userId: userid,
            },
        });

        // Start order (spec 0001): synchronous registry check, atomic deduct,
        // then the user message and working marker, then respond and run.
        const reserved = reserveJob(project.id, userid, 'create', 'Initial version');
        if (reserved === 409 || reserved === 429) {
            await prisma.websiteProject.delete({ where: { id: project.id } });
            return res.status(reserved).json({ error: 'You already have 2 generations running. Please wait for one to finish.' });
        }
        job = reserved;
        job.plainCss = true;

        if (!(await deductCredits(job))) {
            releaseJob(job);
            await prisma.websiteProject.delete({ where: { id: project.id } });
            return res.status(403).json({ error: 'Insufficient credit' });
        }

        await prisma.user.update({
            where: { id: userid },
            data: { totalCreation: { increment: 1 } },
        });

        const prompt = initial_prompt.trim();
        await writeStartMessages(job, prompt);

        res.json({ projectId: project.id });

        void runGenerationJob(job, async () => buildCreateMessages(prompt));
    } catch (error: any) {
        if (job) await finalize(job, 'failed');

        console.error('Project creation error:', error);

        if (!res.headersSent) {
            res.status(500).json({ message: error.message || 'Failed to create project' });
        }
    }
}

export const getUserProject = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause.
        // req.params values are typed as string | string[] | undefined, but Prisma's
        // StringFilter only accepts string | StringFilter | undefined.
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
            include: {
                conversation: {
                    orderBy: {
                        timestamp: 'asc'
                    }
                },
                versions: {
                    orderBy: {
                        timestamp: 'asc'
                    }
                }
            }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ project });

    } catch (error: any) {
        console.error('Get project error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const projects = await prisma.websiteProject.findMany({
            where: { userId: userid },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        res.json({ projects });

    } catch (error: any) {
        console.error('Get projects error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

export const togglePublish = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const updatedProject = await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: { isPublished: !project.isPublished },
        });

        res.json({
            message: updatedProject.isPublished
                ? 'Project published successfully'
                : 'Project unpublished successfully'
        });

    } catch (error: any) {
        console.error('Toggle publish error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const purchaseCredit = async (req: Request, res: Response) => {
    res.status(501).json({ error: 'Payment processing is not yet implemented.' });
}