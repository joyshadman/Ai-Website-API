import { Request, Response } from "express";
import prisma from 'lib/prisma.js';
import openai from 'config/openai.js';
import { versions } from "node:process";
import { role } from "better-auth/client";


// controller fucntion to make Revesion

export const makeRevision = async (req: Request, res: Response) => {
    const userid = req.userId;
    try {

        const { projectId } = req.params;
        const {message} = req.body

        const user = await prisma.user.findUnique({
            where: { id: userid },
        });

        if (!userid || !user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.credit < 5) {
            return res.status(403).json({ error: 'User cannot make a revision with insufficient credit ' });
        }

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Please provide a valid prompt.' });
        }
        
        const currentProject = await prisma.project.findUnique({
            where: { id: projectId, userId: userid },
            include: { versions: true },
        });

        if (!currentProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await prisma.conversation.create({
            data: {
                role: ' user',
                content: message,
                projectId
            },
        });

        await prisma.user.update({
            where: { id: userid },
            data: { credit: { decrement: 5 } },
        });

        // Enhance User prompt 

        res.json({ credit: user?.credit || 0 });
    } catch (error: any) {
        console.error('Get credit error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}