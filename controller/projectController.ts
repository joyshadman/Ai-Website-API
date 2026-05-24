import express, { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import openai from '../config/openai.js';

// controller function to make Revision

export const makeRevision = async (req: Request, res: Response) => {
    const userid = req.userId;
    try {

        const { projectId } = req.params;
        const { message } = req.body;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userid },
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.credits < 5) {
            return res.status(403).json({ error: 'User cannot make a revision with insufficient credit ' });
        }

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Please provide a valid prompt.' });
        }

        // FIX (TS2412): Extract projectId as string BEFORE using in Prisma where clause.
        // req.params values are typed as string | string[] | undefined, but Prisma's
        // WebsiteProjectWhereUniqueInput.id only accepts string | undefined.
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const currentProject = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId: userid },
            include: { versions: true },
        });

        if (!currentProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: message,
                projectId: projectIdStr
            },
        });

        await prisma.user.update({
            where: { id: userid },
            data: { credits: { decrement: 5 } },
        });

        // Enhance User prompt
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: `You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.

Enhance this by:
- Being specific about what elements to change (sections, components, UI blocks)
- Mentioning design details (colors, spacing, typography, sizes, border radius, layout system)
- Clarifying the desired outcome and user experience behavior
- Using clear technical terms (responsive design, flexbox/grid, lazy loading, CDN image delivery, object-fit/object-cover)

If the request involves images, galleries, backgrounds, or media:
- MUST specify CDN-hosted images (not local files)
- MUST mention fetching images dynamically from internet sources via CDN URLs
- MUST include responsive image handling (lazy loading, optimized resolution, object-cover, grid layout)

Return ONLY the enhanced request, nothing else. Keep it concise (1–2 sentences).`
                },
                {
                    role: 'user',
                    content: `User Request: "${message}"`,
                },
            ],
        });

        // choices[0] may be undefined — use optional chaining + nullish fallback
        const enhancedPrompt = promptEnhanceResponse.choices[0]?.message?.content ?? message;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I have enhanced the user prompt "${enhancedPrompt}"`,
                projectId: projectIdStr
            },
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now making Changes to your website...',
                projectId: projectIdStr
            },
        });

        // Generate Website code
        const codeGenerationResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY a complete, valid, and updated standalone HTML document.
- Use Tailwind CSS ONLY for styling (no custom CSS, no <style> blocks).
- All UI styling must use Tailwind utility classes.
- Include all JavaScript inside <script> tags before </body>.
- Ensure mobile-first responsive design (sm, md, lg breakpoints).
- Maintain clean semantic HTML structure.
- Output must be production-ready and error-free.
- Do NOT include explanations, comments, or markdown — ONLY HTML.

IMAGE HANDLING RULES (IMPORTANT):
- If images are required, use CDN-hosted image URLs only.
- Images must be responsive using Tailwind classes like object-cover, w-full, h-auto.
- Use lazy loading (loading="lazy") for all images.
- Ensure images are optimized for performance and responsiveness.

Apply the requested changes while preserving existing structure unless explicitly asked to replace it.`
                },
                {
                    role: 'user',
                    content: `CURRENT WEBSITE CODE:
${currentProject.current_code}

USER REQUEST (ENHANCED):
${enhancedPrompt}

TASK:
Modify the existing website code according to the request while keeping it fully functional and Tailwind-based. Return only the final updated HTML.`
                },
            ],
        });

        // choices[0] may be undefined — use optional chaining + nullish fallback
        const code = codeGenerationResponse.choices[0]?.message?.content ?? '';

        const version = await prisma.version.create({
            data: {
                code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                description: 'changes made',
                projectId: projectIdStr
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've made the changes to your website! You can now preview it",
                projectId: projectIdStr
            }
        });

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                current_version_index: version.id
            }
        });

        res.json({ message: 'Revision made successfully', versionId: version.id });
    } catch (error: any) {
        // FIX (logic bug): On error, REFUND (increment) the credits that were already
        // deducted earlier in the happy path — do NOT decrement again.
        if (userid) {
            await prisma.user.update({
                where: { id: userid },
                data: { credits: { increment: 5 } },
            });
        }
        console.error('Make revision error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

// controller function to rollback to previous version

export const rollbackToVersion = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId, versionId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');
        const versionIdStr = typeof versionId === 'string' ? versionId : String(versionId ?? '');

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId: userid },
            include: { versions: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const version = await prisma.version.findUnique({
            where: { id: versionIdStr }
        });

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectIdStr, userId: userid },
            data: { current_code: version.code, current_version_index: version.id }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've rolled back your website to the selected version. You can now preview it.`,
                projectId: projectIdStr
            }
        });

        res.json({ message: 'Rollback successful' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// controller function to delete project

export const deleteProject = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await prisma.conversation.deleteMany({ where: { projectId: projectIdStr } });
        await prisma.version.deleteMany({ where: { projectId: projectIdStr } });

        await prisma.websiteProject.delete({
            where: { id: projectIdStr },
        });

        res.json({ message: 'Project deleted successfully' });
    } catch (error: any) {
        console.error('Delete project error:', error);
        res.status(500).json({ message: error.message });
    }
}

// Controller for getting project code for preview

export const getProjectPreview = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
            include: { versions: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ project });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller for getting published projects

export const getPublishedProjects = async (req: Request, res: Response) => {
    try {
        const projects = await prisma.websiteProject.findMany({
            where: { isPublished: true },
            include: { user: true },
        });

        res.json({ projects });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// get a single project by id

export const getProjectById = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr },
        });

        if (!project || project.isPublished === false || !project.current_code) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ code: project.current_code });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller to save project

export const saveProjectCode = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
        // FIX (TS2412): Extract as plain string before passing to Prisma where clause
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');
        const { code } = req.body;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId: userid },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectIdStr, userId: userid },
            data: { current_code: code, current_version_index: '' }
        });

        res.json({ message: 'Project code saved successfully' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}