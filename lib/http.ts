import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { reportServerError } from './monitoring.js';

/*
 * Request checking and safe errors for every route (spec 0033).
 */

export const SERVER_ERROR = 'Something went wrong on our side. Try again.';

/** A 500 that logs the real error on the server and never sends its details (AC-6). */
export function serverError(res: Response, error: unknown, context: string) {
    console.error(`[${context}]`, error);
    const req = res.req as Request | undefined;
    reportServerError(error, { where: context, route: req?.route?.path ? `${req.method} ${req.baseUrl}${req.route.path}` : req?.method ?? '', userId: req?.userId });
    if (!res.headersSent) res.status(500).json({ error: SERVER_ERROR });
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ID_PARAMS = ['id', 'projectId', 'websiteId', 'versionId', 'assetId', 'conversationId'] as const;

/** Every id route parameter must look like an id (AC-1). */
export function checkIdParams(router: Router) {
    for (const name of ID_PARAMS) {
        router.param(name, (_req: Request, res: Response, next: NextFunction, value: string) => {
            if (typeof value === 'string' && ID.test(value)) return next();
            res.status(400).json({ error: "That id isn't valid." });
        });
    }
}

/** Validates `req.body` against a schema; the first problem becomes a plain 400 (AC-2). */
export function validate(schema: z.ZodType): RequestHandler {
    return (req, res, next) => {
        const result = schema.safeParse(req.body ?? {});
        if (result.success) return next();
        const issue = result.error.issues[0];
        const field = issue?.path.join('.') || 'request';
        res.status(400).json({ error: `The ${field} field isn't valid: ${issue?.message ?? 'check the value'}.` });
    };
}

const text = (min: number, max: number) => z.string().trim().min(min, `it must have at least ${min} character${min === 1 ? '' : 's'}`).max(max, `it must be at most ${max} characters`);

/** Body schemas per route (AC-2). Unknown keys pass through; only the named fields are checked. */
export const schemas = {
    createProject: z.object({ initial_prompt: text(1, 2000) }),
    message: z.object({ message: text(1, 2000) }),
    save: z.object({
        name: z.string().max(100, 'it must be at most 100 characters').optional(),
        pageData: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string()]).optional(),
        globalStyles: z.record(z.string(), z.unknown()).optional(),
    }),
    code: z.object({ code: z.string().max(1_500_000, 'it must be at most 1,500,000 characters') }),
    publish: z.object({ published: z.boolean().optional() }),
    alt: z.object({ alt: z.string().max(300, 'it must be at most 300 characters') }),
};

/** The final error handler: malformed JSON and oversized bodies get clear 4xx, anything else a safe 500 (AC-3, AC-6). */
export function finalErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') return void res.status(400).json({ error: "That request isn't valid JSON." });
    if (e?.type === 'entity.too.large' || e?.status === 413) return void res.status(413).json({ error: 'That request is too large.' });
    serverError(res, err, 'unhandled');
}
