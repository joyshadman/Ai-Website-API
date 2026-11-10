import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The fixed sample set for spec 0012: 6 prompts on each of the first two default models, through
 * the same save steps as a real create. It costs 12 free daily requests per run. `DATABASE_URL`
 * points at nothing on purpose, so a sample can never reach a real project.
 *
 *   npx playwright install chromium   (once)
 *   npm run samples
 */

const NO_DATABASE = 'postgres://sample:sample@127.0.0.1:1/sample';
const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1280;
const PASS_BAR = 10;
const MIN_SECTION_TEXT = 20;
// A hero plus 3 to 6 more sections.
const MIN_SECTIONS = 4;
const MAX_SECTIONS = 7;

const SAMPLES = [
    { direction: 'minimal', prompt: 'A personal site for a freelance UX consultant named Mara Lind, with services, past work, and a way to get in touch' },
    { direction: 'minimal', prompt: 'A calm product page for a meditation timer app called Stillpoint, with features, how it works, and a download section' },
    { direction: 'bold', prompt: 'A launch page for a startup called Rally that helps small teams plan projects, with features, pricing, and a signup section' },
    { direction: 'bold', prompt: 'A site for a boxing gym called Iron Bell, with class types, trainers, membership options, and a contact section' },
    { direction: 'editorial', prompt: 'A website for a neighborhood restaurant called Olive and Ash, with a menu, our story, and reservations' },
    { direction: 'editorial', prompt: 'A portfolio for a travel photographer named Ines Marchetti, with selected stories, an about section, and a contact section' },
];

interface SampleResult {
    model: string;
    direction: string;
    prompt: string;
    passed: boolean;
    problems: string[];
    repairs: string[];
    failuresBefore: string[];
    failuresAfter: string[];
    phoneWidth: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    files: string[];
}

function completenessProblems(document: Document, code: string, blocks: Element[]): string[] {
    const problems: string[] = [];
    const tagOf = (el: Element) => el.tagName.toLowerCase();
    const sections = blocks.filter(block => tagOf(block) === 'section');
    if (!/<\/html\s*>/i.test(code)) problems.push('no-closing-html');
    if (!blocks.some(block => ['header', 'nav'].includes(tagOf(block)))) problems.push('no-header');
    if (!blocks.some(block => tagOf(block) === 'footer')) problems.push('no-footer');
    if (sections.length < MIN_SECTIONS || sections.length > MAX_SECTIONS) problems.push(`sections-${sections.length}`);
    if (sections.some(section => (section.textContent ?? '').trim().length < MIN_SECTION_TEXT && !section.querySelector('img'))) {
        problems.push('empty-section');
    }
    if (!document.querySelector('meta[name="viewport"]')) problems.push('no-viewport');
    return problems;
}

async function runModel(model: string, runDir: string): Promise<void> {
    await import('dotenv/config');
    const { parseGeneratedHtml } = await import('../lib/parseHtml.js');
    const { chromium } = await import('playwright');
    const generation = await import('../lib/generationJobs.js');
    const { buildCreateMessages } = await import('../controller/userController.js');
    const { extractHtmlCode } = await import('../lib/extractCode.js');
    const { checkDesign, siteCss } = await import('../lib/designChecks.js');
    const { findBlocks } = await import('../lib/scopedEdit.js');

    // The real runner tries to save and refund against the unreachable database, which is the point.
    const realError = console.error;
    console.error = (...args: unknown[]) => {
        if (!/^(Saving generation failed|Recording failed generation)/.test(String(args[0]))) realError(...args);
    };
    let attempt: { promptTokens: number | null; completionTokens: number | null } = { promptTokens: null, completionTokens: null };
    const realInfo = console.info;
    console.info = (...args: unknown[]) => {
        if (args[0] === '[ai-attempt]') attempt = JSON.parse(String(args[1]));
        else realInfo(...args);
    };

    const slug = model.split('/')[1]?.split(':')[0] ?? 'model';
    const browser = await chromium.launch();
    const results: SampleResult[] = [];

    async function measure(htmlFile: string, width: number, shot: string): Promise<number> {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
        await page.evaluate('document.fonts.ready.then(() => true)');
        // Presets hold content hidden until scrolled to, which a full page shot never does.
        // An endless animation (a pulsing dot, say) cannot be finished, and finishing one throws.
        await page.evaluate('document.querySelectorAll("[data-apx-anim]").forEach(el => el.classList.add("apx-in")); document.getAnimations().filter(a => a.effect.getComputedTiming().endTime !== Infinity).forEach(a => a.finish())');
        const scrollWidth = Number(await page.evaluate('document.documentElement.scrollWidth'));
        await page.screenshot({ path: shot, fullPage: true });
        await page.close();
        return scrollWidth;
    }

    for (const [index, sample] of SAMPLES.entries()) {
        const base = path.join(runDir, `${slug}-${index + 1}-${sample.direction}`);
        attempt = { promptTokens: null, completionTokens: null };
        const job = generation.reserveJob(`sample-${slug}-${index}`, `sample-user-${slug}-${index}`, 'create', 'sample');
        if (job === 409 || job === 429) throw new Error('Could not reserve a sample job.');
        job.runId = 'sample';
        await generation.runGenerationJob(job, async () => ({
            messages: buildCreateMessages(sample.prompt),
            maxTokens: generation.CREATE_MAX_TOKENS,
        }));

        const result: SampleResult = {
            model, ...sample, passed: false, problems: [], repairs: [], failuresBefore: [], failuresAfter: [],
            phoneWidth: null, promptTokens: attempt.promptTokens, completionTokens: attempt.completionTokens, files: [],
        };
        const generated = extractHtmlCode(job.raw);
        if (!generated) {
            result.problems.push('no-page');
        } else {
            const prepared = generation.prepareCreatedSite(generated);
            result.repairs = prepared.repairs;
            result.failuresBefore = prepared.failuresBefore;
            result.failuresAfter = checkDesign(prepared.code, { kind: 'create', legacy: false }).failures;

            const htmlFile = `${base}.html`;
            writeFileSync(htmlFile, prepared.code);
            const { document } = parseGeneratedHtml(prepared.code).window;
            result.problems.push(...completenessProblems(document, prepared.code, findBlocks(document.body)));
            const css = siteCss(prepared.code).join('\n');
            for (const breakpoint of ['1024', '640']) {
                if (!new RegExp(`@media[^{]*max-width:\\s*${breakpoint}px`, 'i').test(css)) result.problems.push(`no-breakpoint-${breakpoint}`);
            }
            // One page that cannot be measured is a miss, not a reason to lose the requests already spent.
            try {
                result.phoneWidth = await measure(htmlFile, PHONE_WIDTH, `${base}-phone.png`);
                await measure(htmlFile, DESKTOP_WIDTH, `${base}-desktop.png`);
                if (result.phoneWidth > PHONE_WIDTH) result.problems.push(`overflow-${result.phoneWidth}`);
                result.files = [htmlFile, `${base}-phone.png`, `${base}-desktop.png`];
            } catch (error) {
                console.warn(`Could not measure ${base}:`, error);
                result.problems.push('not-measured');
                result.files = [htmlFile];
            }
            result.problems.push(...result.failuresAfter);
        }
        result.passed = result.problems.length === 0;
        results.push(result);
        console.log(`${result.passed ? 'pass' : 'MISS'} ${slug} ${index + 1}/${SAMPLES.length} ${sample.direction}: ${result.problems.join(', ') || 'ok'}${result.repairs.length ? ` (repaired ${result.repairs.join(', ')})` : ''}`);
    }

    await browser.close();
    writeFileSync(path.join(runDir, `report-${slug}.json`), JSON.stringify(results, null, 2));
    process.exit(0);
}

async function runAll(): Promise<void> {
    const { DEFAULT_AI_MODELS } = await import('../config/aiModels.js');
    const models = DEFAULT_AI_MODELS.slice(0, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample-output', stamp);
    mkdirSync(runDir, { recursive: true });

    await Promise.all(models.map(model => new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'child', model, runDir], {
            stdio: 'inherit',
            // The model list is read at import, and the database must be unreachable before dotenv runs.
            env: { ...process.env, AI_MODELS: model, DATABASE_URL: NO_DATABASE },
        });
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Sample run for ${model} exited with ${code}.`)));
    })));

    const results: SampleResult[] = models.flatMap(model => {
        const slug = model.split('/')[1]?.split(':')[0] ?? 'model';
        return JSON.parse(readFileSync(path.join(runDir, `report-${slug}.json`), 'utf8')) as SampleResult[];
    });
    const passed = results.filter(result => result.passed).length;
    writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ passed, total: results.length, passBar: PASS_BAR, results }, null, 2));
    console.log(`\n${passed} of ${results.length} samples passed (the bar is ${PASS_BAR}). Output: ${runDir}`);
    process.exit(passed >= PASS_BAR ? 0 : 1);
}

const [mode, model, runDir] = process.argv.slice(2);
(mode === 'child' && model && runDir ? runModel(model, runDir) : runAll()).catch(error => {
    console.error(error);
    process.exit(1);
});
