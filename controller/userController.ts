import type OpenAI from 'openai';
import { type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import {
    deductCredits,
    finalize,
    releaseJob,
    reserveJob,
    runGenerationJob,
    CREATE_MAX_TOKENS,
    writeStartMessages,
    type GenerationJob,
} from '../lib/generationJobs.js';
import { PLAIN_CSS_RULES } from '../lib/plainCssPrompt.js';
import { DESIGN_RULES } from '../lib/designPrompt.js';
import { DAILY_LIMIT_MESSAGE, isAtDailyLimit } from '../lib/aiCapacity.js';
import { CHARGE_REFUSALS, chargeRefusal, msUntilNextRefill, refillCredits, REFILL_TO } from '../lib/credits.js';
import { serverError } from '../lib/http.js';

// Single AI request per action: the prompt itself tells the model to expand a
// brief request into a full site, so there is no separate enhance round trip.
export function buildCreateMessages(initial_prompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [{
                role: 'system',
                content: `You are an expert web developer. Create a complete, production-ready, single-page website for the user's request. If it is brief or vague, silently decide concrete sections and content.

Output ONLY one complete, fully responsive HTML document from <!DOCTYPE html> to </html>, with no explanations, comments, markdown, or code fences. Placeholder images: https://placehold.co/600x400

${PLAIN_CSS_RULES}

${DESIGN_RULES}`,
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
        await refillCredits(userid);
        const user = await prisma.user.findUnique({
            where: { id: userid },
            select: { credits: true },
        });
        res.json({ credits: user?.credits ?? 0, refillTo: REFILL_TO, refillInMs: msUntilNextRefill() });
    } catch (error: any) {
        console.error('Get credit error:', error);
        serverError(res, error, 'userController');
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

        if (isAtDailyLimit()) {
            return res.status(503).json({ error: DAILY_LIMIT_MESSAGE });
        }

        await refillCredits(userid);

        const user = await prisma.user.findUnique({
            where: { id: userid },
            select: { credits: true, generationStartsToday: true },
        });

        const refusal = chargeRefusal(user);
        if (refusal) {
            const { status, error } = CHARGE_REFUSALS[refusal];
            return res.status(status).json({ error });
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

        const charge = await deductCredits(job);
        if (charge !== 'charged') {
            releaseJob(job);
            await prisma.websiteProject.delete({ where: { id: project.id } });
            const { status, error } = CHARGE_REFUSALS[charge];
            return res.status(status).json({ error });
        }

        await prisma.user.update({
            where: { id: userid },
            data: { totalCreation: { increment: 1 } },
        });

        const prompt = initial_prompt.trim();
        await writeStartMessages(job, prompt);

        res.json({ projectId: project.id });

        void runGenerationJob(job, async () => ({ messages: buildCreateMessages(prompt), maxTokens: CREATE_MAX_TOKENS }));
    } catch (error: any) {
        if (job) await finalize(job, 'failed');

        console.error('Project creation error:', error);

        if (!res.headersSent) {
            serverError(res, error, 'userController');
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
        serverError(res, error, 'userController');
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
        serverError(res, error, 'userController');
    }
}

export const purchaseCredit = async (req: Request, res: Response) => {
    res.status(501).json({ error: 'Payment processing is not yet implemented.' });
}