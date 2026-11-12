import { createRequire } from 'node:module';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, getIP } from 'better-auth/api';
import prisma from './prisma.js';

// Checks on new accounts (spec 0014). They apply only when an account is being created, so
// existing accounts keep working whatever their address looks like (AC-10).

const DUPLICATE_MESSAGE = 'An account already exists for this email address. Please sign in with the address you first used.';
const THROWAWAY_MESSAGE = 'Please use a permanent email address.';
const TOO_MANY_MESSAGE = 'Too many new accounts from this network today. Please try again tomorrow.';

const MAX_NEW_ACCOUNTS_PER_IP = 3;

// The package's entry point is a JSON file, which an ES module can't import by bare name.
const throwawayDomains = new Set(createRequire(import.meta.url)('disposable-email-domains') as string[]);

type HookContext = {
    request?: Request | undefined;
    headers?: Headers | undefined;
    context: { options: BetterAuthOptions };
} | null | undefined;

/** Keep the rules in step with the backfill in the `daily_credit_refill` migration. */
export function normalizeEmail(email: string): string {
    const cleaned = email.trim().toLowerCase();
    const at = cleaned.lastIndexOf('@');
    const domain = cleaned.slice(at + 1);
    const localPart = cleaned.slice(0, Math.max(at, 0)).replace(/\+.*$/, '');
    return domain === 'gmail.com' || domain === 'googlemail.com'
        ? `${localPart.replaceAll('.', '')}@gmail.com`
        : `${localPart}@${domain}`;
}

function refuse(message: string): APIError {
    return new APIError('BAD_REQUEST', { message });
}

function assertNotThrowaway(email: string): void {
    const domain = email.trim().toLowerCase().split('@').pop() ?? '';
    if (throwawayDomains.has(domain)) throw refuse(THROWAWAY_MESSAGE);
}

async function assertNotDuplicate(normalizedEmail: string): Promise<void> {
    const existing = await prisma.user.findUnique({ where: { normalizedEmail }, select: { id: true } });
    if (existing) throw refuse(DUPLICATE_MESSAGE);
}

// New accounts per IP today. In memory on purpose: IP addresses are never stored, and losing the
// count on a restart only lets a few extra accounts through.
const newAccountsByIp = new Map<string, number>();
let countedDay = '';

function ipCounts(): Map<string, number> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== countedDay) {
        newAccountsByIp.clear();
        countedDay = today;
    }
    return newAccountsByIp;
}

function ipFrom(ctx: HookContext): string | null {
    const source = ctx?.request ?? ctx?.headers;
    return ctx && source ? getIP(source, ctx.context.options) : null;
}

/** Runs before an email code goes out, so a refused address is never emailed one. */
export async function checkBeforeCode(body: unknown): Promise<void> {
    const { email, type } = (body ?? {}) as { email?: unknown; type?: unknown };
    if (type !== 'sign-in' || typeof email !== 'string') return;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
    if (existing) return;

    assertNotThrowaway(email);
    await assertNotDuplicate(normalizeEmail(email));
}

/** Runs for every new account on both sign in paths, and fills in the cleaned up email. */
export async function checkNewUser<T extends { email: string }>(
    user: T,
    ctx: HookContext
): Promise<T & { normalizedEmail: string }> {
    assertNotThrowaway(user.email);
    const normalizedEmail = normalizeEmail(user.email);
    await assertNotDuplicate(normalizedEmail);

    const ip = ipFrom(ctx);
    if (ip && (ipCounts().get(ip) ?? 0) >= MAX_NEW_ACCOUNTS_PER_IP) throw refuse(TOO_MANY_MESSAGE);

    return { ...user, normalizedEmail };
}

/** Runs after the insert, so only an account actually created counts. */
export function countNewUser(ctx: HookContext): void {
    const ip = ipFrom(ctx);
    if (!ip) return;
    const counts = ipCounts();
    counts.set(ip, (counts.get(ip) ?? 0) + 1);
}

function isDuplicateNormalizedEmail(error: unknown): boolean {
    const { code, meta } = error as { code?: unknown; meta?: unknown };
    return code === 'P2002' && JSON.stringify(meta ?? {}).includes('normalizedEmail');
}

/** The client Better Auth uses: two signups at once get the duplicate message, not a server error. */
export const authPrisma = prisma.$extends({
    query: {
        user: {
            async create({ args, query }) {
                try {
                    return await query(args);
                } catch (error) {
                    if (isDuplicateNormalizedEmail(error)) throw refuse(DUPLICATE_MESSAGE);
                    throw error;
                }
            },
        },
    },
});
