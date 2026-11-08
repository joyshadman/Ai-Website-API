import { DELAY_VALUES, ENTRANCE_PRESETS, HOVER_PRESETS, SPEEDS } from './animations.js';
import { DIRECTIONS, EDIT_MOTION_CAP, MOTION_CAPS, REQUIRED_TOKENS, type Direction } from './designPrompt.js';

/**
 * Cheap structural checks on generated HTML (spec 0007 AC-9). They only report: a failing site
 * still saves, costs nothing more, and triggers no extra AI request.
 */

export interface DesignCheckResult {
  direction: Direction | null;
  legacy: boolean;
  passed: boolean;
  failures: string[];
  animated: number;
  cssLines: number;
}

type Attrs = Map<string, string>;

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = new Map();
  for (const m of raw.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Every start tag with its name, attributes, and whether it sits inside a <form> (comments removed first). */
function startTags(html: string): { tag: string; attrs: Attrs; inForm: boolean }[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  let formDepth = 0;
  const tags: { tag: string; attrs: Attrs; inForm: boolean }[] = [];
  for (const m of clean.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[2]!.toLowerCase();
    if (m[1]) { if (tag === 'form') formDepth = Math.max(0, formDepth - 1); continue; }
    tags.push({ tag, attrs: parseAttrs(m[3] ?? ''), inForm: formDepth > 0 });
    if (tag === 'form') formDepth++;
  }
  return tags;
}

export function directionFromHtml(html: string): Direction | null {
  for (const { tag, attrs } of startTags(html)) {
    if (tag === 'meta' && attrs.get('name')?.toLowerCase() === 'apexium-direction') {
      const value = attrs.get('content')?.trim().toLowerCase() ?? '';
      return (DIRECTIONS as readonly string[]).includes(value) ? value as Direction : null;
    }
  }
  return null;
}

/** The site's stylesheet text: head <style> blocks except the preset sheet and the editor's element rules. */
function siteCss(html: string): string[] {
  return [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)]
    .filter(m => !/data-apexium-(anim|elements)\b/i.test(m[1] ?? ''))
    .map(m => m[2] ?? '');
}

/** Custom properties from top level `:root` rules only (not inside @media); the last definition wins. */
function rootTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) { selector = text.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const body = text.slice(start, i);
        if (!selector.startsWith('@') && selector.split(',').some(s => s.trim() === ':root')) {
          for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) tokens.set(d[1]!, d[2]!.trim());
        }
        start = i + 1;
      }
    }
  }
  return tokens;
}

/** A plain hex, rgb(), or hsl() color as 0 to 255 channels; anything else (var(), names) is unreadable. */
export function parseColor(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,\/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const num = (p: string, max: number) => p.endsWith('%') ? parseFloat(p) / 100 * max : parseFloat(p);
  if (fn[1]!.startsWith('rgb')) {
    const rgb = parts.map(p => num(p, 255));
    return rgb.every(Number.isFinite) ? rgb.map(c => Math.min(255, Math.max(0, c))) as [number, number, number] : null;
  }
  const h = ((parseFloat(parts[0]!) % 360) + 360) % 360;
  const s = num(parts[1]!, 1);
  const l = num(parts[2]!, 1);
  if (![h, s, l].every(Number.isFinite)) return null;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** WCAG 2 contrast ratio of two colors. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const ch = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Presets here are dropped by the editor importer or break inline layout (spec 0007, updated). */
const FORBIDDEN_TARGETS = new Set(['header', 'nav', 'footer', 'a', 'span', 'em', 'ul', 'li', 'figure', 'dt', 'dd']);
/** The checks that still run on an edit of a site made before spec 0007 (no direction meta). */
const LEGACY_CHECKS = new Set(['motion-too-many', 'motion-invalid', 'motion-forbidden-target', 'reveal-script', 'reduced-motion', 'css-long']);

export function checkDesign(html: string, options: { kind: 'create' | 'edit'; legacy: boolean }): DesignCheckResult {
  const failures: string[] = [];
  const fail = (id: string) => { if (!options.legacy || LEGACY_CHECKS.has(id)) failures.push(id); };
  const tags = startTags(html);
  const direction = directionFromHtml(html);
  if (!direction) fail('direction');

  // Tokens and fonts
  const cssBlocks = siteCss(html);
  const css = cssBlocks.join('\n');
  const tokens = rootTokens(css);
  if (REQUIRED_TOKENS.some(t => !tokens.has(t))) fail('tokens');
  const hasFontLink = tags.some(({ tag, attrs }) => tag === 'link' && /(^|\s)stylesheet(\s|$)/i.test(attrs.get('rel') ?? '')
    && /^https:\/\/fonts\.googleapis\.com\//i.test(attrs.get('href') ?? ''));
  if (!hasFontLink || !tokens.has('--font-heading') || !tokens.has('--font-body')) fail('fonts');

  // Contrast from the token colors
  const pairs: [string, string, string, number][] = [
    ['contrast-text', '--color-text', '--color-bg', 4.5],
    ['contrast-primary', '--color-on-primary', '--color-primary', 4.5],
    ['contrast-muted', '--color-muted', '--color-bg', 3],
  ];
  const unreadable = new Set<string>();
  for (const [id, fg, bg, min] of pairs) {
    if (!tokens.has(fg) || !tokens.has(bg)) continue;
    const a = parseColor(tokens.get(fg));
    const b = parseColor(tokens.get(bg));
    if (!a) unreadable.add(fg);
    if (!b) unreadable.add(bg);
    if (a && b && contrastRatio(a, b) < min) fail(id);
  }
  // Named after the tokens, like `contrast-unreadable:--color-bg`.
  if (unreadable.size) fail(`contrast-unreadable:${[...unreadable].join(',')}`);

  // Motion
  const animated = tags.filter(t => t.attrs.has('data-apx-anim'));
  if (animated.length === 0) fail('motion-none');
  const cap = options.kind === 'create' && direction ? MOTION_CAPS[direction] : EDIT_MOTION_CAP;
  if (animated.length > cap) fail('motion-too-many');
  const invalid = tags.some(({ attrs }) =>
    (attrs.has('data-apx-anim') && !(ENTRANCE_PRESETS as readonly string[]).includes(attrs.get('data-apx-anim')!))
    || (attrs.has('data-apx-speed') && !(SPEEDS as readonly string[]).includes(attrs.get('data-apx-speed')!))
    || (attrs.has('data-apx-delay') && !DELAY_VALUES.includes(attrs.get('data-apx-delay')!))
    || (attrs.has('data-apx-hover') && !(HOVER_PRESETS as readonly string[]).includes(attrs.get('data-apx-hover')!)));
  if (invalid) fail('motion-invalid');
  if (animated.some(t => FORBIDDEN_TARGETS.has(t.tag) || t.inForm)) fail('motion-forbidden-target');

  // Scripts, reduced motion, length
  const revealScript = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .some(m => !/\bsrc\s*=/i.test(m[1] ?? '') && !/data-apexium-anim\b/i.test(m[1] ?? '') && /IntersectionObserver/.test(m[2] ?? ''));
  if (revealScript) fail('reveal-script');
  if (/\btransition\s*:|\banimation(-name)?\s*:|@keyframes\b/i.test(css) && !/prefers-reduced-motion/i.test(css)) fail('reduced-motion');
  const cssLines = cssBlocks.reduce((n, block) => n + block.trim().split('\n').filter(Boolean).length, 0);
  if (cssLines > 400) fail('css-long');

  return { direction, legacy: options.legacy, passed: failures.length === 0, failures, animated: animated.length, cssLines };
}
