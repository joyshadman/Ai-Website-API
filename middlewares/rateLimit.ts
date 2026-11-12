import type { NextFunction, Request, Response } from 'express';

/*
 * Fixed window rate limiting in this process's memory (spec 0033 AC-4). The API runs as a single
 * instance by design (lib/generationJobs.ts keeps runs in memory too), so no shared store is needed.
 * Keyed by the signed in user when `protect` already ran, else by client IP (needs `trust proxy`).
 */

type Bucket = { count: number; resetAt: number };
const MESSAGE = 'Too many requests. Wait a minute and try again.';

export function rateLimit(name: string, max: number, windowMs = 60_000, by: 'user' | 'ip' = 'user') {
    const buckets = new Map<string, Bucket>();
    // Drop expired buckets now and then, so memory stays bounded.
    setInterval(() => {
        const now = Date.now();
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }, windowMs).unref();

    return (req: Request, res: Response, next: NextFunction) => {
        const who = by === 'user' && req.userId ? `u:${req.userId}` : `ip:${req.ip ?? 'unknown'}`;
        const now = Date.now();
        let bucket = buckets.get(who);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(who, bucket);
        }
        bucket.count += 1;
        if (bucket.count > max) {
            res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
            console.warn(`[rate limit] ${name} ${who.startsWith('u:') ? 'user' : 'ip'} over ${max}/${windowMs / 1000}s`);
            return void res.status(429).json({ error: MESSAGE });
        }
        next();
    };
}

/** The limits from spec 0033 AC-4, shared so the same bucket covers related routes. */
export const limits = {
    all: rateLimit('all', 300, 60_000, 'ip'),
    generate: rateLimit('generate', 6),
    save: rateLimit('save', 60),
    publish: rateLimit('publish', 20),
    publicRead: rateLimit('public', 120, 60_000, 'ip'),
};
