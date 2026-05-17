import { fromNodeHeaders } from 'better-auth/node';
import express, { type Request, type Response, type NextFunction } from 'express';
import { auth } from '../lib/auth.ts';

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
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
        res.status(401).json({ message: error.code || error.message });
    }
}       