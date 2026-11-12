import { fromNodeHeaders } from 'better-auth/node';
import { type Request, type Response, type NextFunction } from 'express';
import { getAuth } from '../lib/auth.js';

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const auth = getAuth();
        if (!auth) {
            return res.status(503).json({ error: 'Auth not configured' });
        }

        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        if (!session?.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        req.userId = session.user.id;
        next();
    } catch (error: any) {
        console.error('Authentication error:', error);
        res.status(401).json({ error: 'Please sign in to continue.' }); // spec 0033 AC-6: no internals
    }
};

/** Like `protect`, but never refuses: sets `req.userId` when a session exists, so a public route can recognise the owner. */
export const identify = async (req: Request, _res: Response, next: NextFunction) => {
    try {
        const session = await getAuth()?.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (session?.user) req.userId = session.user.id;
    } catch {
        // No usable session: carry on as an anonymous visitor.
    }
    next();
};
