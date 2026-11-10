import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';
import { componentsToHtml, htmlToPageData, toPages } from '../lib/htmlToSchema.js';
import { cleanPageNodes, mergeSiteStyles } from '../lib/siteStyles.js';
import { deleteMediaKeys } from '../lib/media.js';

export const getWebsite = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.userId as string;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(id ?? ''), userId }
    });
    if (!project) return res.status(404).json({ error: 'Website not found' });

    let pageData: any = {};
    try { pageData = JSON.parse((project as any).pageData || '{}'); } catch { pageData = {}; }

    res.json({
      websiteId: project.id,
      name: project.name,
      pages: pageData.pages || [],
      globalStyles: pageData.globalStyles || {}
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateWebsite = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.userId as string;
  const { name, pageData, globalStyles } = req.body;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(id ?? ''), userId }
    });
    if (!project) return res.status(404).json({ error: 'Website not found' });

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (pageData !== undefined || globalStyles !== undefined) {
      let existing: any = {};
      try { existing = JSON.parse((project as any).pageData || '{}'); } catch {}

      // pageData may be a JSON string from frontend, or an object
      let parsedPageData = pageData;
      if (typeof pageData === 'string') {
        try { parsedPageData = JSON.parse(pageData); } catch { parsedPageData = pageData; }
      }

      // pageData can be either { pages: [...], globalStyles } or just the pages array
      const incomingPages = parsedPageData?.pages ?? (Array.isArray(parsedPageData) ? parsedPageData : undefined);
      const incomingGlobalStyles = parsedPageData?.globalStyles ?? globalStyles;

      // globalStyles merges by key and never loses `mode` or `css`, so an old
      // client posting `globalStyles: {}` changes nothing (spec 0003 AC-10).
      if (existing.globalStyles?.importFailed && incomingPages !== undefined) {
        return res.status(409).json({ error: 'not_editable' });
      }
      const merged = {
        pages: incomingPages !== undefined ? (Array.isArray(incomingPages) ? cleanPageNodes(incomingPages) : incomingPages) : (existing.pages || []),
        globalStyles: mergeSiteStyles(existing.globalStyles, incomingGlobalStyles)
      };
      data.pageData = JSON.stringify(merged);

      // Keep current_code in sync so Builder/Community previews reflect the
      // saved component tree (mirrors editingController.saveEditorPage).
      if (Array.isArray(merged.pages)) {
        data.current_code = componentsToHtml(toPages(merged), merged.globalStyles);
      }
    }

    const updated = await prisma.websiteProject.update({
      where: { id: project.id },
      data
    });

    let resultPageData: any = {};
    try { resultPageData = JSON.parse((updated as any).pageData || '{}'); } catch {}

    res.json({
      websiteId: updated.id,
      name: updated.name,
      pages: resultPageData.pages || [],
      globalStyles: resultPageData.globalStyles || {}
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteWebsite = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.userId as string;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(id ?? ''), userId }
    });
    if (!project) return res.status(404).json({ error: 'Website not found' });

    // Read the media keys first: the rows cascade away with the project (spec 0006 AC-9).
    const assets = await prisma.asset.findMany({ where: { projectId: project.id }, select: { key: true } });

    await prisma.conversation.deleteMany({ where: { projectId: project.id } });
    await prisma.version.deleteMany({ where: { projectId: project.id } });
    await prisma.websiteProject.delete({ where: { id: project.id } });

    await deleteMediaKeys(assets.map(a => a.key), `delete website ${project.id}`);

    res.json({ message: 'Website deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getEditorWebsite = async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  const userId = req.userId as string;
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(websiteId ?? ''), userId }
    });
    if (!project) {
      return res.status(404).json({ error: 'Website not found' });
    }

    let pageData: any = {};
    try { pageData = JSON.parse((project as any).pageData || '{}'); } catch { pageData = {}; }

    // Auto-convert: HTML but no components anywhere yet → import it with its site styles (spec 0003 AC-10)
    if (toPages(pageData).every(p => !p.components?.length) && (project as any).current_code) {
      pageData = htmlToPageData((project as any).current_code);
      await prisma.websiteProject.update({
        where: { id: project.id },
        data: { pageData: JSON.stringify(pageData) } as any
      });
    }

    // Auto-convert legacy: if pageData has no pages but has components, wrap into pages
    if ((!pageData.pages || pageData.pages.length === 0) && pageData.components) {
      pageData = {
        pages: [
          { id: 'page-1', name: 'Home', slug: '/', components: pageData.components || [] }
        ],
        globalStyles: pageData.globalStyles || {}
      };
      await prisma.websiteProject.update({
        where: { id: project.id },
        data: { pageData: JSON.stringify(pageData) } as any
      });
    }

    // Ensure at least one page exists
    const pages = pageData.pages && pageData.pages.length > 0
      ? pageData.pages
      : [{ id: 'page-1', name: 'Home', slug: '/', components: [] }];

    const globalStyles = pageData.globalStyles || {};
    res.json({
      websiteId: project.id,
      name: project.name,
      pages,
      globalStyles,
      // Only a site that could not be imported needs its HTML here, for the read only view (spec 0013 AC-12).
      ...(globalStyles.importFailed ? { current_code: (project as any).current_code } : {}),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
