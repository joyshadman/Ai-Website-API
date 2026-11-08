import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import openai, { assertAiKeyConfigured } from '../config/openai.js';
import prisma from './prisma.js';
import { rebuildPageData, toPages } from './htmlToSchema.js';
import { usesTailwind } from './cssResolve.js';
import type { Page } from './links.js';
import { extractHtmlCode } from './extractCode.js';
import { withAnimationBlocks } from './animations.js';
import { checkDesign, directionFromHtml } from './designChecks.js';
import { withCreateLogo } from './logo.js';

/**
 * In memory registry of running AI generations (spec 0001).
 *
 * Every create, edit, and revision runs as one streamed OpenRouter call held in
 * this process. The builder polls `/api/project/progress/:projectId` for the
 * HTML written so far. The registry assumes a single API instance; running
 * several would need a shared store.
 */

// ─── Outcome messages (the only strings `outcome` is derived from) ───────────

export const MARKER_CREATE = 'Now generating the website...';
export const MARKER_EDIT = 'Now making Changes to your website...';
export const DONE_CREATE = 'I generated the website! You can now preview it and if you want any changes just ask me.';
export const DONE_EDIT = "I've made the changes to your website! You can now preview it";
export const FAILED = 'Generation failed. Your credits have been refunded. Please try again.';
export const STOPPED = 'Generation stopped. Your credits have been refunded.';

export const GENERATION_COST = 5;

const STALL_MS = 90_000;
const MAX_RUN_MS = 5 * 60_000;
const CHECK_MS = 10_000;
const MAX_RAW_CHARS = 2 * 1024 * 1024;
const MAX_JOBS_PER_USER = 2;

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobKind = 'create' | 'edit';
export type JobOutcome = 'done' | 'failed' | 'stopped';
export type RunOutcome = JobOutcome | 'none';
type StopReason = 'user' | 'stall' | 'timeout';

export interface GenerationJob {
    projectId: string;
    userId: string;
    kind: JobKind;
    versionDescription: string;
    raw: string;
    phase: 'thinking' | 'writing';
    runId: string;
    visibleStart: number | null;
    startedAt: number;
    lastProgressAt: number;
    abort: AbortController;
    timer: NodeJS.Timeout | null;
    stopReason: StopReason | null;
    settled: boolean;
    creditsDeducted: boolean;
    /** The run used a plain CSS prompt (spec 0003), so Tailwind in its output is a slip. */
    plainCss?: boolean;
}

type ChatMessages = OpenAI.Chat.ChatCompletionMessageParam[];

// OpenRouter reasoning fields are not in the OpenAI SDK types.
type OpenRouterDelta = OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
    reasoning?: string | null;
    reasoning_details?: unknown;
};

const jobs = new Map<string, GenerationJob>();

// ─── Registry ────────────────────────────────────────────────────────────────

export function getJob(projectId: string): GenerationJob | undefined {
    return jobs.get(projectId);
}

/**
 * Synchronous start check: no `await` may run between the checks and the
 * insert, so two requests arriving together can never both pass (AC-8).
 */
export function reserveJob(
    projectId: string,
    userId: string,
    kind: JobKind,
    versionDescription: string
): GenerationJob | 409 | 429 {
    if (jobs.has(projectId)) return 409;

    let userJobs = 0;
    for (const job of jobs.values()) {
        if (job.userId === userId) userJobs++;
    }
    if (userJobs >= MAX_JOBS_PER_USER) return 429;

    const now = Date.now();
    const job: GenerationJob = {
        projectId,
        userId,
        kind,
        versionDescription,
        raw: '',
        phase: 'thinking',
        runId: '',
        visibleStart: null,
        startedAt: now,
        lastProgressAt: now,
        abort: new AbortController(),
        timer: null,
        stopReason: null,
        settled: false,
        creditsDeducted: false,
    };
    jobs.set(projectId, job);
    return job;
}

/** Drop a placeholder that never deducted credits (the 403 path). */
export function releaseJob(job: GenerationJob): void {
    job.settled = true;
    if (jobs.get(job.projectId) === job) jobs.delete(job.projectId);
}

/** Atomic deduct: only succeeds when the user still has enough credits. */
export async function deductCredits(job: GenerationJob): Promise<boolean> {
    const { count } = await prisma.user.updateMany({
        where: { id: job.userId, credits: { gte: GENERATION_COST } },
        data: { credits: { decrement: GENERATION_COST } },
    });
    if (count === 0) return false;
    job.creditsDeducted = true;
    return true;
}

/** Writes the user message and the working marker; the marker id becomes `runId`. */
export async function writeStartMessages(job: GenerationJob, userMessage: string): Promise<void> {
    await prisma.conversation.create({
        data: { role: 'user', content: userMessage, projectId: job.projectId },
    });
    const marker = await prisma.conversation.create({
        data: {
            role: 'assistant',
            content: job.kind === 'create' ? MARKER_CREATE : MARKER_EDIT,
            projectId: job.projectId,
        },
    });
    job.runId = marker.id;
}

/** HTML from the first `<!doctype` or `<html` onwards; empty until one appears. */
export function visibleHtml(job: GenerationJob): string {
    return job.visibleStart === null ? '' : job.raw.slice(job.visibleStart);
}

/** Aborts a running job at the user's request. Returns false when nothing can be stopped. */
export function stopJob(projectId: string): boolean {
    const job = jobs.get(projectId);
    if (!job || job.settled) return false;
    job.stopReason ??= 'user';
    job.abort.abort();
    return true;
}

// ─── Ending a run ────────────────────────────────────────────────────────────

/**
 * One `[design-check]` log line for a saved create, or a saved edit of a plain CSS site (spec 0007
 * AC-9). Never throws: a check can't affect the save. An edit of a site made before spec 0007
 * (no direction meta in its previous code) is `legacy`, so only the motion and script checks run.
 */
function logDesignCheck(job: GenerationJob, code: string, previousCode: string): void {
    try {
        if (usesTailwind(code)) return;
        const legacy = job.kind === 'edit' && directionFromHtml(previousCode) === null;
        const result = checkDesign(code, { kind: job.kind, legacy });
        console.info('[design-check]', JSON.stringify({ projectId: job.projectId, kind: job.kind, ...result }));
    } catch (error) {
        console.error('[design-check] check failed to run', error);
    }
}

/**
 * The single owner of every ending (AC-11). Claims the ending synchronously,
 * so a run can never both save a version and refund, or refund twice.
 */
export async function finalize(job: GenerationJob, outcome: JobOutcome, code?: string): Promise<void> {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearInterval(job.timer);
    job.timer = null;
    if (jobs.get(job.projectId) === job) jobs.delete(job.projectId);

    if (outcome === 'done' && code) {
        // A new site's logo: the cleaned AI mark in every marker, or the monogram (spec 0008 AC-1, AC-4).
        // Never fails the save and never costs credits.
        if (job.kind === 'create') {
            try {
                code = withCreateLogo(code).html;
            } catch (error) {
                console.error('[logo] create logo step skipped:', error);
            }
        }
        // Exactly one copy of the preset sheet and scripts when the page uses presets (spec 0007 AC-6).
        code = withAnimationBlocks(code);
        try {
            const versionId = randomUUID();
            // Links in the new HTML match against the project's current pages (spec 0002).
            const current = await prisma.websiteProject.findUnique({
                where: { id: job.projectId },
                select: { pageData: true, current_code: true },
            });
            let currentPages: Page[] = [];
            try { currentPages = toPages(JSON.parse(current?.pageData || '{}')); } catch { /* no usable pages */ }
            // AC-4: a Tailwind slip still saves (it imports through the legacy path).
            if (job.plainCss && usesTailwind(code)) console.warn('[plain-css] tailwind in output', job.projectId);
            const pageData = JSON.stringify(rebuildPageData(code, current?.pageData, { pages: currentPages, pageId: 'page-1' }));
            await prisma.$transaction([
                prisma.version.create({
                    data: { id: versionId, code, description: job.versionDescription, projectId: job.projectId },
                }),
                prisma.conversation.create({
                    data: {
                        role: 'assistant',
                        content: job.kind === 'create' ? DONE_CREATE : DONE_EDIT,
                        projectId: job.projectId,
                    },
                }),
                prisma.websiteProject.update({
                    where: { id: job.projectId },
                    data: { current_code: code, current_version_index: versionId, pageData },
                }),
            ]);
            logDesignCheck(job, code, current?.current_code ?? '');
            return;
        } catch (error) {
            // The transaction rolled back, so nothing was saved: refund instead.
            console.error('Saving generation failed:', error);
            outcome = 'failed';
        }
    }

    try {
        await prisma.$transaction([
            prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: outcome === 'stopped' ? STOPPED : FAILED,
                    projectId: job.projectId,
                },
            }),
            ...(job.creditsDeducted
                ? [prisma.user.update({
                    where: { id: job.userId },
                    data: { credits: { increment: GENERATION_COST } },
                })]
                : []),
        ]);
    } catch (error) {
        console.error('Recording failed generation (refund lost):', error);
    }
}

// ─── Running a job ───────────────────────────────────────────────────────────

/**
 * Streams one OpenRouter call (low reasoning, no retries) into `job.raw` and
 * ends through `finalize`. `buildMessages` runs inside the job, after the
 * response was sent, so slow work like URL reference fetching never blocks it.
 */
export async function runGenerationJob(
    job: GenerationJob,
    buildMessages: () => Promise<ChatMessages>
): Promise<void> {
    try {
        assertAiKeyConfigured();
        const messages = await buildMessages();
        if (job.abort.signal.aborted) throw new Error('Aborted before the request was sent');

        job.startedAt = Date.now();
        job.lastProgressAt = job.startedAt;
        job.timer = setInterval(() => {
            const now = Date.now();
            if (now - job.lastProgressAt > STALL_MS) job.stopReason ??= 'stall';
            else if (now - job.startedAt > MAX_RUN_MS) job.stopReason ??= 'timeout';
            else return;
            job.abort.abort();
        }, CHECK_MS);

        const stream = await openai.chat.completions.create({
            model: 'gpt-oss-120b',
            messages,
            stream: true,
            reasoning: { effort: 'low' },
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal: job.abort.signal });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as OpenRouterDelta | undefined;
            if (!delta) continue;
            if (delta.reasoning || delta.reasoning_details) job.lastProgressAt = Date.now();

            const content = delta.content;
            if (!content) continue;
            job.lastProgressAt = Date.now();
            job.phase = 'writing';
            const searchFrom = Math.max(0, job.raw.length - 16);
            job.raw += content;
            if (job.raw.length > MAX_RAW_CHARS) {
                throw new Error('AI output exceeded the 2 MB limit');
            }
            if (job.visibleStart === null) {
                const found = job.raw.slice(searchFrom).search(/<!doctype|<html/i);
                if (found !== -1) job.visibleStart = searchFrom + found;
            }
        }

        if (job.abort.signal.aborted) throw new Error('Aborted');

        const code = extractHtmlCode(job.raw);
        if (!code) throw new Error('AI returned empty or invalid HTML; nothing was saved.');

        // No await between this check and finalize claiming the ending.
        if (job.abort.signal.aborted) throw new Error('Aborted');
        await finalize(job, 'done', code);
    } catch (error) {
        if (job.abort.signal.aborted) {
            await finalize(job, job.stopReason === 'user' ? 'stopped' : 'failed');
            return;
        }
        console.error('Background generation error:', error);
        await finalize(job, 'failed');
    }
}

// ─── Run state and restart recovery ──────────────────────────────────────────

/**
 * Fails a run lost to an API restart: no job in the registry, yet the latest
 * assistant message is still a working marker older than 90 s. The refund
 * happens only when the conditional marker update wins (`count === 1`), so it
 * can never double refund. Never touches `current_code` (AC-6).
 */
export async function recoverLostRun(projectId: string, userId: string): Promise<void> {
    if (jobs.has(projectId)) return;

    const last = await prisma.conversation.findFirst({
        where: { projectId, role: 'assistant' },
        orderBy: { timestamp: 'desc' },
        select: { id: true, content: true, timestamp: true },
    });
    if (!last || (last.content !== MARKER_CREATE && last.content !== MARKER_EDIT)) return;
    if (Date.now() - last.timestamp.getTime() <= STALL_MS) return;

    try {
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.conversation.updateMany({
                where: { id: last.id, content: last.content },
                data: { content: FAILED },
            });
            if (count === 1) {
                await tx.user.update({
                    where: { id: userId },
                    data: { credits: { increment: GENERATION_COST } },
                });
            }
        });
    } catch (error) {
        console.error('Recovering lost generation failed:', error);
    }
}

/** For an idle project: the latest run's id (its working marker) and how it ended. */
export async function getLatestRunState(projectId: string): Promise<{ runId: string | null; outcome: RunOutcome }> {
    const [marker, last] = await Promise.all([
        prisma.conversation.findFirst({
            where: { projectId, role: 'assistant', content: { in: [MARKER_CREATE, MARKER_EDIT] } },
            orderBy: { timestamp: 'desc' },
            select: { id: true, content: true },
        }),
        prisma.conversation.findFirst({
            where: { projectId, role: 'assistant' },
            orderBy: { timestamp: 'desc' },
            select: { content: true },
        }),
    ]);

    let outcome: RunOutcome = 'none';
    const content = last?.content ?? '';
    if (content === DONE_CREATE || content === DONE_EDIT) outcome = 'done';
    else if (content.startsWith('Generation failed')) outcome = 'failed';
    else if (content.startsWith('Generation stopped')) outcome = 'stopped';

    return { runId: marker?.id ?? null, outcome };
}
