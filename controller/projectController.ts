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
        const { message } = req.body

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

        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'z-ai/glm-4.5-air:free',
            messages: [
                {
                    role: 'system',
                    content: `You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.

Enhance this by:
1. Being specific about what elements to change
2. Mentioning design details (colors, spacing, sizes)
3. Clarifying the desired outcome
4. Using clear technical terms

Return ONLY the enhanced request, nothing else. Keep it concise (1-2 sentences).`
                },
                {
                    role: 'user',
                    content: 'User Request: "${message}"',
                },
            ],
        });

        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'I have enhanced the user prompt "${enhancedPrompt}" ',
                projectId
            },
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now making Changes to your website...',
                projectId
            },
        });

        // Generate Website code
        const codeGenerationResponse = await openai.chat.completions.create({
            model: 'z-ai/glm-4.5-air:free',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert web developer.

CRITICAL REQUIREMENTS:
- Return ONLY the complete updated HTML code with the requested changes.
- Use Tailwind CSS for ALL styling (NO custom CSS).
- Use Tailwind utility classes for all styling changes.
- Include all JavaScript in <script> tags before closing </body>
- Make sure it's a complete, standalone HTML document with Tailwind CSS
- Return the HTML Code Only, nothing else

Apply the requested changes while maintaining the Tailwind CSS styling approach.`
                },
                {
                    role: 'user',
                    content: 'Here is your current website "${currentProject.current_code}" and here is the enhanced user request "${enhancedPrompt}". Made the necessary changes to the website based on the enhanced request. ',
                },
            ],
        });

        const code = codeGenerationResponse.choices[0].message.content || '';

        const version = await prisma.version.create({
            data: {
                code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                description: 'changes made',
                projectId
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've made the changes to your website! You can now preview it",
                projectId
            }
        })

        await prisma.project.update({
            where: { id: projectId },
            data: {
                current_code: code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim(),
                current_version_id: version.id
            }
        });


        res.json({ message: 'Revision made successfully', versionId: version.id });
    } catch (error: any) {
        await prisma.user.update({
            where: { id: userid },
            data: { credit: { decrement: 5 } },
        });
        console.error('Get credit error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

// controller function to rollbakc to previous version

export const rollbackToVersion = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { projectId, versionId } = req.params;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userid },
            include: { versions: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const version = await prisma.versions.find((versions) => versions.id === versionId);
        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectId, userid },
            data: { current_code: version.code, current_version_index: version.id }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've rolled back your website to the selected version. You can now preview it.`,
                projectId
            }
        });

        res.json({ message: 'Rollback successful' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

} 

// controller function to delete project

export const deleteProject = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId, versionId } = req.params;

       await prisma.websiteproject.delete({
            where: { id: projectId, userid },
        });

        res.json({ message: 'Project deleted successfully' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

} 

// Controller for getting project code for preview

export const getProjectPreview = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId, versionId } = req.params;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectId, userid },
            include: { versions: true },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({project});
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

}

// Controller for getting published projects

export const getPublishedProjects = async (req: Request, res: Response) => {
    try {


        const projects = await prisma.websiteProject.findMany({
            where: { ispublished: true },
            include: { user : true },
        });

        res.json({projects});
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

}

// get a single project by id

export const getProjectById = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;

        const project = await prisma.websiteProject.findFirst({
            where: { id: projectId },
        });

        if (!project || project.ispublished === false || project.current_code ) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ code: project.current_code });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

}
//  Controller to save project 

export const saveProjectCode = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        const { projectId } = req.params;
        const { code } = req.body;
        
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userid },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        
        }

        await prisma.websiteProject.update({
            where: { id: projectId, userid },
            data: {current_code: code, current_version_index: ''}
        });

        
        res.json({ message: 'Project code saved successfully' });
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message});
    }

}