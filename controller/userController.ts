import openai from '../config/openai.js';
import express, { type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import { htmlToComponents } from '../lib/htmlToSchema.js';

const cleanCode = (code: string) => code
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```$/g, '')
    .trim();

async function refundCredits(userId: string) {
    try {
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: 5 } },
        });
    } catch (refundError) {
        console.error('Failed to refund credits:', refundError);
    }
}

async function generateProjectWebsite(
    projectId: string,
    initial_prompt: string,
    userId: string
) {
    try {
        const existing = await prisma.websiteProject.findFirst({
            where: { id: projectId, userId },
            select: { current_code: true },
        });

        if (!existing || existing.current_code) {
            return;
        }

        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: `You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.

Enhance this prompt by:
1. Adding specific design details (layout, color scheme, typography)
2. Specifying key sections and features
3. Describing the user experience and interactions
4. Including modern web design best practices
5. Mentioning responsive design requirements
6. Adding any missing but important elements

Return ONLY the enhanced prompt, nothing else. Make it detailed but concise (2-3 paragraphs max).`,
                },
                {
                    role: 'user',
                    content: initial_prompt,
                },
            ],
        });

        // FIX (TS2532): choices[0] is possibly undefined — use optional chaining + fallback
        const enhancedPrompt = promptEnhanceResponse.choices[0]?.message?.content ?? initial_prompt;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I enhanced the prompt to: ${enhancedPrompt}`,
                projectId,
            },
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now generating the website...',
                projectId,
            },
        });

        const codeGenerationResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [{
                role: 'system',
                content: `You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"

    CRITICAL REQUIREMENTS:
    - You MUST output valid HTML ONLY. 
    - Use Tailwind CSS for ALL styling
    - Include this EXACT script in the <head>: <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    - Use Tailwind utility classes extensively for styling, animations, and responsiveness
    - Make it fully functional and interactive with JavaScript in <script> tag before closing </body>
    - Use modern, beautiful design with great UX using Tailwind classes
    - Make it responsive using Tailwind responsive classes (sm:, md:, lg:, xl:)
    - Use Tailwind animations and transitions (animate-*, transition-*)
    - Include all necessary meta tags
    - Use Google Fonts CDN if needed for custom fonts
    - Use placeholder images from https://placehold.co/600x400
    - Use Tailwind gradient classes for beautiful backgrounds
    - Make sure all buttons, cards, and components use Tailwind styling

    CRITICAL HARD RULES:
    1. You MUST put ALL output ONLY into message.content.
    2. You MUST NOT place anything in "reasoning", "analysis", "reasoning_details", or any hidden fields.
    3. You MUST NOT include internal thoughts, explanations, analysis, comments, or markdown.
    4. Do NOT include markdown, explanations, notes, or code fences.

    The HTML should be complete and ready to render as-is with Tailwind CSS.`,
            }, {
                role: 'user',
                content: enhancedPrompt,
            }],
        });

        // FIX (TS2532): choices[0] is possibly undefined — use optional chaining + fallback
        const code = codeGenerationResponse.choices[0]?.message?.content ?? '';

        const version = await prisma.version.create({
            data: {
                code: cleanCode(code),
                description: 'Initial version',
                projectId,
            },
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'I generated the website! You can now preview it and if you want any changes just ask me.',
                projectId,
            },
        });

        const cleanedCode = cleanCode(code);
        console.log("[DEBUG] AI generated HTML length:", cleanedCode.length);
        const components = htmlToComponents(cleanedCode);
        console.log("[DEBUG] htmlToComponents produced", components.length, "components");
        const pageData = JSON.stringify({
          pages: [
            { id: 'page-1', name: 'Home', slug: '/', components }
          ],
          globalStyles: {}
        });
        console.log("[DEBUG] pageData length:", pageData.length);

        await prisma.websiteProject.update({
            where: { id: projectId },
            data: {
                current_code: cleanedCode,
                current_version_index: version.id,
                pageData,
            },
        });
        console.log("[DEBUG] Project updated with pageData and current_code");
    } catch (error) {
        console.error('Background generation error:', error);

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Generation failed. Your credits have been refunded. Please try again.',
                projectId,
            },
        }).catch(() => undefined);

        await refundCredits(userId);
    }
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
    let creditsDeducted = false;

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

        await prisma.user.update({
            where: { id: userid },
            data: { totalCreation: { increment: 1 } },
        });

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt.trim(),
                projectId: project.id,
            },
        });

        await prisma.user.update({
            where: { id: userid },
            data: { credits: { decrement: 5 } },
        });
        creditsDeducted = true;

        res.json({ projectId: project.id });

        void generateProjectWebsite(project.id, initial_prompt.trim(), userid);
    } catch (error: any) {
        if (creditsDeducted && userid) {
            await refundCredits(userid);
        }

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

}