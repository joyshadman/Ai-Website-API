import prisma from './prisma.js';

// Daily free credit refill (spec 0014).

export const GENERATION_COST = 5;
export const REFILL_TO = 20;
export const DAILY_START_LIMIT = 10;

export const CHARGE_REFUSALS = {
    no_credits: {
        status: 403,
        error: 'Not enough credits. Your credits refill at midnight UTC.',
    },
    start_limit: {
        status: 429,
        error: `You have reached today's limit of ${DAILY_START_LIMIT} generations. It resets at midnight UTC.`,
    },
} as const;

export type ChargeRefusal = keyof typeof CHARGE_REFUSALS;

/** Why this user can't start a generation right now, or null when they can. */
export function chargeRefusal(
    user: { credits: number; generationStartsToday: number } | null
): ChargeRefusal | null {
    if (!user || user.credits < GENERATION_COST) return 'no_credits';
    if (user.generationStartsToday >= DAILY_START_LIMIT) return 'start_limit';
    return null;
}

/**
 * Tops the balance up to the ceiling, at most once per UTC day. One statement, so two requests
 * arriving together refill once, and the day is stamped even when the balance is already full.
 */
export async function refillCredits(userId: string): Promise<void> {
    const changed = await prisma.$executeRaw`
        UPDATE "user"
        SET credits = GREATEST(credits, ${REFILL_TO}), "generationStartsToday" = 0,
            "creditsRefilledOn" = (now() at time zone 'utc')::date
        WHERE id = ${userId} AND "creditsRefilledOn" < (now() at time zone 'utc')::date
    `;
    if (changed > 0) console.info('[credit-refill]', JSON.stringify({ userId }));
}

/** Milliseconds from now to the next midnight UTC. */
export function msUntilNextRefill(now = new Date()): number {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}
