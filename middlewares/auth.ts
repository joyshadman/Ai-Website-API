import { fromNodeHeaders } from 'better-auth/node';
import { Request, Response, NextFunction } from 'express';

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await req.api.getSession({
            Headers: fromNodeHeaders(req.headers),
        });
        if (!session || !session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.userId = session.userId;

        next();
    } catch (error: any) {
        console.error('Authentication error:', error);
        res.status(401).json({ message: error.code || error.message });
    }
}       