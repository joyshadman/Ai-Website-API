import { chargeRefusal, DAILY_START_LIMIT, GENERATION_COST, type ChargeRefusal } from './credits.js';
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
import { repairCreatedSite } from './repairSite.js';
import { BadOutputError, classifyFailure, failureCause, isThinkingRequiredError, markDailyLimit, markRequiresThinking, pickModels, recordFailure, requiresThinking, type AttemptFailure } from './aiCapacity.js';

/**
 * In memory registry of running AI generations (spec 0001).
 *
 * Every create, edit, and revision streams from up to three free models in turn
 * (spec 0010), held in this process. The builder polls `/api/project/progress/:projectId` for the
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
// `getLatestRunState` reads the outcome from the `Generation failed` prefix.
const FAILED_MINUTE_LIMIT = 'Generation failed. Free AI is busy right now and your credits have been refunded. Please try again in a minute.';
const FAILED_DAILY_LIMIT = 'Generation failed. Free AI is at capacity today and your credits have been refunded. Please try again after the daily reset.';


// Generous on purpose: these stop runaway replies, not normal ones (spec 0011).
export const CREATE_MAX_TOKENS = 32_000;
export const SCOPED_MAX_TOKENS = 6_000;
const SCOPED_THINKING_MAX_TOKENS = 16_000;
/** About 20,000 tokens of thinking with no page text yet ends the try (AC-13). */
const MAX_THINKING_CHARS = 80_000;
export const fullEditMaxTokens = (currentCode: string) => Math.max(CREATE_MAX_TOKENS, Math.ceil(currentCode.length / 3 * 1.3));

const STALL_MS = 90_000;
const ATTEMPT_STALL_MS = 60_000;
const MAX_RUN_MS = 5 * 60_000;
const CHECK_MS = 10_000;
const MAX_RAW_CHARS = 2 * 1024 * 1024;
const MAX_JOBS_PER_USER = 2;

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobKind = 'create' | 'edit';
export type JobOutcome = 'done' | 'failed' | 'stopped';
export type RunOutcome = JobOutcome | 'none';
type StopReason = 'user' | 'timeout';

export interface GenerationJob {
    projectId: string;
    userId: string;
    kind: JobKind;
    versionDescription: string;
    raw: string;
    phase: 'thinking' | 'writing' | 'switching' | 'applying';
    runId: string;
    visibleStart: number | null;
    startedAt: number;
    lastProgressAt: number;
    abort: AbortController;
    /** Ends only the current model's try, for a stall. `abort` ends the whole run. */
    attemptAbort: AbortController | null;
    timer: NodeJS.Timeout | null;
    stopReason: StopReason | null;
    settled: boolean;
    creditsDeducted: boolean;
    /** The run used a plain CSS prompt (spec 0003), so Tailwind in its output is a slip. */
    plainCss?: boolean;
}

type ChatMessages = OpenAI.Chat.ChatCompletionMessageParam[];

export interface GenerationRequest {
    messages: ChatMessages;
    maxTokens: number;
    /** Section edits: send `reasoning: { enabled: false }`, unless this model must think. */
    thinkingOff?: boolean;
    /** Section edits: builds the full page from the reply, or returns null (spec 0011). */
    assemble?: (raw: string) => Promise<string | null>;
    /** Used for the remaining attempts after bad output. */
    fallback?: { messages: ChatMessages; maxTokens: number };
}

interface RepairLog {
    repairs: string[];
    failuresBefore: string[];
}

interface TokenUse {
    promptTokens: number | null;
    completionTokens: number | null;
}

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
        attemptAbort: null,
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

/** Atomic: one statement checks both limits, charges, and counts the start (spec 0014 AC-7). */
export async function deductCredits(job: GenerationJob): Promise<'charged' | ChargeRefusal> {
    const { count } = await prisma.user.updateMany({
        where: {
            id: job.userId,
            credits: { gte: GENERATION_COST },
            generationStartsToday: { lt: DAILY_START_LIMIT },
        },
        data: {
            credits: { decrement: GENERATION_COST },
            generationStartsToday: { increment: 1 },
        },
    });
    if (count > 0) {
        job.creditsDeducted = true;
        return 'charged';
    }
    const user = await prisma.user.findUnique({
        where: { id: job.userId },
        select: { credits: true, generationStartsToday: true },
    });
    return chargeRefusal(user) ?? 'no_credits';
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
function logDesignCheck(job: GenerationJob, code: string, previousCode: string, repairLog: RepairLog | null): void {
    try {
        if (usesTailwind(code)) return;
        const legacy = job.kind === 'edit' && directionFromHtml(previousCode) === null;
        const result = checkDesign(code, { kind: job.kind, legacy });
        console.info('[design-check]', JSON.stringify({ projectId: job.projectId, kind: job.kind, ...result, ...repairLog }));
    } catch (error) {
        console.error('[design-check] check failed to run', error);
    }
}

/**
 * The steps every saved create goes through, shared with the sample script (spec 0012).
 * The logo and repair steps can never stop a save and never cost a request or credits.
 */
export function prepareCreatedSite(generated: string): { code: string } & RepairLog {
    let code = generated;
    let repairs: string[] = [];
    let failuresBefore: string[] = [];
    // A new site's logo: the cleaned AI mark in every marker, or the monogram (spec 0008 AC-1, AC-4).
    try {
        code = withCreateLogo(code).html;
    } catch (error) {
        console.error('[logo] create logo step skipped:', error);
    }
    if (!usesTailwind(code)) {
        try {
            failuresBefore = checkDesign(code, { kind: 'create', legacy: false }).failures;
            const repaired = repairCreatedSite(code);
            code = repaired.html;
            repairs = repaired.repairs;
        } catch (error) {
            console.error('[repair] create repair step skipped:', error);
        }
    }
    return { code: withAnimationBlocks(code), repairs, failuresBefore };
}

/**
 * The single owner of every ending (AC-11). Claims the ending synchronously,
 * so a run can never both save a version and refund, or refund twice.
 */
export async function finalize(job: GenerationJob, outcome: JobOutcome, code?: string, failureMessage: string = FAILED): Promise<void> {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearInterval(job.timer);
    job.timer = null;
    if (jobs.get(job.projectId) === job) jobs.delete(job.projectId);

    if (outcome === 'done' && code) {
        let repairLog: RepairLog | null = null;
        if (job.kind === 'create') {
            const prepared = prepareCreatedSite(code);
            code = prepared.code;
            repairLog = { repairs: prepared.repairs, failuresBefore: prepared.failuresBefore };
        } else {
            // Exactly one copy of the preset sheet and scripts when the page uses presets (spec 0007 AC-6).
            code = withAnimationBlocks(code);
        }
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
            logDesignCheck(job, code, current?.current_code ?? '', repairLog);
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
                    content: outcome === 'stopped' ? STOPPED : failureMessage,
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

/** Streams one model into `job.raw` and returns its usable HTML, or throws. */
async function streamAttempt(job: GenerationJob, model: string, request: GenerationRequest, tokens: TokenUse): Promise<string> {
    const attemptAbort = new AbortController();
    job.attemptAbort = attemptAbort;
    const signal = AbortSignal.any([job.abort.signal, attemptAbort.signal]);

    const thinkingOff = request.thinkingOff === true && !requiresThinking(model);
    const stream = await openai.chat.completions.create({
        model,
        messages: request.messages,
        max_tokens: request.thinkingOff && !thinkingOff ? SCOPED_THINKING_MAX_TOKENS : request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        reasoning: thinkingOff ? { enabled: false } : { effort: 'low' },
        // Every retry spends a shared daily request, so the attempt loop owns them all.
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal, maxRetries: 0 });

    let finishReason: string | null = null;
    let thinkingChars = 0;
    for await (const chunk of stream) {
        const streamError = (chunk as { error?: { code?: unknown; message?: string } }).error;
        if (streamError) throw Object.assign(new Error(streamError.message ?? 'AI stream error'), { status: streamError.code });

        if (chunk.usage) {
            tokens.promptTokens = chunk.usage.prompt_tokens ?? null;
            tokens.completionTokens = chunk.usage.completion_tokens ?? null;
        }
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        const delta = chunk.choices[0]?.delta as OpenRouterDelta | undefined;
        if (!delta) continue;
        if (delta.reasoning || delta.reasoning_details) job.lastProgressAt = Date.now();
        thinkingChars += delta.reasoning?.length ?? 0;
        if (thinkingChars > MAX_THINKING_CHARS && !job.raw) throw new BadOutputError('AI spent the try thinking; nothing was saved.');

        const content = delta.content;
        if (!content) continue;
        job.lastProgressAt = Date.now();
        job.phase = request.assemble ? 'applying' : 'writing';
        const searchFrom = Math.max(0, job.raw.length - 16);
        job.raw += content;
        if (job.raw.length > MAX_RAW_CHARS) {
            throw new Error('AI output exceeded the 2 MB limit');
        }
        if (job.visibleStart === null && !request.assemble) {
            const found = job.raw.slice(searchFrom).search(/<!doctype|<html/i);
            if (found !== -1) job.visibleStart = searchFrom + found;
        }
    }

    // The SDK ends the loop quietly on an abort, so a stall or stop must be caught here.
    if (signal.aborted) throw new Error('Aborted');

    // A reply cut off by the output limit is never saved, even when it looks like HTML.
    if (finishReason === 'length') throw new BadOutputError('AI reply was cut off; nothing was saved.');

    const code = request.assemble ? await request.assemble(job.raw) : extractHtmlCode(job.raw);
    if (!code) throw new BadOutputError('AI returned empty or invalid HTML; nothing was saved.');
    return code;
}

/** A model that refuses to run with thinking off gets one immediate retry with it on (AC-14). */
async function streamWithThinkingRetry(job: GenerationJob, model: string, request: GenerationRequest, tokens: TokenUse): Promise<string> {
    try {
        return await streamAttempt(job, model, request, tokens);
    } catch (error) {
        if (!request.thinkingOff || requiresThinking(model) || !isThinkingRequiredError(error)) throw error;
        markRequiresThinking(model);
        return streamAttempt(job, model, request, tokens);
    }
}

/** A new `runId` makes the builder and the progress route restart the preview from nothing. */
function beginRetry(job: GenerationJob, markerId: string, attempt: number): void {
    job.raw = '';
    job.visibleStart = null;
    job.lastProgressAt = Date.now();
    job.phase = 'switching';
    job.runId = `${markerId}:${attempt}`;
}

function logAttempt(job: GenerationJob, attempt: number, model: string, result: string, startedAt: number, status: number | null, tokens: TokenUse): void {
    console.info('[ai-attempt]', JSON.stringify({ projectId: job.projectId, attempt, model, result, ms: Date.now() - startedAt, status, ...tokens }));
}

/** The message that ends the run for this failure, or null to move on to the next model. */
function endingMessage(failure: AttemptFailure, error: unknown, status: number | null): string | null {
    if (failure === 'minute_limit') return FAILED_MINUTE_LIMIT;
    if (failure === 'day_limit') {
        markDailyLimit(error);
        return FAILED_DAILY_LIMIT;
    }
    if (failure === 'auth') {
        console.error('[ai-attempt] key or account problem:', status, failureCause(error));
        return FAILED;
    }
    return null;
}

/**
 * Tries up to three free models (spec 0010) and ends through `finalize`, so one
 * charge covers every attempt. `buildMessages` runs inside the job, after the
 * response was sent, so slow work like URL reference fetching never blocks it.
 */
export async function runGenerationJob(
    job: GenerationJob,
    buildRequest: () => Promise<GenerationRequest>
): Promise<void> {
    try {
        assertAiKeyConfigured();
        let request = await buildRequest();
        if (request.assemble) job.phase = 'applying';
        if (job.abort.signal.aborted) throw new Error('Aborted before the request was sent');

        job.startedAt = Date.now();
        job.lastProgressAt = job.startedAt;
        job.timer = setInterval(() => {
            const now = Date.now();
            if (now - job.startedAt > MAX_RUN_MS) {
                job.stopReason ??= 'timeout';
                job.abort.abort();
            } else if (now - job.lastProgressAt > ATTEMPT_STALL_MS) {
                job.attemptAbort?.abort();
            }
        }, CHECK_MS);

        const markerId = job.runId;
        let code: string | null = null;
        let failureMessage = FAILED;

        for (const [index, model] of pickModels().entries()) {
            const attempt = index + 1;
            if (attempt > 1) beginRetry(job, markerId, attempt);
            const attemptStartedAt = Date.now();
            const tokens: TokenUse = { promptTokens: null, completionTokens: null };
            try {
                code = await streamWithThinkingRetry(job, model, request, tokens);
                logAttempt(job, attempt, model, 'ok', attemptStartedAt, null, tokens);
                break;
            } catch (error) {
                if (job.abort.signal.aborted) throw error;
                const { failure, status } = classifyFailure(error);
                logAttempt(job, attempt, model, job.attemptAbort?.signal.aborted ? 'stall' : failure, attemptStartedAt, status, tokens);
                recordFailure(model, failure);
                // A bad section reply says the section approach failed, so the rest are full page edits.
                if (failure === 'bad_output' && request.fallback) request = request.fallback;
                const ending = endingMessage(failure, error, status);
                if (ending) {
                    failureMessage = ending;
                    break;
                }
            }
        }

        // No await between this check and finalize claiming the ending.
        if (job.abort.signal.aborted) throw new Error('Aborted');
        if (code) await finalize(job, 'done', code);
        else await finalize(job, 'failed', undefined, failureMessage);
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
