import express, { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import openai from '../config/openai.js';
import { htmlToComponents } from '../lib/htmlToSchema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract all http/https URLs from a string */
function extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
    return [...new Set(text.match(urlRegex) ?? [])];
}

/** Fetch a URL and return its text content (stripped of scripts/styles/tags) */
async function fetchUrlContent(url: string): Promise<string> {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000),
        });
        const html = await res.text();
        return html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .slice(0, 4000);
    } catch {
        return '';
    }
}

/** Build an optional reference block from any URLs found in the message */
async function buildReferenceBlock(message: string): Promise<string> {
    const urls = extractUrls(message);
    if (urls.length === 0) return '';

    const fetched = await Promise.all(
        urls.map(async (url) => {
            const content = await fetchUrlContent(url);
            return content ? `--- Reference: ${url} ---\n${content}` : null;
        })
    );

    const valid = fetched.filter(Boolean).join('\n\n');
    return valid
        ? `\n\nREFERENCE CONTENT (scraped from URLs in user message — use for design inspiration and context):\n${valid}`
        : '';
}

// ─── Shared system prompts ────────────────────────────────────────────────────

const CODE_GEN_SYSTEM_PROMPT = `You are an expert web developer.

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
- ALWAYS include explicit width and height attributes on every <img> tag
  (e.g. <img src="..." width="1200" height="800" loading="lazy" class="object-cover w-full h-auto">)
  so the browser renders at actual resolution and prevents layout shift.
- Ensure images are optimized for performance and responsiveness.

REFERENCE CONTENT RULES:
- If REFERENCE CONTENT is provided below the user request, use it as design/layout inspiration.
- Mirror the structure, color palette, typography style, and section layout from the reference.
- Do NOT copy any text content verbatim from references — only use them for visual/design guidance.

Apply the requested changes while preserving existing structure unless explicitly asked to replace it.`;

const PROMPT_ENHANCE_SYSTEM = `You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.

Enhance this by:
- Being specific about what elements to change (sections, components, UI blocks)
- Mentioning design details (colors, spacing, typography, sizes, border radius, layout system)
- Clarifying the desired outcome and user experience behavior
- Using clear technical terms (responsive design, flexbox/grid, lazy loading, CDN image delivery, object-fit/object-cover)

If the request involves images, galleries, backgrounds, or media:
- MUST specify CDN-hosted images (not local files)
- MUST mention fetching images dynamically from internet sources via CDN URLs
- MUST include responsive image handling (lazy loading, optimized resolution, object-cover, grid layout)
- MUST include explicit width and height attributes for layout stability

Return ONLY the enhanced request, nothing else. Keep it concise (1–2 sentences).`;

// ─── Controllers ─────────────────────────────────────────────────────────────

// Controller function to make Revision
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
            return res.status(403).json({ error: 'User cannot make a revision with insufficient credit' });
        }

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Please provide a valid prompt.' });
        }

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

        // Build reference block from any URLs in the message
        const referenceBlock = await buildReferenceBlock(message);

        // Enhance user prompt
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: PROMPT_ENHANCE_SYSTEM,
                },
                {
                    role: 'user',
                    content: `User Request: "${message}"`,
                },
            ],
        });

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

        // Generate website code
        const codeGenerationResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: CODE_GEN_SYSTEM_PROMPT,
                },
                {
                    role: 'user',
                    content: `CURRENT WEBSITE CODE:
${currentProject.current_code}

USER REQUEST (ENHANCED):
${enhancedPrompt}${referenceBlock}

TASK:
Modify the existing website code according to the request while keeping it fully functional and Tailwind-based. Return only the final updated HTML.`,
                },
            ],
        });

        const code = codeGenerationResponse.choices[0]?.message?.content ?? '';

        const cleanCode = code
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        const version = await prisma.version.create({
            data: {
                code: cleanCode,
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

        const components = htmlToComponents(cleanCode);
        const pageData = JSON.stringify({ components });

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: cleanCode,
                current_version_index: version.id,
                pageData,
            }
        });

        res.json({ message: 'Revision made successfully', versionId: version.id });
    } catch (error: any) {
        // Refund credits on failure
        if (userid) {
            await prisma.user.update({
                where: { id: userid },
                data: { credits: { increment: 5 } },
            });
        }
        console.error('Make revision error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Controller function to rollback to previous version
export const rollbackToVersion = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId, versionId } = req.params;
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

        const rollbackComponents = htmlToComponents(version.code);
        const rollbackPageData = JSON.stringify({ components: rollbackComponents });

        await prisma.websiteProject.update({
            where: { id: projectIdStr, userId: userid },
            data: {
                current_code: version.code,
                current_version_index: version.id,
                pageData: rollbackPageData,
            }
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
};

// Controller function to delete project
export const deleteProject = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
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
};

// Controller for getting project code for preview
export const getProjectPreview = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
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
};

// Controller for getting published projects
export const getPublishedProjects = async (req: Request, res: Response) => {
    try {
        const projects = await prisma.websiteProject.findMany({
            where: { isPublished: true },
            include: { user: true },
            orderBy: { updatedAt: 'desc' },
        });

        res.json({ projects });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};

// Get a single project by id
export const getProjectById = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
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
};

// Controller to save project
export const saveProjectCode = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
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
};

// Controller to edit project by prompt
export const editProjectByPrompt = async (req: Request, res: Response) => {
    const userid = req.userId;
    try {
        const { projectId } = req.params;
        const { message } = req.body;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Please provide a valid prompt.' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userid },
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.credits < 5) {
            return res.status(403).json({ error: 'Insufficient credits to edit project.' });
        }

        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId: userid },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await prisma.user.update({
            where: { id: userid },
            data: { credits: { decrement: 5 } },
        });

        // Build reference block from any URLs in the message
        const referenceBlock = await buildReferenceBlock(message);

        // Enhance the user prompt
        const enhanceResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: PROMPT_ENHANCE_SYSTEM,
                },
                {
                    role: 'user',
                    content: `User Request: "${message}"`,
                },
            ],
        });

        const enhancedPrompt = enhanceResponse.choices[0]?.message?.content ?? message;

        // Generate updated code
        const codeResponse = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages: [
                {
                    role: 'system',
                    content: CODE_GEN_SYSTEM_PROMPT,
                },
                {
                    role: 'user',
                    content: `CURRENT WEBSITE CODE:
${project.current_code}

USER REQUEST (ENHANCED):
${enhancedPrompt}${referenceBlock}

TASK:
Modify the existing website code according to the request while keeping it fully functional and Tailwind-based. Return only the final updated HTML.`,
                },
            ],
        });

        const rawCode = codeResponse.choices[0]?.message?.content ?? '';
        const cleanCode = rawCode
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        const version = await prisma.version.create({
            data: {
                code: cleanCode,
                description: `Prompt edit: ${message.slice(0, 80)}`,
                projectId: projectIdStr,
            },
        });

        const components = htmlToComponents(cleanCode);
        const pageData = JSON.stringify({ components });

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: cleanCode,
                current_version_index: version.id,
                pageData,
            },
        });

        res.json({ message: 'Project updated successfully', versionId: version.id });
    } catch (error: any) {
        // Refund credits on failure
        if (userid) {
            await prisma.user.update({
                where: { id: userid },
                data: { credits: { increment: 5 } },
            });
        }
        console.error('Edit project by prompt error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Controller to toggle save a conversation message
export const toggleSaveMessage = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) return res.status(401).json({ error: 'Unauthorized' });

        const { conversationId } = req.params;
        const conversationIdStr = typeof conversationId === 'string'
            ? conversationId : String(conversationId ?? '');

        const message = await prisma.conversation.findFirst({
            where: {
                id: conversationIdStr,
                project: { userId: userid },
            },
        });

        if (!message) return res.status(404).json({ error: 'Message not found' });

        const updated = await prisma.conversation.update({
            where: { id: conversationIdStr },
            data: { isSaved: !message.isSaved },
        });

        res.json({ isSaved: updated.isSaved });
    } catch (error: any) {
        console.error('Toggle save message error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Controller to get saved messages for a project
export const getSavedMessages = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) return res.status(401).json({ error: 'Unauthorized' });

        const { projectId } = req.params;
        const projectIdStr = typeof projectId === 'string'
            ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        const saved = await prisma.conversation.findMany({
            where: { projectId: projectIdStr, isSaved: true },
            orderBy: { timestamp: 'desc' },
        });

        res.json({ saved });
    } catch (error: any) {
        console.error('Get saved messages error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};