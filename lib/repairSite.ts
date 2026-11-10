import type { JSDOM } from 'jsdom';
import { parseGeneratedHtml } from './parseHtml.js';
import { DELAY_VALUES, ENTRANCE_PRESETS, HOVER_PRESETS, SPEEDS } from './animations.js';
import { CONTRAST_PAIRS, FORBIDDEN_TARGETS, contrastRatio, directionFromHtml, parseColor, rootTokens, siteCss } from './designChecks.js';
import { DIRECTION_DEFAULTS, EDIT_MOTION_CAP, MOTION_CAPS, PALETTES, REQUIRED_TOKENS, type Direction } from './designPrompt.js';
import { findBlocks } from './scopedEdit.js';

/**
 * Fixes common faults in a newly created site with no AI request (spec 0012). Decisions are made
 * on a parsed copy, then applied to the stored text by position, so everything outside the
 * repaired attributes, one added `:root` rule, and one added font link stays byte identical.
 */

const ANIM = 'data-apx-anim';
const SPEED = 'data-apx-speed';
const DELAY = 'data-apx-delay';
const HOVER = 'data-apx-hover';
const MOTION_ATTRS = [ANIM, SPEED, DELAY, HOVER];
const OTHER_VALID: [string, readonly string[]][] = [[SPEED, SPEEDS], [DELAY, DELAY_VALUES], [HOVER, HOVER_PRESETS]];

const COLOR_TOKENS = REQUIRED_TOKENS.slice(0, 6);
const GENERIC_FAMILIES = new Set(['serif', 'monospace', 'cursive', 'fantasy']);

type Rgb = [number, number, number];

interface TextEdit {
    start: number;
    end: number;
    text: string;
}

interface StartTagLocation {
    startTag?: { endOffset: number };
    endTag?: { startOffset: number };
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
}

export interface RepairResult {
    html: string;
    repairs: string[];
}

const tagOf = (el: Element) => el.tagName.toLowerCase();
const isInForm = (el: Element) => !!el.parentElement?.closest('form');
const animatedIn = (body: Element) => Array.from(body.querySelectorAll(`[${ANIM}]`));
const clearEntrance = (el: Element) => [ANIM, SPEED, DELAY].forEach(attr => el.removeAttribute(attr));

const motionAttrsOf = (el: Element) => new Map(
    MOTION_ATTRS.flatMap(attr => {
        const value = el.getAttribute(attr);
        return value === null ? [] : [[attr, value] as const];
    })
);

function repairInvalidMotion(body: Element, repairs: Set<string>): void {
    for (const el of Array.from(body.querySelectorAll('*'))) {
        const preset = el.getAttribute(ANIM);
        if (preset !== null && !(ENTRANCE_PRESETS as readonly string[]).includes(preset)) {
            clearEntrance(el);
            repairs.add('motion-invalid');
        }
        for (const [attr, valid] of OTHER_VALID) {
            const value = el.getAttribute(attr);
            if (value !== null && !valid.includes(value)) {
                el.removeAttribute(attr);
                repairs.add('motion-invalid');
            }
        }
    }
}

function repairForbiddenTargets(body: Element, repairs: Set<string>): void {
    for (const el of animatedIn(body)) {
        if (!FORBIDDEN_TARGETS.has(tagOf(el)) && !isInForm(el)) continue;
        const heading = Array.from(el.querySelectorAll('h2')).find(h2 => !h2.hasAttribute(ANIM) && !isInForm(h2));
        if (heading) {
            heading.setAttribute(ANIM, el.getAttribute(ANIM) ?? '');
            const speed = el.getAttribute(SPEED);
            if (speed !== null) heading.setAttribute(SPEED, speed);
        }
        clearEntrance(el);
        repairs.add('motion-forbidden-target');
    }
}

function repairMotionCap(body: Element, cap: number, repairs: Set<string>): void {
    const extra = animatedIn(body).slice(cap);
    extra.forEach(clearEntrance);
    if (extra.length > 0) repairs.add('motion-too-many');
}

function addMissingMotion(body: Element, direction: Direction, repairs: Set<string>): void {
    if (animatedIn(body).length > 0) return;
    const sections = findBlocks(body).filter(block => tagOf(block) === 'section');
    const first = sections[0];
    if (!first) return;

    const hero = Array.from(first.children).find(child => tagOf(child) === 'div') ?? first.querySelector('h1');
    const targets: Element[] = hero ? [hero] : [];
    for (const section of sections) {
        const heading = section.querySelector('h2');
        // A heading inside the hero block is already revealed along with it.
        if (heading && !isInForm(heading) && !hero?.contains(heading)) targets.push(heading);
    }

    const { preset, speed } = DIRECTION_DEFAULTS[direction];
    const chosen = targets.slice(0, MOTION_CAPS[direction]);
    for (const target of chosen) {
        target.setAttribute(ANIM, preset);
        target.setAttribute(SPEED, speed);
    }
    if (chosen.length > 0) repairs.add('motion-none');
}

/** The text edits that make each start tag match the repaired copy. */
function motionEdits(html: string, dom: JSDOM, before: Map<Element, Map<string, string>>): TextEdit[] {
    const edits: TextEdit[] = [];
    for (const el of Array.from(dom.window.document.body.querySelectorAll('*'))) {
        const was = before.get(el) ?? new Map<string, string>();
        const now = motionAttrsOf(el);
        if (was.size === 0 && now.size === 0) continue;
        const location = dom.nodeLocation(el) as StartTagLocation | null;

        for (const attr of MOTION_ATTRS) {
            const oldValue = was.get(attr);
            const newValue = now.get(attr);
            if (oldValue === newValue) continue;
            const found = location?.attrs?.[attr];
            if (oldValue !== undefined && found) {
                let start = found.startOffset;
                while (start > 0 && /\s/.test(html[start - 1] ?? '')) start--;
                edits.push({ start, end: found.endOffset, text: '' });
            }
            if (newValue !== undefined && location?.startTag) {
                const end = location.startTag.endOffset;
                const at = html[end - 2] === '/' ? end - 2 : end - 1;
                edits.push({ start: at, end: at, text: ` ${attr}="${newValue}"` });
            }
        }
    }
    return edits;
}

/** The direction's palette nearest the readable colors; with none readable, its first palette. */
function closestPalette(direction: Direction, colors: (Rgb | null)[]): string[] {
    let best: string[] = PALETTES[direction][0]!.slice(1);
    let bestDistance = Infinity;
    for (const [, ...palette] of PALETTES[direction]) {
        let distance = 0;
        colors.forEach((color, index) => {
            const target = parseColor(palette[index]);
            if (color && target) distance += color.reduce((sum, channel, c) => sum + (channel - target[c]!) ** 2, 0);
        });
        if (distance < bestDistance) {
            best = palette;
            bestDistance = distance;
        }
    }
    return best;
}

/** The first font name in a stack, or the default's when it cannot safely go in a URL. */
function fontFamily(value: string | undefined, fallback: string): string {
    const first = (stack: string) => stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    const family = first(value ?? '');
    return /^[A-Za-z0-9 ]+$/.test(family) && !GENERIC_FAMILIES.has(family.toLowerCase()) ? family : first(fallback);
}

function hasFontLink(doc: Document): boolean {
    return Array.from(doc.querySelectorAll('link')).some(link =>
        /(^|\s)stylesheet(\s|$)/i.test(link.getAttribute('rel') ?? '')
        && /^https:\/\/fonts\.googleapis\.com\//i.test(link.getAttribute('href') ?? ''));
}

function fontLink(families: string[]): string {
    const params = [...new Set(families)]
        .map(family => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700`)
        .join('&amp;');
    return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${params}&amp;display=swap">\n`;
}

function tokenEdits(html: string, dom: JSDOM, direction: Direction, repairs: Set<string>): TextEdit[] {
    const doc = dom.window.document;
    const endTagStart = (el: Element) => (dom.nodeLocation(el) as StartTagLocation | null)?.endTag?.startOffset;
    const plainStyles = Array.from(doc.head.querySelectorAll('style'))
        .filter(style => !Array.from(style.attributes).some(attr => attr.name.startsWith('data-apexium')));
    const lastStyle = plainStyles[plainStyles.length - 1];
    const styleEnd = lastStyle ? endTagStart(lastStyle) : undefined;
    if (styleEnd === undefined) return [];

    const tokens = rootTokens(siteCss(html).join('\n'));
    const defaults = DIRECTION_DEFAULTS[direction];
    const planned = new Map<string, string>();

    // Colors: fill what is missing, then test the page as it would end up.
    const original = COLOR_TOKENS.map(token => parseColor(tokens.get(token)) as Rgb | null);
    const palette = closestPalette(direction, original);
    COLOR_TOKENS.forEach((token, index) => {
        if (!original[index]) planned.set(token, palette[index]!);
    });
    if (planned.size > 0) repairs.add('tokens');

    const colorOf = (token: string) => parseColor(planned.get(token) ?? tokens.get(token));
    const contrastFails = CONTRAST_PAIRS.some(([, fg, bg, min]) => {
        const a = colorOf(fg);
        const b = colorOf(bg);
        return !a || !b || contrastRatio(a, b) < min;
    });
    if (contrastFails) {
        COLOR_TOKENS.forEach((token, index) => planned.set(token, palette[index]!));
        repairs.add('contrast');
    }

    // Everything else has one default per direction.
    const others: [string, string][] = [['--radius', defaults.radius], ['--space', defaults.space]];
    for (const [token, value] of others) {
        if (tokens.has(token)) continue;
        planned.set(token, value);
        repairs.add('tokens');
    }
    const fonts: [string, string][] = [['--font-heading', defaults.heading], ['--font-body', defaults.body]];
    for (const [token, value] of fonts) {
        if (tokens.has(token)) continue;
        planned.set(token, value);
        repairs.add('tokens');
        repairs.add('fonts');
    }

    const edits: TextEdit[] = [];
    if (planned.size > 0) {
        const rule = [...planned].map(([token, value]) => `${token}:${value}`).join(';');
        edits.push({ start: styleEnd, end: styleEnd, text: `\n:root{${rule}}\n` });
    }

    const headEnd = endTagStart(doc.head);
    if (headEnd !== undefined && !hasFontLink(doc)) {
        const families = fonts.map(([token, fallback]) => fontFamily(planned.get(token) ?? tokens.get(token), fallback));
        edits.push({ start: headEnd, end: headEnd, text: fontLink(families) });
        repairs.add('fonts');
    }
    return edits;
}

export function repairCreatedSite(html: string): RepairResult {
    const dom = parseGeneratedHtml(html, { includeNodeLocations: true });
    const body = dom.window.document.body;
    const direction = directionFromHtml(html);
    const repairs = new Set<string>();

    const before = new Map(Array.from(body.querySelectorAll('*')).map(el => [el, motionAttrsOf(el)] as const));
    repairInvalidMotion(body, repairs);
    repairForbiddenTargets(body, repairs);
    repairMotionCap(body, direction ? MOTION_CAPS[direction] : EDIT_MOTION_CAP, repairs);
    if (direction) addMissingMotion(body, direction, repairs);

    const edits = motionEdits(html, dom, before);
    if (direction) edits.push(...tokenEdits(html, dom, direction, repairs));

    // From the last position to the first, so earlier positions stay valid. Reversing first keeps
    // two inserts at one position in their written order.
    let result = html;
    for (const edit of edits.reverse().sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return { html: result, repairs: [...repairs] };
}
