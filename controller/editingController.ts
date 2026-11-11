import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import { htmlToPageData, componentsToHtml, toPages } from '../lib/htmlToSchema.js';
import { cleanPageNodes, mergeSiteStyles } from '../lib/siteStyles.js';

/** Rebuild from HTML only when there are no pages yet, so saved pages and `globalStyles` survive (spec 0003 AC-10). */
const hasNoPages = (pageData: any) => toPages(pageData).every(p => !p.components?.length);
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

    // Auto-convert projects that have HTML but no pages yet
    if (hasNoPages(pageData) && (project as any).current_code) {
      pageData = htmlToPageData((project as any).current_code);
      await prisma.websiteProject.update({
        where: { id: project.id },
        data: { pageData: JSON.stringify(pageData) } as any
      });
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
      const project = await prisma.websiteProject.findFirst({ where: { id: String(projectId ?? ''), userId: userid } });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      let stored: any = {};
      try { stored = JSON.parse((project as any).pageData || '{}'); } catch { stored = {}; }
      // Pages publish as one document; a legacy { components } body maps to one page.
      if (stored.globalStyles?.importFailed) return res.status(409).json({ error: 'not_editable' });
      const pages = cleanPageNodes(toPages(pageData));
      const globalStyles = mergeSiteStyles(stored.globalStyles, pageData?.globalStyles);
      data.pageData = JSON.stringify({ pages, globalStyles });
      data.current_code = componentsToHtml(pages, globalStyles);
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

    // Auto-convert published projects that have HTML but no pages yet
    if (hasNoPages(pageData) && (project as any).current_code) {
      pageData = htmlToPageData((project as any).current_code);
    }

    res.json({ project: { id: project.id, name: project.name, pageData } });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
