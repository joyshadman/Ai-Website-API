import { JSDOM, type ConstructorOptions } from 'jsdom';

/**
 * Parses generated HTML without letting jsdom's strict CSS parser see it (spec 0013). Free models
 * sometimes write values like `clamp(3rem,5vw,4. hinge)`, and that parser throws on them, which
 * used to cost the page its repairs, its logo, and its editor import. Browsers just skip such a
 * declaration. Everything is replaced by spaces of the same length, so node locations still match
 * the original text.
 */

const TOKENS = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)|<[a-zA-Z](?:"[^"]*"|'[^']*'|[^<>"'])*>/gi;
const STYLE_ATTR = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

const blank = (text: string) => ' '.repeat(text.length);

/** Whether jsdom accepts this text in a `style` attribute, tried on a small real page. */
function acceptsDeclaration(declaration: string): boolean {
    try {
        new JSDOM(`<div style="${declaration.replace(/"/g, '&quot;')}"></div>`);
        return true;
    } catch {
        return false;
    }
}

/** Blanks only the declarations in a tag's `style` attribute that would make jsdom throw. */
function withSafeStyleAttr(tag: string): string {
    return tag.replace(STYLE_ATTR, (whole: string, name: string, double?: string, single?: string) => {
        const value = double ?? single ?? '';
        if (acceptsDeclaration(value)) return whole;
        const safe = value.split(';').map(part => acceptsDeclaration(part) ? part : blank(part)).join(';');
        const quote = double !== undefined ? '"' : "'";
        return `${name}${quote}${safe}${quote}`;
    });
}

function forParser(html: string): string {
    return html.replace(TOKENS, (token: string, open?: string, css?: string, close?: string) => {
        if (open !== undefined) return `${open}${blank(css ?? '')}${close}`;
        return /^<(!--|script\b)/i.test(token) ? token : withSafeStyleAttr(token);
    });
}

export function parseGeneratedHtml(html: string, options: ConstructorOptions = {}): JSDOM {
    return new JSDOM(forParser(html), options);
}

export function parseGeneratedFragment(html: string): DocumentFragment {
    return JSDOM.fragment(forParser(html));
}

/** Every `<style>` element's opening tag and text from the original HTML, in document order. */
export function styleElements(html: string): { open: string; text: string }[] {
    const found: { open: string; text: string }[] = [];
    for (const match of html.matchAll(TOKENS)) {
        if (match[1] !== undefined) found.push({ open: match[1], text: match[2] ?? '' });
    }
    return found;
}
