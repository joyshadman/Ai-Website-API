import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Proves that every sample site survives import and export (spec 0013 AC-3, AC-4, AC-9). It uses
 * no AI requests and touches no database. `npm run roundtrip` fails if any site fails.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, '..');
const WEB = path.join(API, '..', 'Ai-Website');
const CORPUS = path.join(API, 'test-fixtures', 'generated');
const WIDTHS = [390, 1280];
const MAX_PIXEL_DIFF = 0.01;
const BLOCK = /\/\/ === spec 0013 shared block start ===[\s\S]*\/\/ === spec 0013 shared block end ===/;

interface PageFacts {
    text: string;
    tags: Record<string, number>;
    links: string[];
    images: string[];
    ids: string[];
    title: string;
    description: string;
}

/** Child process: the editor's real export, run with the web repo's `@/` path setting. */
async function webExport(jobFile: string): Promise<void> {
    const { generateHtml } = await import(path.join(WEB, 'src/Pages/editor/renderHtml.ts'));
    const job = JSON.parse(readFileSync(jobFile, 'utf8')) as { pages: unknown; site: unknown }[];
    writeFileSync(`${jobFile}.out`, JSON.stringify(job.map(entry => generateHtml(entry.pages, '#/', entry.site))));
}

function sharedBlock(file: string): string | null {
    return BLOCK.exec(readFileSync(file, 'utf8'))?.[0] ?? null;
}

async function main(): Promise<void> {
    process.env.DATABASE_URL = 'postgres://sample:sample@127.0.0.1:1/sample';
    process.env.AI_API_KEY ??= 'not-used';
    const require = createRequire(import.meta.url);
    const { chromium } = require('playwright') as typeof import('playwright');
    const { htmlToPageData, componentsToHtml, toPages } = await import('../lib/htmlToSchema.js');
    const { parseGeneratedHtml } = await import('../lib/parseHtml.js');
    const { normalizeUrl } = await import('../lib/links.js');

    const failures: string[] = [];

    const apiBlock = sharedBlock(path.join(API, 'lib/siteStyles.ts'));
    const webBlock = sharedBlock(path.join(WEB, 'src/lib/siteStyles.ts'));
    if (!apiBlock || !webBlock) failures.push('shared block: a marker is missing');
    else if (apiBlock !== webBlock) failures.push('shared block: the two copies differ');

    const facts = (html: string): PageFacts => {
        const doc = parseGeneratedHtml(html).window.document;
        const title = doc.title;
        const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
        doc.querySelectorAll('script,style').forEach(el => el.remove());
        // A logo is redrawn by the logo rules, so only its marker is counted, not what is inside it.
        doc.querySelectorAll('[data-apexium-logo]').forEach(el => { el.innerHTML = ''; });
        const tags: Record<string, number> = {};
        doc.body.querySelectorAll('*').forEach(el => {
            const tag = el.localName.toLowerCase();
            tags[tag] = (tags[tag] ?? 0) + 1;
        });
        const attr = (selector: string, name: string) => Array.from(doc.body.querySelectorAll(selector)).map(el => el.getAttribute(name) ?? '').sort();
        return {
            text: (doc.body.textContent ?? '').replace(/\s+/g, ''),
            tags,
            links: attr('a[href]', 'href').map(href => normalizeUrl(href) ?? href),
            images: attr('img', 'src'),
            ids: attr('[id]', 'id'),
            title,
            description,
        };
    };

    const files = readdirSync(CORPUS).filter(name => name.endsWith('.html')).sort();
    if (files.length === 0) failures.push('corpus: no sites found');
    const entries = files.map(name => {
        const html = readFileSync(path.join(CORPUS, name), 'utf8');
        const data = htmlToPageData(html, { pageId: 'page-1' });
        const pages = toPages(data);
        return { name, html, data, pages, back: componentsToHtml(pages, data.globalStyles) };
    });

    const outDir = path.join(API, 'sample-output', 'roundtrip');
    mkdirSync(outDir, { recursive: true });
    const jobDir = mkdtempSync(path.join(tmpdir(), 'roundtrip-'));
    const jobFile = path.join(jobDir, 'job.json');
    writeFileSync(jobFile, JSON.stringify(entries.map(entry => ({ pages: entry.pages, site: entry.data.globalStyles }))));
    const child = spawnSync(path.join(API, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(WEB, 'tsconfig.json'), fileURLToPath(import.meta.url), 'web', jobFile], { stdio: ['ignore', 'inherit', 'inherit'] });
    const editorHtml: string[] = child.status === 0 ? JSON.parse(readFileSync(`${jobFile}.out`, 'utf8')) : [];
    if (child.status !== 0) failures.push('editor export: the child process failed');

    const browser = await chromium.launch();
    const shoot = async (html: string, file: string, width: number) => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const htmlFile = `${file}.page.html`;
        writeFileSync(htmlFile, html);
        await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
        await page.evaluate('document.fonts.ready.then(() => true)');
        await page.evaluate('document.querySelectorAll("[data-apx-anim]").forEach(el => el.classList.add("apx-in")); document.getAnimations().forEach(a => { if (a.effect.getComputedTiming().endTime === Infinity) a.cancel(); else a.finish(); })');
        await page.waitForTimeout(150);
        const buffer = await page.screenshot({ path: file, fullPage: true });
        await page.close();
        return buffer.toString('base64');
    };
    const comparer = await browser.newPage();
    const pixelDiff = (a: string, b: string): Promise<{ same: boolean; ratio: number; heights: number[] }> => comparer.evaluate(`(async () => {
        const load = src => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = 'data:image/png;base64,' + src; });
        const [one, two] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
        const heights = [one.height, two.height];
        if (one.width !== two.width || one.height !== two.height) return { same: false, ratio: 1, heights };
        const read = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
        const x = read(one), y = read(two);
        let diff = 0;
        for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 16 || Math.abs(x[i + 1] - y[i + 1]) > 16 || Math.abs(x[i + 2] - y[i + 2]) > 16) diff++;
        return { same: true, ratio: diff / (x.length / 4), heights };
    })()`);

    for (const [index, entry] of entries.entries()) {
        const problems: string[] = [];
        if (entry.data.globalStyles.importFailed) problems.push('import failed');
        const before = facts(entry.html);
        const after = facts(entry.back);
        if (before.text !== after.text) problems.push('text changed');
        const tags = new Set([...Object.keys(before.tags), ...Object.keys(after.tags)]);
        for (const tag of tags) if ((before.tags[tag] ?? 0) !== (after.tags[tag] ?? 0)) problems.push(`tag ${tag}: ${before.tags[tag] ?? 0} to ${after.tags[tag] ?? 0}`);
        for (const key of ['links', 'images', 'ids'] as const) {
            if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
                const missing = before[key].filter(v => !after[key].includes(v)).slice(0, 3);
                const extra = after[key].filter(v => !before[key].includes(v)).slice(0, 3);
                problems.push(`${key} changed (lost ${JSON.stringify(missing)}, gained ${JSON.stringify(extra)})`);
            }
        }
        if (before.title !== after.title) problems.push('title changed');
        if (before.description !== after.description) problems.push('description changed');
        if (editorHtml[index] !== undefined && editorHtml[index] !== entry.back) problems.push('editor and server exports differ');

        const stem = path.join(outDir, entry.name.replace(/\.html$/, ''));
        let worst = 0;
        for (const width of WIDTHS) {
            const a = await shoot(entry.html, `${stem}-${width}-before.png`, width);
            const b = await shoot(entry.back, `${stem}-${width}-after.png`, width);
            const result = await pixelDiff(a, b);
            worst = Math.max(worst, result.ratio);
            if (!result.same) problems.push(`height at ${width}: ${result.heights.join(' to ')}`);
            else if (result.ratio > MAX_PIXEL_DIFF) problems.push(`pixels at ${width}: ${(result.ratio * 100).toFixed(2)}% differ`);
        }
        console.log(`${problems.length ? 'FAIL' : 'pass'} ${entry.name} (worst pixel difference ${(worst * 100).toFixed(2)}%)${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`);
        if (problems.length) failures.push(entry.name);
    }

    await browser.close();
    console.log(failures.length ? `\n${failures.length} problem(s): ${failures.join(', ')}` : `\nAll ${entries.length} sites passed.`);
    process.exit(failures.length ? 1 : 0);
}

const [mode, jobFile] = process.argv.slice(2);
(mode === 'web' && jobFile ? webExport(jobFile) : main()).catch(error => {
    console.error(error);
    process.exit(1);
});
