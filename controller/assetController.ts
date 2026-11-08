import { randomUUID } from 'node:crypto';
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import type { Asset } from '@prisma/client';
import prisma from '../lib/prisma.js';
import {
    MAX_FILE_BYTES,
    MAX_IMAGE_BYTES,
    MEDIA_ERRORS,
    PROJECT_LIMIT_BYTES,
    cleanFileName,
    deleteMedia,
    imageDimensions,
    isMediaConfigured,
    mediaUrl,
    putMedia,
    sniffFile,
    takeUploadSlot,
} from '../lib/media.js';

/* Project media (spec 0006): upload, list, alt text, delete. Owner only; the files are public by URL. */

const MAX_ALT = 300;
const ALT_TOO_LONG = `Alt text can be up to ${MAX_ALT} characters.`;
const DELETE_FAILED = "Couldn't delete the upload. Try again.";

const param = (value: unknown) => typeof value === 'string' ? value : String(value ?? '');

const toAssetJson = (asset: Asset) => ({
    id: asset.id,
    kind: asset.kind,
    url: mediaUrl(asset.key),
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    alt: asset.alt,
    createdAt: asset.createdAt,
});

/** Anyone but the owner gets 404, the same as a missing project (AC-7). */
export const ownProject: RequestHandler = async (req, res, next) => {
    try {
        const projectId = param(req.params.projectId);
        const project = await prisma.websiteProject.findFirst({
            where: { id: projectId, userId: req.userId ?? '' },
            select: { id: true },
        });
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.locals.projectId = project.id;
        next();
    } catch (error) {
        next(error);
    }
};

export const mediaReady: RequestHandler = (_req, res, next) => {
    if (!isMediaConfigured()) {
        res.status(503).json({ error: MEDIA_ERRORS.notConfigured });
        return;
    }
    next();
};

/** Every attempt counts, before the body is read (AC-8). */
export const uploadRateLimit: RequestHandler = (req, res, next) => {
    if (!takeUploadSlot(req.userId ?? '')) {
        res.status(429).json({ error: MEDIA_ERRORS.rateLimited });
        return;
    }
    next();
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, fieldSize: 4096 },
});

/** One `file` field, at most 20 MB; anything else is a clear 400 or 413 (spec 0009 AC-4). */
export const parseUpload: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (err?: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: MEDIA_ERRORS.fileTooLarge });
            return res.status(400).json({ error: MEDIA_ERRORS.noFile });
        }
        next(err);
    });
};

class ProjectFullError extends Error {}
class StorageError extends Error {}

/**
 * Checks run in the spec 0009 AC-4 order: no file, empty, over 20 MB (multer), type,
 * image over 5 MB, then the 200 MB pool. `accept` defaults to `image`, as spec 0006 built it.
 */
export const uploadAsset = async (req: Request, res: Response) => {
    const projectId = res.locals.projectId as string;
    const file = req.file;
    if (!file) return res.status(400).json({ error: MEDIA_ERRORS.noFile });
    if (file.size === 0) return res.status(400).json({ error: MEDIA_ERRORS.empty });

    const acceptAny = req.body?.accept === 'any';
    const imageFallback = cleanFileName(file.originalname, 'image');
    const type = sniffFile(file.buffer, imageFallback);
    if (!acceptAny && !(type.ok && type.kind === 'image')) return res.status(415).json({ error: MEDIA_ERRORS.badType });
    if (!type.ok) return res.status(415).json({ error: type.error === 'notUtf8' ? MEDIA_ERRORS.notUtf8 : MEDIA_ERRORS.badFileType });
    const isImage = type.kind === 'image';
    if (isImage && file.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: MEDIA_ERRORS.tooLarge });

    const rawAlt: unknown = req.body?.alt;
    const alt = isImage && typeof rawAlt === 'string' ? rawAlt.trim() : '';
    if (alt.length > MAX_ALT) return res.status(400).json({ error: ALT_TOO_LONG });

    const { width, height } = isImage ? imageDimensions(file.buffer) : { width: null, height: null };
    const fileName = isImage ? imageFallback : cleanFileName(file.originalname, 'file');
    const key = `projects/${projectId}/${randomUUID()}.${type.ext}`;
    let stored = false;
    try {
        // Lock, check the cap, write the file, insert the row: an over cap upload never reaches storage.
        const asset = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
            const used = await tx.asset.aggregate({ where: { projectId }, _sum: { size: true } });
            if ((used._sum.size ?? 0) + file.size > PROJECT_LIMIT_BYTES) throw new ProjectFullError();
            try {
                await putMedia(key, file.buffer, type.mimeType, !isImage);
            } catch (error) {
                console.error('[media] storage write failed', error);
                throw new StorageError();
            }
            stored = true;
            return tx.asset.create({
                data: {
                    projectId,
                    userId: req.userId ?? '',
                    kind: type.kind,
                    key,
                    fileName,
                    mimeType: type.mimeType,
                    size: file.size,
                    width,
                    height,
                    alt,
                },
            });
        }, { maxWait: 10_000, timeout: 30_000 });
        res.status(201).json({ asset: toAssetJson(asset) });
    } catch (error) {
        // Every stored file has its row: undo the write when the insert or commit failed (AC-12).
        if (stored) await deleteMedia(key).catch(err => console.error(`[media] could not remove ${key} after a failed insert`, err));
        if (error instanceof ProjectFullError) return res.status(413).json({ error: MEDIA_ERRORS.projectFull });
        if (!(error instanceof StorageError)) console.error('[media] upload failed', error);
        res.status(502).json({ error: MEDIA_ERRORS.storage });
    }
};

/** Cursor over (createdAt, id), both newest first, so equal timestamps never skip a row (AC-5). */
function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
    try {
        const [time, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
        const createdAt = new Date(time ?? '');
        return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
    } catch {
        return null;
    }
}

const encodeCursor = (asset: Asset) => Buffer.from(`${asset.createdAt.toISOString()}|${asset.id}`, 'utf8').toString('base64url');

export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const projectId = res.locals.projectId as string;
        const limitRaw = Number(param(req.query.limit) || 60);
        const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 60;
        const rawCursor = param(req.query.cursor);
        const cursor = rawCursor ? decodeCursor(rawCursor) : null;
        if (rawCursor && !cursor) return res.status(400).json({ error: 'Invalid cursor' });
        // Omitted means images, so image pickers and an older frontend never see documents (spec 0009).
        const kind = param(req.query.kind) || 'image';
        if (kind !== 'image' && kind !== 'file' && kind !== 'all') return res.status(400).json({ error: 'Invalid kind' });

        const rows = await prisma.asset.findMany({
            where: {
                projectId,
                ...(kind === 'all' ? {} : { kind }),
                ...(cursor ? {
                    OR: [
                        { createdAt: { lt: cursor.createdAt } },
                        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                    ],
                } : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const used = await prisma.asset.aggregate({ where: { projectId }, _sum: { size: true } });
        res.json({
            assets: page.map(toAssetJson),
            nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
            usedBytes: used._sum.size ?? 0,
            limitBytes: PROJECT_LIMIT_BYTES,
        });
    } catch (error) {
        next(error);
    }
};

export const updateAssetAlt = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const projectId = res.locals.projectId as string;
        const assetId = param(req.params.assetId);
        const rawAlt: unknown = req.body?.alt;
        if (typeof rawAlt !== 'string') return res.status(400).json({ error: 'Alt text is required.' });
        const alt = rawAlt.trim();
        if (alt.length > MAX_ALT) return res.status(400).json({ error: ALT_TOO_LONG });

        const found = await prisma.asset.findFirst({ where: { id: assetId, projectId }, select: { id: true } });
        if (!found) return res.status(404).json({ error: 'Image not found' });
        const asset = await prisma.asset.update({ where: { id: found.id }, data: { alt } });
        res.json({ asset: toAssetJson(asset) });
    } catch (error) {
        next(error);
    }
};

/** The file goes first; the row is dropped only after storage confirms (spec 0006 invariant). */
export const deleteAsset = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const projectId = res.locals.projectId as string;
        const assetId = param(req.params.assetId);
        const asset = await prisma.asset.findFirst({ where: { id: assetId, projectId } });
        if (!asset) return res.status(404).json({ error: 'Upload not found' });
        try {
            await deleteMedia(asset.key);
        } catch (error) {
            console.error(`[media] could not delete ${asset.key}`, error);
            return res.status(502).json({ error: DELETE_FAILED });
        }
        await prisma.asset.delete({ where: { id: asset.id } });
        res.json({ message: 'Upload deleted' });
    } catch (error) {
        next(error);
    }
};
