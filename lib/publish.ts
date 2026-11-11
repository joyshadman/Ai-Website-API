import type { Request, Response } from 'express';
import prisma from './prisma.js';

/**
 * The one publish action (spec 0016). The live site is always the latest saved `current_code`,
 * so publishing only flips visibility. `{ published: boolean }` sets it; no body toggles (older clients).
 */
export const setPublished = async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.projectId ?? '');
    try {
        const project = await prisma.websiteProject.findFirst({ where: { id, userId } });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const wanted = typeof req.body?.published === 'boolean' ? req.body.published : !project.isPublished;
        if (wanted && !project.current_code) {
            return res.status(409).json({ error: 'Generate your site before publishing it.' });
        }
        const updated = wanted === project.isPublished
            ? project
            : await prisma.websiteProject.update({ where: { id }, data: { isPublished: wanted } });

        res.json({
            isPublished: updated.isPublished,
            url: `/preview/${id}`,
            message: updated.isPublished ? 'Your site is live' : 'Your site is unpublished',
        });
    } catch (error: any) {
        console.error('Publish error:', error);
        res.status(500).json({ error: 'Publishing failed. Try again.' });
    }
};
