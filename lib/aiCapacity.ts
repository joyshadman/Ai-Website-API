import { AI_MODELS, MAX_ATTEMPTS } from '../config/aiModels.js';

/**
 * Which free models to try, and what a failed try means (spec 0010). Cooldowns and the daily
 * limit live in memory, like the job registry: a restart forgets them and the next request
 * simply learns them again.
 */

export type AttemptFailure = 'upstream' | 'not_found' | 'bad_output' | 'minute_limit' | 'day_limit' | 'auth';

export const DAILY_LIMIT_MESSAGE = 'Free AI is at capacity today. Please try again after the daily reset.';

const UPSTREAM_COOLDOWN_MS = 60_000;
const NOT_FOUND_COOLDOWN_MS = 60 * 60_000;
const MAX_RESET_AHEAD_MS = 48 * 60 * 60_000;

const cooldowns = new Map<string, number>();
const mustThinkModels = new Set<string>();
let dailyLimitUntil = 0;

/** A reply with no usable HTML: usually that prompt's fault, so the model gets no cooldown. */
export class BadOutputError extends Error {}

interface ProviderError {
    status?: unknown;
    message?: unknown;
    headers?: { get?: (name: string) => string | null };
    error?: { code?: unknown; message?: unknown; metadata?: { headers?: Record<string, unknown> } };
}

const describe = (error: ProviderError): string =>
    `${String(error.message ?? '')} ${String(error.error?.message ?? '')}`;

/** Models for one generation, skipping those cooling down unless that leaves none. */
export function pickModels(now = Date.now()): string[] {
    const ready = AI_MODELS.filter(model => (cooldowns.get(model) ?? 0) <= now);
    return (ready.length > 0 ? ready : [...AI_MODELS]).slice(0, MAX_ATTEMPTS);
}

export function classifyFailure(error: unknown): { failure: AttemptFailure; status: number | null } {
    if (error instanceof BadOutputError) return { failure: 'bad_output', status: null };

    const provider = (error ?? {}) as ProviderError;
    const rawStatus = Number(provider.status ?? provider.error?.code);
    const status = Number.isInteger(rawStatus) ? rawStatus : null;
    const text = describe(provider);

    if (/free-models-per-day/i.test(text)) return { failure: 'day_limit', status };
    if (/free-models-per-min/i.test(text)) return { failure: 'minute_limit', status };
    if (status === 401 || status === 402 || status === 403) return { failure: 'auth', status };
    if (status === 404) return { failure: 'not_found', status };
    return { failure: 'upstream', status };
}

export function recordFailure(model: string, failure: AttemptFailure, now = Date.now()): void {
    if (failure === 'upstream') cooldowns.set(model, now + UPSTREAM_COOLDOWN_MS);
    else if (failure === 'not_found') cooldowns.set(model, now + NOT_FOUND_COOLDOWN_MS);
}

/** A model refused a thinking off request (spec 0011 AC-14). */
export function isThinkingRequiredError(error: unknown): boolean {
    return /reasoning is mandatory/i.test(describe((error ?? {}) as ProviderError));
}

/** Learned from refusals, so later section edits start with thinking on for this model. */
export const requiresThinking = (model: string): boolean => mustThinkModels.has(model);
export const markRequiresThinking = (model: string): void => { mustThinkModels.add(model); };

/** Short provider text for the logs. It never contains the prompt or the key. */
export function failureCause(error: unknown): string {
    return describe((error ?? {}) as ProviderError).trim().slice(0, 300);
}

function nextUtcMidnight(now: number): number {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** Remembers the account's daily limit until the provider's reset time, else the next 00:00 UTC. */
export function markDailyLimit(error: unknown, now = Date.now()): void {
    const provider = (error ?? {}) as ProviderError;
    const reset = Number(provider.headers?.get?.('x-ratelimit-reset') ?? provider.error?.metadata?.headers?.['X-RateLimit-Reset']);
    const usable = Number.isFinite(reset) && reset > now && reset <= now + MAX_RESET_AHEAD_MS;
    dailyLimitUntil = usable ? reset : nextUtcMidnight(now);
}

export function isAtDailyLimit(now = Date.now()): boolean {
    return dailyLimitUntil > now;
}
