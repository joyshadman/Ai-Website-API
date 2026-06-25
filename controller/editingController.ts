import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';

const PAID_TOOLS: Record<string, number> = {
    'multipage-layout': 5,
    'premium-gallery-grid': 4,
    'glassmorphism-hero-section': 3,
    'interactive-contact-form': 3,
    'iframe-youtube': 3,
    'iframe-custom': 4,
    'custom-link-button': 3,
    'dynamic-form-page': 5
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const getAvailableTools = async (req: Request, res: Response) => {
    try {
        res.json({
            freeTools: [
                'container-div',
                'flex-box',
                'grid-layout',
                'typography-text',
                'image-holder',
                'action-button',
                'navigation-bar',
                'footer-block'
            ],
            paidTools: PAID_TOOLS
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const applyEditingTool = async (req: Request, res: Response) => {
    const userid = req.userId;
    const { projectId } = req.params;
    const { toolName, updatedCode, pageId = "index" } = req.body;

    if (!userid) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!toolName || !updatedCode) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const projectIdStr = String(projectId ?? '');
    const creditCost = toolName in PAID_TOOLS ? (PAID_TOOLS[toolName] ?? 0) : 0;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userid },
            select: { credits: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.credits < creditCost) {
            return res.status(403).json({ error: 'Insufficient credits' });
        }

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectIdStr, userId: userid }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (creditCost > 0) {
            await prisma.user.update({
                where: { id: userid },
                data: { credits: { decrement: creditCost } }
            });
        }

        const cleanCode = updatedCode
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        const version = await prisma.version.create({
            data: {
                code: cleanCode,
                description: `Drag and Drop Update: ${toolName} on page ${pageId}`,
                projectId: projectIdStr
            }
        });

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: cleanCode,
                current_version_index: version.id
            }
        });

        const updatedUser = await prisma.user.findUnique({
            where: { id: userid },
            select: { credits: true }
        });

        res.json({
            message: `Tool ${toolName} applied successfully to page ${pageId}`,
            versionId: version.id,
            remainingCredits: updatedUser?.credits ?? 0,
            cost: creditCost
        });

    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to apply editing tool' });
    }
};

export const uploadProjectImage = async (req: Request, res: Response) => {
    const userid = req.userId;
    const { projectId } = req.params;
    const { imageData, mimeType } = req.body;

    if (!userid) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!imageData) {
        return res.status(400).json({ error: 'Missing image data' });
    }

    const approximateBytes = Math.floor((imageData.length * 3) / 4);
    if (approximateBytes > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'File size exceeds the 10MB limit' });
    }

    const projectIdStr = String(projectId ?? '');

    try {
        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({
            message: 'Image verified and uploaded successfully',
            url: `data:${mimeType || 'image/png'};base64,${imageData.replace(/^data:image\/[a-z]+;base64,/, '')}`
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to process image upload' });
    }
};

export const deleteCanvasElement = async (req: Request, res: Response) => {
    const userid = req.userId;
    const { projectId } = req.params;
    const { updatedCode, elementId, pageId = "index" } = req.body;

    if (!userid) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!updatedCode) {
        return res.status(400).json({ error: 'Missing layout configuration payload' });
    }

    const projectIdStr = String(projectId ?? '');

    try {
        const project = await prisma.websiteProject.findFirst({
            where: { id: projectIdStr, userId: userid }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const cleanCode = updatedCode
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        const version = await prisma.version.create({
            data: {
                code: cleanCode,
                description: `Deleted element ${elementId || ''} from page ${pageId}`,
                projectId: projectIdStr
            }
        });

        await prisma.websiteProject.update({
            where: { id: projectIdStr },
            data: {
                current_code: cleanCode,
                current_version_index: version.id
            }
        });

        res.json({
            message: 'Element successfully removed from layout canvas',
            versionId: version.id
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to execute structural component removal' });
    }
};