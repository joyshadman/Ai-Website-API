import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import { htmlToComponents, componentsToHtml } from '../lib/htmlToSchema.js';
export const getAvailableTools = async (_req: Request, res: Response) => {
  try {
    res.json({
      freeTools: [
        'container-div', 'flex-box', 'grid-layout',
        'typography-text', 'image-holder', 'action-button',
        'navigation-bar', 'footer-block'
      ],
      paidTools: {
        'multipage-layout': 5,
        'premium-gallery-grid': 4,
        'glassmorphism-hero-section': 3,
        'interactive-contact-form': 3,
        'iframe-youtube': 3,
        'iframe-custom': 4,
        'custom-link-button': 3,
        'dynamic-form-page': 5
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getEditorPage = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userid = req.userId as string;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(projectId ?? ''), userId: userid },
      include: { versions: { orderBy: { timestamp: 'desc' }, take: 50 } }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    let pageData: any;
    try { pageData = JSON.parse((project as any).pageData || '{}'); } catch { pageData = {}; }

    // Auto-convert legacy projects: if pageData is empty but HTML exists, convert it
    if ((!pageData.components || pageData.components.length === 0) && (project as any).current_code) {
      const components = htmlToComponents((project as any).current_code);
      if (components.length > 0) {
        pageData = { components };
        await prisma.websiteProject.update({
          where: { id: project.id },
          data: { pageData: JSON.stringify(pageData) } as any
        });
      }
    }

    res.json({ project: { ...project, pageData } });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveEditorPage = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userid = req.userId as string;
  const { pageData, name } = req.body;
  try {
    const data: any = {};
    if (pageData !== undefined) {
      data.pageData = JSON.stringify(pageData);
      // Support multi-page format: flatten components from all pages
      if (pageData.pages && Array.isArray(pageData.pages)) {
        const allComponents = pageData.pages.flatMap((p: any) => p.components || []);
        data.current_code = componentsToHtml(allComponents);
      } else {
        const components = pageData.components || pageData;
        data.current_code = componentsToHtml(components);
      }
    }
    if (name !== undefined) data.name = name;
    const project = await prisma.websiteProject.update({
      where: { id: String(projectId ?? ''), userId: userid },
      data
    });
    res.json({ project });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const publishEditorPage = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const userid = req.userId as string;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(projectId ?? ''), userId: userid }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const updated = await prisma.websiteProject.update({
      where: { id: project.id },
      data: { isPublished: !project.isPublished }
    });
    res.json({ isPublished: updated.isPublished });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getEditorHistory = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const versions = await prisma.version.findMany({
      where: { projectId: String(projectId ?? '') },
      orderBy: { timestamp: 'desc' },
      take: 100
    });
    res.json({ versions });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getEditorPagePublic = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(projectId ?? ''), isPublished: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    let pageData: any;
    try { pageData = JSON.parse((project as any).pageData || '{}'); } catch { pageData = {}; }

    // Auto-convert legacy published projects
    if ((!pageData.components || pageData.components.length === 0) && (project as any).current_code) {
      const components = htmlToComponents((project as any).current_code);
      if (components.length > 0) {
        pageData = { components };
      }
    }

    res.json({ project: { id: project.id, name: project.name, pageData } });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
