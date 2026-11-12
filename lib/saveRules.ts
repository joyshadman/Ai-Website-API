/*
 * Server side rules for editor saves (spec 0031). Server only on purpose: lib/siteStyles.ts is hand
 * mirrored in the frontend, and these rules belong to the API alone.
 */
import { mergeSiteStyles, type SiteStyles } from './siteStyles.js';

export const MAX_EMBED_CHARS = 50_000;
export const EMBED_TOO_LARGE = 'An HTML embed is too large. Keep each embed under 50,000 characters.';

export class SaveRuleError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

/** Tags that change how a whole page loads; an embed may not carry them (AC-3). */
const STRIP: [RegExp, string][] = [
    [/<base\b[^>]*>/gi, 'a <base> tag'],
    [/<meta\b[^>]*>/gi, 'a <meta> tag'],
    [/<!doctype[^>]*>/gi, 'a <!doctype>'],
    [/<\/?(?:html|head|body)\b[^>]*>/gi, 'a page wrapper tag'],
    [/<\/?frameset\b[^>]*>/gi, 'a <frameset> tag'],
];

export function cleanEmbedHtml(html: string, removed: Set<string>): string {
    let out = html;
    for (const [pattern, label] of STRIP) {
        const next = out.replace(pattern, '');
        if (next !== out) removed.add(label);
        out = next;
    }
    return out;
}

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown };

function walk(nodes: unknown, removed: Set<string>): unknown {
    if (!Array.isArray(nodes)) return nodes;
    return nodes.map((raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const node = raw as Node;
        let next: Node = node;
        if (node.type === 'html-embed' && typeof node.props?.html === 'string') {
            const html = node.props.html as string;
            if (html.length > MAX_EMBED_CHARS) throw new SaveRuleError(EMBED_TOO_LARGE);
            next = { ...node, props: { ...node.props, html: cleanEmbedHtml(html, removed) } };
        }
        return Array.isArray(next.children) ? { ...next, children: walk(next.children, removed) } : next;
    });
}

/** Checks and cleans every embed in the pages; throws SaveRuleError when one is too large (AC-2, AC-3). */
export function applyEmbedRules<T extends { components?: unknown }>(pages: T[]): { pages: T[]; removed: string[] } {
    const removed = new Set<string>();
    const out = pages.map(page => (page && typeof page === 'object' && Array.isArray(page.components)
        ? { ...page, components: walk(page.components, removed) }
        : page));
    return { pages: out as T[], removed: [...removed] };
}

/** mergeSiteStyles, with css, script, and mode owned by the server: a request can't set them (AC-1). */
export function mergeSiteStylesForSave(stored: SiteStyles | undefined, incoming: unknown): SiteStyles {
    if (!incoming || typeof incoming !== 'object') return mergeSiteStyles(stored, incoming);
    const { css: _css, script: _script, mode: _mode, ...rest } = incoming as SiteStyles;
    const merged = mergeSiteStyles(stored, rest);
    for (const key of ['css', 'script', 'mode'] as const) {
        if (stored && stored[key] !== undefined) (merged as Record<string, unknown>)[key] = stored[key];
        else delete (merged as Record<string, unknown>)[key];
    }
    return merged;
}
