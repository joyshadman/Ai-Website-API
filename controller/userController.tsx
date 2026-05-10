import openai from 'config/openai.js';
import { Request, Response } from 'express';
import prisma from 'lib/prisma.js';

export const getUserCredit = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma.user.findUnique({
            where: { id: userid },
        });
        res.json({ credit: user?.credit || 0 });
    } catch (error: any) {
        console.error('Authentication error:', error);
        res.status(401).json({ message: error.code || error.message });
    }
}

export const createProject = async (req: Request, res: Response) => {
    try {
        const { initial_prompt } = req.body;
        const userid = req.userId;

        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userid },
        });

        if (!user || user.credit < 5) {
            return res.status(403).json({ error: 'Insufficient credit' });
        }

        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 20 ? initial_prompt.substring(0, 47) + '...' : initial_prompt,
                initial_prompt,
                userId: userid
            }
        });

        await prisma.user.update({
            where: { id: userid },
            data: { totalcreation: { increment: 1 } },
        });

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt,
                projectId: project.id
            }
        });

        await prisma.user.update({
            where: { id: userid },
            data: { credit: { decrement: 5 } },
        });

        // enhance user prompt
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'z-ai/glm-4.5-air:free',
            messages: [
                {
                    role: 'system',
                    content: `You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.

Enhance this prompt by:
1. Adding specific design details (layout, color scheme, typography)
2. Specifying key sections and features
3. Describing the user experience and interactions
4. Including modern web design best practices
5. Mentioning responsive design requirements
6. Adding any missing but important elements

Return ONLY the enhanced prompt, nothing else. Make it detailed but concise (2-3 paragraphs max).`,
                },
                {
                    role: 'user',
                    content: initial_prompt,
                }
            ]
        });

        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I enhanced the prompt to: ${enhancedPrompt}`,
                projectId: project.id
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `now generating the website...`,
                projectId: project.id
            }
        });

        // generate website code
        const codeGenerationResponse = await openai.chat.completions.create({
            model: 'z-ai/glm-4.5-air:free',
            messages: [{
                role: 'system',
                content: `You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"

    CRITICAL REQUIREMENTS:
    - You MUST output valid HTML ONLY. 
    - Use Tailwind CSS for ALL styling
    - Include this EXACT script in the <head>: <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    - Use Tailwind utility classes extensively for styling, animations, and responsiveness
    - Make it fully functional and interactive with JavaScript in <script> tag before closing </body>
    - Use modern, beautiful design with great UX using Tailwind classes
    - Make it responsive using Tailwind responsive classes (sm:, md:, lg:, xl:)
    - Use Tailwind animations and transitions (animate-*, transition-*)
    - Include all necessary meta tags
    - Use Google Fonts CDN if needed for custom fonts
    - Use placeholder images from https://placehold.co/600x400
    - Use Tailwind gradient classes for beautiful backgrounds
    - Make sure all buttons, cards, and components use Tailwind styling

    CRITICAL HARD RULES:
    1. You MUST put ALL output ONLY into message.content.
    2. You MUST NOT place anything in "reasoning", "analysis", "reasoning_details", or any hidden fields.
    3. You MUST NOT include internal thoughts, explanations, analysis, comments, or markdown.
    4. Do NOT include markdown, explanations, notes, or code fences.

    The HTML should be complete and ready to render as-is with Tailwind CSS.`
            }, {
                role: 'user',
                content: enhancedPrompt || ''
            }]
        });

        const cleanCode = (code: string) => code
            .replace(/```[a-z]*\n?/gi, '')
            .replace(/```$/g, '')
            .trim();

        const code = codeGenerationResponse.choices[0].message.content || '';

        const version = await prisma.projectVersion.create({
            data: {
                code: cleanCode(code),
                description: 'Initial version',
                projectId: project.id
            }
        });

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I generated the website! You can now preview it and if you want any changes just ask me.`,
                projectId: project.id
            }
        });

        await prisma.websiteProject.update({
            where: { id: project.id },
            data: {
                current_code: cleanCode(code),
                current_version: version.id
            }
        });

        res.json({ projectId: project.id });

    } catch (error: any) {
        await prisma.user.update({
            where: { id: req.userId },
            data: { credit: { increment: 5 } },
        });

        console.error('Project creation error:', error);
        res.status(500).json({ message: error.code || error.message });
    }
}

// controller for getting user projects

export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userid = req.userId;
        if (!userid) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma.user.findUnique({
            where: { id: userid },
        });
        res.json({ credit: user?.credit || 0 });
    } catch (error: any) {
        console.error('Authentication error:', error);
        res.status(401).json({ message: error.code || error.message });
    }
}