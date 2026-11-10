import { CHARGE_REFUSALS, refillCredits } from '../lib/credits.js';
import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import { rebuildPageData } from '../lib/htmlToSchema.js';
import { MEDIA_PROMPT_RULE, deleteMediaKeys } from '../lib/media.js';
import { cleanFavicon } from '../lib/siteStyles.js';
import { usesTailwind } from '../lib/cssResolve.js';
import { PLAIN_CSS_RULES } from '../lib/plainCssPrompt.js';
import { ANIMATION_PROMPT_RULE, withAnimationBlocks } from '../lib/animations.js';
import { EDIT_DESIGN_RULE } from '../lib/designPrompt.js';
import {
    deductCredits,
    finalize,
    getJob,
    getLatestRunState,
    recoverLostRun,
    releaseJob,
    reserveJob,
    runGenerationJob,
    fullEditMaxTokens,
    SCOPED_MAX_TOKENS,
    stopJob,
    visibleHtml,
    writeStartMessages,
    type GenerationJob,
} from '../lib/generationJobs.js';
import { DAILY_LIMIT_MESSAGE, isAtDailyLimit } from '../lib/aiCapacity.js';
import { applyScopedReply, planScopedEdit, scopedUserMessage, type ScopedPlan } from '../lib/scopedEdit.js';

const MAX_REFERENCE_URLS = 2;
const MAX_REFERENCE_CHARS = 2000;

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
            .slice(0, MAX_REFERENCE_CHARS);
    } catch {
        return '';
    }
}

/** Build an optional reference block from any URLs found in the message */
async function buildReferenceBlock(message: string): Promise<string> {
    const urls = extractUrls(message).slice(0, MAX_REFERENCE_URLS);
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

export const CODE_GEN_SYSTEM_PROMPT = `You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY a complete, valid, and updated standalone HTML document.
- Use Tailwind CSS ONLY for styling (no custom CSS, no <style> blocks, except the data-apexium-* blocks, which you keep unchanged).
- All UI styling must use Tailwind utility classes.
${ANIMATION_PROMPT_RULE}
${MEDIA_PROMPT_RULE}
- Include all JavaScript inside <script> tags before </body>.
- Ensure mobile-first responsive design (sm, md, lg breakpoints).
- Maintain clean semantic HTML structure.
- Output must be production-ready and error-free.
- Do NOT include explanations, comments, or markdown — ONLY HTML.
- If the user's request is brief or vague, silently expand it into a detailed specification as you generate (concrete sections, layout, colors, typography, interactions). Never return the specification text itself — only the final HTML.

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

// Section edits (spec 0011): `applyScopedReply` enforces this reply format.
export const SCOPED_EDIT_PROMPT = `You edit part of an existing website. Output ONLY the changed parts in this format, with no explanation or markdown:
<apx-block id="B2">the full replacement element</apx-block>
<apx-css>new CSS rules, only if needed</apx-css>

RULES:
- Each apx-block holds exactly one element of the same kind as the original (header, nav, section, aside, or footer), with its closing tag. Keep its id and classes unless the request changes them.
- Return only the blocks you changed, and change only what the request asks. Keep all other content, attributes, and links exactly.
- Keep every data-c attribute and every data-apexium-logo element exactly as it is.
- Never put <script> or <style> inside a block, and never output <html>, <head>, or <body>.
- New styling goes only in apx-css, on a new class unique to this block that you add to the element, using the var() tokens. Never restyle a shared class. Keep it under 3000 characters, with no @import or @font-face.
${ANIMATION_PROMPT_RULE}
${MEDIA_PROMPT_RULE}
${EDIT_DESIGN_RULE}`;

// Plain CSS projects (spec 0003); the Tailwind prompt above stays for legacy projects.
export const PLAIN_CSS_EDIT_PROMPT = `You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY a complete, valid, and updated standalone HTML document.
- Keep the existing <head> stylesheet and extend it: reuse its custom properties and class names, and add new classes only when needed.
- The document may contain a <style data-apexium-site> block, a <style data-apexium-elements> block with [data-c="..."] rules, and matching data-c attributes (written by the visual editor). Keep both blocks and every data-c attribute. A [data-c="..."] rule overrides the class rules for that element, so to change how such an element looks, edit its [data-c="..."] rule. These blocks (and the data-apexium-anim style below) are the only exceptions to the one <style> rule below.
${ANIMATION_PROMPT_RULE}
${MEDIA_PROMPT_RULE}
${EDIT_DESIGN_RULE}
- Do NOT include explanations, comments, or markdown — ONLY HTML.
- If the user's request is brief or vague, silently expand it into a detailed specification as you generate (concrete sections, layout, colors, typography, interactions). Never return the specification text itself — only the final HTML.

${PLAIN_CSS_RULES}

IMAGE HANDLING RULES (IMPORTANT):
- If images are required, use CDN-hosted image URLs only.
- Make images responsive in the stylesheet (width: 100%; height: auto; object-fit: cover).
- Use lazy loading (loading="lazy") and explicit width and height attributes on every <img>.

REFERENCE CONTENT RULES:
- If REFERENCE CONTENT is provided below the user request, use it as design/layout inspiration.
- Mirror the structure, color palette, typography style, and section layout from the reference.
- Do NOT copy any text content verbatim from references — only use them for visual/design guidance.

Apply the requested changes while preserving existing structure unless explicitly asked to replace it.`;

/** A save or rollback during the run moved the page, so the splice no longer applies. */
async function assembleScopedEdit(projectId: string, plan: ScopedPlan, raw: string): Promise<string | null> {
    const latest = await prisma.websiteProject.findUnique({
        where: { id: projectId },
        select: { current_code: true },
    });
    return latest?.current_code === plan.source ? applyScopedReply(plan, raw) : null;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

// Shared start order for chat edits and revisions (spec 0001): responds 202
// right away and runs the AI call in the background job runner.
async function startEditRun(req: Request, res: Response, versionDescription: (message: string) => string) {
    const userid = req.userId;
    let job: GenerationJob | null = null;
    try {
        const { projectId } = req.params;
        const { message } = req.body;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (typeof message !== 'string' || message.trim() === '') {
            return res.status(400).json({ error: 'Please provide a valid prompt.' });
        }

        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
            select: { id: true, current_code: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await recoverLostRun(projectIdStr, userid);

        if (isAtDailyLimit()) {
            return res.status(503).json({ error: DAILY_LIMIT_MESSAGE });
        }

        await refillCredits(userid);

        const reserved = reserveJob(projectIdStr, userid, 'edit', versionDescription(message));
        if (reserved === 409) {
            return res.status(409).json({ error: 'A generation is already running for this project.' });
        }
        if (reserved === 429) {
            return res.status(429).json({ error: 'You already have 2 generations running. Please wait for one to finish.' });
        }
        job = reserved;

        const charge = await deductCredits(job);
        if (charge !== 'charged') {
            releaseJob(job);
            const { status, error } = CHARGE_REFUSALS[charge];
            return res.status(status).json({ error });
        }

        await writeStartMessages(job, message);

        res.status(202).json({ message: 'Edit started', runId: job.runId });

        const currentCode = project.current_code ?? '';
        // Legacy Tailwind projects keep the Tailwind prompt (spec 0003 AC-2).
        const plainCss = !usesTailwind(currentCode);
        job.plainCss = plainCss;
        const fullEdit = (referenceBlock: string) => ({
            maxTokens: fullEditMaxTokens(currentCode),
            messages: [
                {
                    role: 'system' as const,
                    content: plainCss ? PLAIN_CSS_EDIT_PROMPT : CODE_GEN_SYSTEM_PROMPT,
                },
                {
                    role: 'user' as const,
                    content: `CURRENT WEBSITE CODE:
${currentCode}

USER REQUEST:
${message}${referenceBlock}

TASK:
Modify the existing website code according to the request while keeping it fully functional and ${plainCss ? 'in plain HTML and CSS (no Tailwind)' : 'Tailwind-based'}. Return only the final updated HTML.`,
                },
            ],
        });
        void runGenerationJob(job, async () => {
            const plan = planScopedEdit(currentCode, message);
            if (plan) {
                return {
                    maxTokens: SCOPED_MAX_TOKENS,
                    thinkingOff: true,
                    messages: [
                        { role: 'system' as const, content: SCOPED_EDIT_PROMPT },
                        { role: 'user' as const, content: scopedUserMessage(plan, message) },
                    ],
                    assemble: (raw: string) => assembleScopedEdit(projectIdStr, plan, raw),
                    fallback: fullEdit(''),
                };
            }
            // Reference fetching runs inside the job so it never delays the response.
            return fullEdit(await buildReferenceBlock(message));
        });
    } catch (error: any) {
        if (job) await finalize(job, 'failed');
        console.error('Start edit error:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: error.code || error.message });
        }
    }
}

// Controller function to make Revision
export const makeRevision = (req: Request, res: Response) =>
    startEditRun(req, res, () => 'changes made');

// Controller to edit project by prompt
export const editProjectByPrompt = (req: Request, res: Response) =>
    startEditRun(req, res, (message) => `Prompt edit: ${message.slice(0, 80)}`);

// Controller for live generation progress: the HTML written after `from`
export const getGenerationProgress = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId } = req.params;
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
            select: { id: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await recoverLostRun(projectIdStr, userid);

        const fromParam = typeof req.query.from === 'string' ? Number.parseInt(req.query.from, 10) : 0;
        const clientRunId = typeof req.query.runId === 'string' ? req.query.runId : '';

        const job = getJob(projectIdStr);
        if (job) {
            const visible = visibleHtml(job);
            const offset = visible.length;
            // A different run than the client knows about starts from the beginning.
            const from = clientRunId !== job.runId || !Number.isFinite(fromParam) || fromParam < 0 ? 0 : fromParam;
            return res.json({
                status: 'running',
                runId: job.runId,
                phase: job.phase,
                html: from >= offset ? '' : visible.slice(from),
                offset,
            });
        }

        const { runId, outcome } = await getLatestRunState(projectIdStr);
        res.json({ status: 'idle', runId, html: '', offset: 0, outcome });
    } catch (error: any) {
        console.error('Generation progress error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Controller to stop a running generation (credits are refunded by the job)
export const stopGeneration = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { projectId } = req.params;
        const projectIdStr = typeof projectId === 'string' ? projectId : String(projectId ?? '');

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid },
            select: { id: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (!stopJob(projectIdStr)) {
            return res.status(409).json({ error: 'Nothing is running for this project.' });
        }

        res.status(202).json({ message: 'Stopping generation' });
    } catch (error: any) {
        console.error('Stop generation error:', error);
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

        // The current favicon survives a rollback (spec 0006 AC-11).
        const rollbackPageData = JSON.stringify(rebuildPageData(version.code, project.pageData));

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

        // Read the media keys first: the rows cascade away with the project (spec 0006 AC-9).
        const assets = await prisma.asset.findMany({ where: { projectId: projectIdStr }, select: { key: true } });

        await prisma.conversation.deleteMany({ where: { projectId: projectIdStr } });
        await prisma.version.deleteMany({ where: { projectId: projectIdStr } });

        await prisma.websiteProject.delete({
            where: { id: projectIdStr },
        });

        await deleteMediaKeys(assets.map(a => a.key), `delete project ${projectIdStr}`);

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
            include: { user: { select: { name: true, email: true } } },
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

        // The public view sets the visitor's tab icon from this (spec 0006 AC-3).
        let favicon = '';
        try { favicon = cleanFavicon(JSON.parse(project.pageData || '{}')?.globalStyles?.favicon) ?? ''; } catch { /* no stored styles */ }
        res.json({ code: project.current_code, favicon });
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
            // Raw HTML saves rebuild pageData too, so the editor never opens a stale copy (AC-10).
            // Raw HTML gets the preset blocks too, so presets in it play (spec 0007 AC-6).
            data: (() => {
                const html = withAnimationBlocks(code);
                return { current_code: html, current_version_index: '', pageData: JSON.stringify(rebuildPageData(html, project.pageData)) };
            })()
        });

        res.json({ message: 'Project code saved successfully' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
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