import { DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RequestHandler } from 'express';
import { imageSize } from 'image-size';

/**
 * Uploaded media (spec 0006). Files live in a `public_read` Neon Object Storage bucket,
 * reached through the S3 API; pages save `/media/<key>`, which Vercel rewrites to the bucket.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Every upload is read with this limit; images are held to 5 MB after sniffing (spec 0009). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const PROJECT_LIMIT_BYTES = 200 * 1024 * 1024;
const UPLOADS_PER_MINUTE = 30;
const MAX_CONCURRENT_UPLOADS = 4;

export const MEDIA_ERRORS = {
  notConfigured: 'Uploads are not set up on this server yet. Add the storage settings (see the API AGENTS.md) and try again.',
  noFile: 'Choose a file to upload.',
  empty: 'That file is empty.',
  tooLarge: 'Images can be up to 5 MB.',
  fileTooLarge: 'Files can be up to 20 MB.',
  badType: 'Use a JPEG, PNG, WebP, or GIF image.',
  badFileType: 'Use a PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV, or ZIP file.',
  notUtf8: 'Save the file as UTF-8 and upload it again.',
  projectFull: "This project's media is full (200 MB). Delete some uploads to upload more.",
  rateLimited: 'Too many uploads. Wait a minute and try again.',
  storage: 'Upload failed. Try again.',
} as const;

/** One rule for both chat edit prompts, next to the animation rule (spec 0006 AC-11, spec 0009 AC-10). */
export const MEDIA_PROMPT_RULE = '- Images whose src or CSS url() starts with /media/ are the user\'s uploads. Keep every one of those values exactly as it is, and keep any <link rel="icon"> in the head. Links whose href starts with /media/ are the user\'s files: keep each href and its download attribute exactly as they are.';

export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** Safe upload keys only (`projects/<id>/<uuid>.<ext>`), so the redirect can never point anywhere else. */
const MEDIA_KEY = /^projects\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.[a-z0-9]{1,5}$/;

/**
 * The public bucket address for a key. `MEDIA_PUBLIC_URL` overrides it (a CDN or a virtual host
 * address); otherwise it is the path style `<AWS_ENDPOINT_URL_S3>/<MEDIA_BUCKET>/<key>`.
 */
export function publicObjectUrl(key: string): string | null {
  if (!MEDIA_KEY.test(key)) return null;
  const base = process.env.MEDIA_PUBLIC_URL?.trim()
    || `${(process.env.AWS_ENDPOINT_URL_S3 ?? '').trim().replace(/\/$/, '')}/${bucket()}`;
  return `${base.replace(/\/$/, '')}/${key}`;
}

/** `GET /media/<key>`: Vercel (and Vite in dev) send `/media` here, and this redirects to the public file. */
export const serveMedia: RequestHandler = (req, res) => {
  const key = req.path.replace(/^\/media\//, '');
  const target = isMediaConfigured() ? publicObjectUrl(key) : null;
  if (!target) { res.status(404).type('text/plain').send('Not found'); return; }
  res.set('Cache-Control', 'public, max-age=86400').redirect(302, target);
};

export function isMediaConfigured(): boolean {
  return ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'MEDIA_BUCKET']
    .every(name => Boolean(process.env[name]?.trim()));
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION ?? '',
      endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '' },
    });
  }
  return client;
}

const bucket = () => process.env.MEDIA_BUCKET ?? '';

/** The real type from the first bytes; the browser's Content-Type and the file name are ignored. */
export function sniffImage(buf: Uint8Array): { mimeType: string; ext: string } | null {
  const at = (i: number) => buf[i] ?? -1;
  const ascii = (start: number, text: string) => [...text].every((ch, i) => at(start + i) === ch.charCodeAt(0));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return { mimeType: 'image/png', ext: 'png' };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { mimeType: 'image/gif', ext: 'gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { mimeType: 'image/webp', ext: 'webp' };
  return null;
}

const ZIP_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};
const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

export type SniffResult =
  | { ok: true; kind: 'image' | 'file'; mimeType: string; ext: string }
  | { ok: false; error: 'badType' | 'notUtf8' };

/**
 * The upload's type and kind (spec 0009 AC-4, AC-5). Images, PDF, and text come from the bytes;
 * inside the ZIP family the bytes only prove a ZIP, so the cleaned name's extension picks the type.
 */
export function sniffFile(buf: Uint8Array, fileName: string): SniffResult {
  const image = sniffImage(buf);
  if (image) return { ok: true, kind: 'image', ...image };
  const head = Buffer.from(buf.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return { ok: true, kind: 'file', mimeType: 'application/pdf', ext: 'pdf' };
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const mimeType = ZIP_TYPES[ext];
    return mimeType ? { ok: true, kind: 'file', mimeType, ext } : { ok: false, error: 'badType' };
  }
  const textType = TEXT_TYPES[ext];
  if (textType) {
    if (buf.includes(0)) return { ok: false, error: 'badType' };
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return { ok: false, error: 'notUtf8' };
    }
    return { ok: true, kind: 'file', mimeType: textType, ext };
  }
  return { ok: false, error: 'badType' };
}

export function imageDimensions(buf: Uint8Array): { width: number | null; height: number | null } {
  try {
    const { width, height } = imageSize(buf);
    return { width: Number.isFinite(width) ? width : null, height: Number.isFinite(height) ? height : null };
  } catch {
    return { width: null, height: null };
  }
}

/** multer decodes names as latin1; restore UTF-8, drop path parts and control characters. */
export function cleanFileName(raw: string | undefined, fallback = 'image'): string {
  let name = raw ?? '';
  try { name = Buffer.from(name, 'latin1').toString('utf8'); } catch { /* keep as is */ }
  name = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.slice(0, 200) || fallback;
}

/**
 * Files (`asDownload`) get a bare `attachment`, so opening the URL downloads instead of showing
 * it on the app's domain, while the link's `download` name still wins (spec 0009 AC-8).
 */
export async function putMedia(key: string, body: Uint8Array, mimeType: string, asDownload = false): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: mimeType,
    ...(asDownload ? { ContentDisposition: 'attachment' } : {}),
    // Keys are random and never reused, so the file can be cached for good.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

export async function deleteMedia(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Removes many files in batches of 1,000; failures are logged, never thrown (AC-9). */
export async function deleteMediaKeys(keys: string[], context: string): Promise<void> {
  if (keys.length === 0 || !isMediaConfigured()) {
    if (keys.length) console.error(`[media] ${context}: storage not configured, ${keys.length} files left behind`);
    return;
  }
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const out = await s3().send(new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
      for (const err of out.Errors ?? []) console.error(`[media] ${context}: could not delete ${err.Key}: ${err.Code ?? ''} ${err.Message ?? ''}`);
    } catch (err) {
      console.error(`[media] ${context}: batch delete failed for ${batch.length} files`, err);
    }
  }
}

/** Per user sliding window: every attempt counts, entries older than a minute are pruned (AC-8). */
const recentUploads = new Map<string, number[]>();

export function takeUploadSlot(userId: string, now = Date.now()): boolean {
  for (const [id, times] of recentUploads) {
    const fresh = times.filter(t => now - t < 60_000);
    if (fresh.length) recentUploads.set(id, fresh); else recentUploads.delete(id);
  }
  const times = recentUploads.get(userId) ?? [];
  if (times.length >= UPLOADS_PER_MINUTE) return false;
  times.push(now);
  recentUploads.set(userId, times);
  return true;
}

/**
 * At most 4 uploads are in memory at once per process; the rest wait their turn. Runs before
 * multer reads the body, and frees the slot when the response closes, so buffers stay bounded.
 */
let running = 0;
const waiting: (() => void)[] = [];

export const uploadSlot: RequestHandler = async (_req, res, next) => {
  if (running >= MAX_CONCURRENT_UPLOADS) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  let released = false;
  res.on('close', () => {
    if (released) return;
    released = true;
    running--;
    waiting.shift()?.();
  });
  next();
};
