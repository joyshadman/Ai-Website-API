import { parseGeneratedFragment, parseGeneratedHtml } from './parseHtml.js';
import { usesTailwind } from './cssResolve.js';

/**
 * Section scoped chat edits (spec 0011). A small edit sends only the matched blocks and gets
 * only those back. Blocks are cut by their position in the stored text, so everything outside
 * them stays byte identical. `null` from either entry point means "do a full page edit".
 */

const BLOCK_TAGS = new Set(['header', 'nav', 'section', 'aside', 'footer']);
const MAX_SELECTED = 2;
const MAX_BLOCK_SHARE = 0.6;
const MAX_CSS_SENT = 12_000;
const MAX_CSS_ADDED = 3_000;
const OUTLINE_TEXT = 60;

const SITE_WIDE = /\b(whole|entire|every|everything|throughout|redesign|rewrite)\b|\ball sections\b|\bnew section\b|\badd a section\b/i;
const HEADER_ROLES = ['header', 'nav', 'navbar', 'navigation', 'menu', 'logo'];
const HERO_ROLES = ['hero', 'banner'];
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'make', 'change', 'update', 'please', 'want', 'need',
    'should', 'could', 'would', 'have', 'more', 'less', 'some', 'color', 'colour', 'button', 'text', 'page', 'site',
    'website', 'section', 'title', 'image', 'link',
]);

export interface ScopedBlock {
    id: string;
    tag: string;
    start: number;
    end: number;
    html: string;
    logoMarkers: number;
}

export interface ScopedPlan {
    /** The exact stored text every offset refers to. */
    source: string;
    blockCount: number;
    selected: ScopedBlock[];
    outline: string;
    css: string;
    /** Where new CSS goes, or -1 when the page has no usable place. */
    addCssAt: number;
    wrapCssInStyle: boolean;
}

interface CssRule {
    prelude: string;
    body: string;
}

const tagOf = (el: Element) => el.tagName.toLowerCase();
const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function findBlocks(body: Element): Element[] {
    const blocks: Element[] = [];
    const walk = (parent: Element) => {
        for (const child of Array.from(parent.children)) {
            if (BLOCK_TAGS.has(tagOf(child))) blocks.push(child);
            else if (tagOf(child) === 'main' || child.hasAttribute('data-apexium-page')) walk(child);
        }
    };
    walk(body);
    return blocks;
}

function quotedPhrases(message: string): string[] {
    const phrases: string[] = [];
    for (const m of message.matchAll(/"([^"]{3,})"|“([^”]{3,})”|(?:^|\s)'([^']{3,})'(?=[\s.,!?]|$)/g)) {
        phrases.push(normalize(m[1] ?? m[2] ?? m[3]));
    }
    return phrases;
}

function labelsOf(block: Element): Set<string> {
    const raw = [block.id, block.getAttribute('class') ?? ''];
    for (const heading of Array.from(block.querySelectorAll('h1,h2,h3'))) raw.push(heading.textContent ?? '');
    return new Set(raw.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** The blocks a message names, or null when the match is not clear. */
function matchBlocks(blocks: Element[], message: string): Element[] | null {
    const said = new Set(message.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const saidAny = (words: string[]) => words.some(word => said.has(word));

    const roles = new Set<Element>();
    for (const block of blocks) {
        const tag = tagOf(block);
        if ((tag === 'header' || tag === 'nav') && saidAny(HEADER_ROLES)) roles.add(block);
        if (tag === 'footer' && said.has('footer')) roles.add(block);
    }
    const firstSection = blocks.find(block => tagOf(block) === 'section');
    if (firstSection && saidAny(HERO_ROLES)) roles.add(firstSection);

    const words = [...said].filter(word => word.length >= 4 && !STOP_WORDS.has(word));
    const phrases = quotedPhrases(message);
    const others = new Set<Element>();
    for (const block of blocks) {
        const labels = labelsOf(block);
        const text = normalize(block.textContent);
        if (words.some(word => labels.has(word)) || phrases.some(phrase => text.includes(phrase))) others.add(block);
    }

    if (roles.size > 0 && [...others].some(block => !roles.has(block))) return null;
    const chosen = roles.size > 0 ? roles : others;
    return chosen.size >= 1 && chosen.size <= MAX_SELECTED ? [...chosen] : null;
}

function parseRules(css: string): CssRule[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: CssRule[] = [];
    let depth = 0;
    let start = 0;
    let prelude = '';
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
            if (depth === 0) {
                prelude = text.slice(start, i);
                start = i + 1;
            }
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                rules.push({ prelude: prelude.slice(prelude.lastIndexOf(';') + 1).trim(), body: text.slice(start, i) });
                start = i + 1;
            }
        }
    }
    return rules;
}

const printRule = (rule: CssRule) => `${rule.prelude}{${rule.body.trim()}}`;

function selectorNames(blocks: Element[]): Set<string> {
    const names = new Set<string>();
    for (const block of blocks) {
        for (const el of [block, ...Array.from(block.querySelectorAll('*'))]) {
            names.add(tagOf(el));
            if (el.id) names.add(`#${el.id}`);
            for (const cls of Array.from(el.classList)) names.add(`.${cls}`);
            const dataC = el.getAttribute('data-c');
            if (dataC) names.add(`[${dataC}]`);
        }
    }
    return names;
}

function selectorMatches(selector: string, names: Set<string>): boolean {
    for (const m of selector.matchAll(/\[data-c=["']?([^"'\]]+)["']?\]/g)) {
        if (names.has(`[${m[1]}]`)) return true;
    }
    const plain = selector.replace(/\[[^\]]*\]/g, ' ').replace(/::?[a-zA-Z-]+/g, ' ');
    for (const m of plain.matchAll(/([.#]?)(-?[_a-zA-Z][\w-]*)/g)) {
        const name = m[1] ? `${m[1]}${m[2]}` : m[2]!.toLowerCase();
        if (names.has(name)) return true;
    }
    return false;
}

/** `:root`, the rules that reach these blocks, and the keyframes those rules name. */
function selectCss(sheets: string[], blocks: Element[]): string {
    const names = selectorNames(blocks);
    const included: CssRule[] = [];
    const keyframes: CssRule[] = [];
    for (const rule of sheets.flatMap(parseRules)) {
        if (/^@(-webkit-)?keyframes\b/i.test(rule.prelude)) {
            keyframes.push(rule);
        } else if (/^@media\b/i.test(rule.prelude)) {
            const inner = parseRules(rule.body).filter(r => selectorMatches(r.prelude, names));
            if (inner.length > 0) included.push({ prelude: rule.prelude, body: inner.map(printRule).join('\n') });
        } else if (!rule.prelude.startsWith('@') && (rule.prelude.includes(':root') || selectorMatches(rule.prelude, names))) {
            included.push(rule);
        }
    }
    const usedText = included.map(r => r.body).join(' ');
    const usedKeyframes = keyframes.filter(rule => {
        const name = rule.prelude.replace(/^@(-webkit-)?keyframes\s+/i, '').trim();
        return new RegExp(`(^|[^\\w-])${name.replace(/[^\w-]/g, '')}([^\\w-]|$)`).test(usedText);
    });
    return [...included, ...usedKeyframes].map(printRule).join('\n');
}

const hasApexiumAttr = (el: Element) => Array.from(el.attributes).some(attr => attr.name.startsWith('data-apexium'));

/** A section edit plan for this request, or null for a full page edit. */
export function planScopedEdit(html: string, message: string): ScopedPlan | null {
    if (SITE_WIDE.test(message) || /https?:\/\//i.test(message) || usesTailwind(html)) return null;

    const dom = parseGeneratedHtml(html, { includeNodeLocations: true });
    const doc = dom.window.document;
    const blocks = findBlocks(doc.body);
    if (blocks.length === 0) return null;

    const chosen = matchBlocks(blocks, message);
    if (!chosen) return null;
    if (chosen.some(block => block.querySelector('script,style'))) return null;

    const selected: ScopedBlock[] = [];
    for (const block of chosen) {
        const location = dom.nodeLocation(block);
        if (!location) return null;
        selected.push({
            id: `B${blocks.indexOf(block) + 1}`,
            tag: tagOf(block),
            start: location.startOffset,
            end: location.endOffset,
            html: html.slice(location.startOffset, location.endOffset),
            logoMarkers: block.querySelectorAll('[data-apexium-logo]').length,
        });
    }
    if (selected.reduce((sum, block) => sum + block.html.length, 0) > html.length * MAX_BLOCK_SHARE) return null;

    const sheets = Array.from(doc.querySelectorAll('style'))
        .filter(style => !style.hasAttribute('data-apexium-anim'))
        .map(style => style.textContent ?? '');
    const css = selectCss(sheets, chosen);
    if (css.length > MAX_CSS_SENT) return null;

    const outline = blocks
        .filter(block => !chosen.includes(block))
        .map(block => {
            const heading = block.querySelector('h1,h2,h3')?.textContent;
            return `B${blocks.indexOf(block) + 1} ${tagOf(block)}: ${normalize(heading).slice(0, OUTLINE_TEXT) || tagOf(block)}`;
        })
        .join('\n');

    const plainStyles = Array.from(doc.head.querySelectorAll('style')).filter(style => !hasApexiumAttr(style));
    const lastStyle = plainStyles[plainStyles.length - 1];
    const endTagStart = (el: Element) => (dom.nodeLocation(el) as { endTag?: { startOffset: number } } | null)?.endTag?.startOffset;
    const styleEnd = lastStyle ? endTagStart(lastStyle) : undefined;
    const headEnd = endTagStart(doc.head);

    return {
        source: html,
        blockCount: blocks.length,
        selected,
        outline,
        css,
        addCssAt: styleEnd ?? headEnd ?? -1,
        wrapCssInStyle: styleEnd === undefined,
    };
}

export function scopedUserMessage(plan: ScopedPlan, message: string): string {
    return `OTHER PARTS OF THE PAGE (for context, do not return these):
${plan.outline || '(none)'}

CSS THAT APPLIES:
${plan.css}

BLOCKS YOU MAY CHANGE:
${plan.selected.map(block => `--- ${block.id} ---\n${block.html}`).join('\n')}

USER REQUEST:
${message}`;
}

function validReplacement(block: ScopedBlock, html: string): boolean {
    if (/<\s*(script|style|html|head|body)\b/i.test(html)) return false;
    const nodes = Array.from(parseGeneratedFragment(html).childNodes).filter(node => node.nodeType !== 3 || (node.textContent ?? '').trim() !== '');
    const only = nodes[0] as Element | undefined;
    if (nodes.length !== 1 || only?.nodeType !== 1) return false;
    const tag = tagOf(only);
    if (!BLOCK_TAGS.has(tag) || !new RegExp(`</${tag}\\s*>$`, 'i').test(html)) return false;
    return only.querySelectorAll('[data-apexium-logo]').length === block.logoMarkers;
}

function validAddedCss(css: string): boolean {
    if (css.length > MAX_CSS_ADDED || /@import|@font-face|<\/style/i.test(css)) return false;
    let depth = 0;
    for (const ch of css) {
        if (ch === '{') depth++;
        else if (ch === '}' && --depth < 0) return false;
    }
    return depth === 0;
}

/** The full page with the reply spliced in, or null when the reply cannot be used safely. */
export function applyScopedReply(plan: ScopedPlan, raw: string): string | null {
    const text = raw.replace(/```[a-zA-Z]*\s*/g, '');
    const matches = [...text.matchAll(/<apx-block\s+id=["']?([^"'\s>]+)["']?\s*>([\s\S]*?)<\/apx-block\s*>/gi)];
    if (matches.length === 0 || matches.length !== (text.match(/<apx-block\b/gi) ?? []).length) return null;

    const edits: { start: number; end: number; text: string }[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
        const id = m[1]!;
        const block = plan.selected.find(candidate => candidate.id === id);
        const replacement = m[2]!.trim();
        if (!block || seen.has(id) || !validReplacement(block, replacement)) return null;
        seen.add(id);
        edits.push({ start: block.start, end: block.end, text: replacement });
    }

    const added = /<apx-css>([\s\S]*?)<\/apx-css\s*>/i.exec(text)?.[1]?.trim() ?? '';
    if (added) {
        if (!validAddedCss(added) || plan.addCssAt < 0) return null;
        edits.push({ start: plan.addCssAt, end: plan.addCssAt, text: plan.wrapCssInStyle ? `<style>\n${added}\n</style>\n` : `\n${added}\n` });
    }

    // From the last position to the first, so earlier positions stay valid.
    let result = plan.source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }

    const reparsed = parseGeneratedHtml(result).window.document;
    return findBlocks(reparsed.body).length === plan.blockCount ? result : null;
}
