import { type Request, type Response } from "express";
import prisma from '../lib/prisma.js';

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

      const merged = {
        pages: incomingPages !== undefined ? incomingPages : (existing.pages || []),
        globalStyles: incomingGlobalStyles !== undefined ? incomingGlobalStyles : (existing.globalStyles || {})
      };
      data.pageData = JSON.stringify(merged);
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

    await prisma.conversation.deleteMany({ where: { projectId: project.id } });
    await prisma.version.deleteMany({ where: { projectId: project.id } });
    await prisma.websiteProject.delete({ where: { id: project.id } });

    res.json({ message: 'Website deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getEditorWebsite = async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  const userId = req.userId as string;
  console.log("[DEBUG] getEditorWebsite - websiteId:", websiteId, "userId:", userId);
  try {
    const project = await prisma.websiteProject.findFirst({
      where: { id: String(websiteId ?? ''), userId }
    });
    if (!project) {
      console.log("[DEBUG] getEditorWebsite - Project not found for id:", websiteId, "userId:", userId);
      return res.status(404).json({ error: 'Website not found' });
    }

    console.log("[DEBUG] getEditorWebsite - Found project:", project.id, project.name);
    console.log("[DEBUG] getEditorWebsite - project.current_code exists:", !!project.current_code);
    console.log("[DEBUG] getEditorWebsite - project.pageData raw:", project.pageData?.substring?.(0, 200));

    let pageData: any = {};
    try { pageData = JSON.parse((project as any).pageData || '{}'); } catch { pageData = {}; }
    console.log("[DEBUG] getEditorWebsite - parsed pageData keys:", Object.keys(pageData));
    console.log("[DEBUG] getEditorWebsite - has pages?", !!pageData.pages, "has components?", !!pageData.components);

    // Auto-convert legacy: if pageData has no pages but has components, wrap into pages
    if ((!pageData.pages || pageData.pages.length === 0) && pageData.components) {
      console.log("[DEBUG] getEditorWebsite - Auto-converting legacy components to pages. Components count:", pageData.components.length);
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
      console.log("[DEBUG] getEditorWebsite - Legacy conversion saved to DB");
    }

    // Ensure at least one page exists
    const pages = pageData.pages && pageData.pages.length > 0
      ? pageData.pages
      : [{ id: 'page-1', name: 'Home', slug: '/', components: [] }];

    const response = {
      websiteId: project.id,
      name: project.name,
      pages
    };
    console.log("[DEBUG] getEditorWebsite - Response pages count:", response.pages.length);
    console.log("[DEBUG] getEditorWebsite - Sending success response");
    res.json(response);
  } catch (error: any) {
    console.error("[DEBUG] getEditorWebsite - Error:", error.message);
    res.status(500).json({ message: error.message });
  }
};
