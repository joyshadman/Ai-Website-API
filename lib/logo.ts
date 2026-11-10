import { JSDOM } from 'jsdom';
import { parseGeneratedHtml } from './parseHtml.js';
import { cleanClassName } from './siteStyles.js';

/**
 * The site logo (spec 0008): one cleaned SVG mark per site, carried in HTML by
 * `data-apexium-logo` markers and mirrored into `globalStyles.logo` on import.
 *
 * The cleaner section below is mirrored in `Ai-Website/src/lib/logo.ts`. Keep
 * the two copies identical so the editor's feedback matches what the server stores.
 */

// ─── Shared with the editor copy (keep identical) ────────────────────────────

export type LogoSource = 'ai' | 'user';

export interface SiteLogo {
  /** Output of the logo cleaner: root `<svg>` with a `viewBox`, at most 8 KB. */
  svg: string;
  source: LogoSource;
}

export const LOGO_ATTR = 'data-apexium-logo';
export const LOGO_MAX_BYTES = 8 * 1024;
/** Input longer than this is rejected before parsing. */
export const LOGO_MAX_INPUT = 64 * 1024;
/** The cleaner sets `height="28"`; a 6 to 1 `viewBox` therefore stays within 168px. */
export const LOGO_MARKER_STYLE = 'display:inline-flex;align-items:center;max-width:168px';

const SVG_NS = 'http://www.w3.org/2000/svg';

const canonical = (names: string[]) => new Map(names.map(n => [n.toLowerCase(), n]));

const ELEMENT_NAMES = canonical([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'title',
]);

const ATTR_NAMES = canonical([
  'viewBox', 'xmlns', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'id', 'offset',
  'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'role', 'aria-label',
  'aria-hidden', 'focusable',
]);

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color']);
/** The cleaner writes these on the root itself, so input values are dropped there. */
const ROOT_SET = new Set(['xmlns', 'viewBox', 'width', 'height', 'aria-hidden', 'focusable', 'role', 'aria-label']);

/** Per copy prefixes from an earlier render; stripped so stored ids stay canonical. */
const COPY_PREFIX = /^(?:apx-logo-\d+-)+/;
const VALID_ID = /^[A-Za-z_][\w.-]{0,63}$/;
const TOKEN_COLOR = /^var\(--color-[a-z0-9-]+\)$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Four numbers, positive size, no wider or taller than 6 to 1; normalized to single spaces. */
function cleanViewBox(value: string | null): string | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4 || !parts.every(p => NUMBER.test(p))) return null;
  const [x, y, w, h] = parts.map(Number) as [number, number, number, number];
  if (!(w > 0 && h > 0) || Math.max(w / h, h / w) > 6) return null;
  return [x, y, w, h].join(' ');
}

/** `url(#id)` to its bare id (copy prefix stripped), else `null`. */
function localRef(value: string): string | null {
  const match = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(value.trim());
  return match ? match[1]!.replace(COPY_PREFIX, '') : null;
}

function cleanId(value: string): string | null {
  const id = value.trim().replace(COPY_PREFIX, '');
  return VALID_ID.test(id) ? id : null;
}

/** Element children of `el` that the allowlist keeps (a nested `<svg>` is removed). */
function keptChildren(el: Element): Element[] {
  return Array.from(el.children).filter(c => {
    const name = ELEMENT_NAMES.get(c.localName.toLowerCase());
    return name !== undefined && name !== 'svg';
  });
}

function collectIds(el: Element, ids: Set<string>): void {
  for (const child of keptChildren(el)) {
    const id = child.getAttribute('id');
    const clean = id === null ? null : cleanId(id);
    if (clean) ids.add(clean);
    collectIds(child, ids);
  }
}

function cleanValue(key: string, raw: string, ids: Set<string>, mode: LogoSource): string | null {
  const value = raw.trim();
  const squashed = value.toLowerCase().replace(/\s+/g, '');
  if (/javascript:|vbscript:|data:|expression\(/.test(squashed)) return null;
  if (key === 'id') return cleanId(value);
  if ((key === 'transform' || key === 'gradientTransform') && value.length > 200) return null;
  if (key === 'gradientUnits') return value === 'userSpaceOnUse' || value === 'objectBoundingBox' ? value : null;
  if (squashed.includes('url(')) {
    const ref = localRef(value);
    return ref && ids.has(ref) ? `url(#${ref})` : null;
  }
  if (mode === 'ai' && COLOR_ATTRS.has(key)) {
    if (TOKEN_COLOR.test(value) || value === 'none') return value;
    if (value.toLowerCase() === 'currentcolor') return 'currentColor';
    return 'var(--color-primary)';
  }
  return value;
}

/**
 * Rebuilds a logo from a parsed `<svg>` element using only allowlisted names and
 * escaped values; the parsed markup itself is never reused (AC-3). `ai` mode
 * recolors to the site tokens (AC-2); `user` mode keeps literal colors.
 * Returns `null` when the logo must not be stored.
 */
export function cleanLogoElement(root: Element, mode: LogoSource): string | null {
  if (root.localName.toLowerCase() !== 'svg') return null;
  const viewBox = cleanViewBox(root.getAttribute('viewBox') ?? root.getAttribute('viewbox'));
  if (!viewBox) return null;
  const ids = new Set<string>();
  collectIds(root, ids);

  const build = (el: Element, isRoot: boolean, painted: boolean): string => {
    const name = ELEMENT_NAMES.get(el.localName.toLowerCase())!;
    const attrs: string[] = isRoot ? [`xmlns="${SVG_NS}"`, `viewBox="${viewBox}"`] : [];
    let hasPaint = false;
    for (const attr of Array.from(el.attributes)) {
      const key = ATTR_NAMES.get(attr.name.toLowerCase());
      if (!key || key === 'xmlns' || (isRoot && ROOT_SET.has(key))) continue;
      const value = cleanValue(key, attr.value, ids, mode);
      if (value === null) continue;
      if (key === 'fill' || key === 'stroke') hasPaint = true;
      attrs.push(`${key}="${escapeXml(value)}"`);
    }
    if (isRoot) attrs.push('aria-hidden="true"', 'focusable="false"', 'height="28"');
    // An unpainted shape would draw black; in an AI logo it takes the primary token.
    if (mode === 'ai' && SHAPES.has(name) && !hasPaint && !painted) attrs.push('fill="var(--color-primary)"');
    const inner = name === 'title'
      ? escapeXml((el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100))
      : keptChildren(el).map(child => build(child, false, painted || hasPaint)).join('');
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${name}>`;
  };

  const out = build(root, true, false);
  // Nothing drawable survived (for example only a script): that is not a logo.
  const drawsSomething = [...SHAPES].some(shape => out.includes(`<${shape} `) || out.includes(`<${shape}>`));
  return drawsSomething && new TextEncoder().encode(out).length <= LOGO_MAX_BYTES ? out : null;
}

/** A stored or incoming `{ svg, source }`, cleaned again; `null` when invalid. */
export function cleanSiteLogo(value: unknown): SiteLogo | null {
  if (!value || typeof value !== 'object') return null;
  const { svg, source } = value as Record<string, unknown>;
  if (source !== 'ai' && source !== 'user') return null;
  const clean = cleanLogo(svg, source);
  return clean ? { svg: clean, source } : null;
}

/** Gives every `id` and its `url(#id)` references a per copy prefix, so copies never clash. */
export function prefixLogoIds(svg: string, copy: number): string {
  if (!svg.includes(' id="')) return svg;
  const prefix = `apx-logo-${copy}-`;
  return svg
    .replace(/ id="([^"]+)"/g, (_, id: string) => ` id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}${id})`);
}

/** One marker holding the logo; `attrs` is extra attribute text such as ` class="brand-mark"`. */
export function logoMarkup(logo: SiteLogo, copy: number, attrs = ''): string {
  return `<span ${LOGO_ATTR}="${logo.source}"${attrs} style="${LOGO_MARKER_STYLE}">${prefixLogoIds(logo.svg, copy)}</span>`;
}

// ─── Server only ─────────────────────────────────────────────────────────────

let xmlWindow: JSDOM['window'] | null = null;

/** Parses `text` as XML and cleans it; `null` for anything that is not a clean logo (AC-3). */
export function cleanLogo(text: unknown, mode: LogoSource): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > LOGO_MAX_INPUT) return null;
  try {
    xmlWindow ??= new JSDOM('').window;
    const doc = new xmlWindow.DOMParser().parseFromString(text.trim(), 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) return null;
    return cleanLogoElement(doc.documentElement, mode);
  } catch {
    return null;
  }
}

/** Markers not inside another marker, in document order. */
function topMarkers(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(`[${LOGO_ATTR}]`)).filter(m => !m.parentElement?.closest(`[${LOGO_ATTR}]`));
}

/** The marker's SVG, serialized as XML from the HTML parse, then cleaned. */
function cleanMarker(marker: Element, mode: LogoSource, serializer: XMLSerializer): string | null {
  const svg = marker.querySelector('svg');
  return svg ? cleanLogo(serializer.serializeToString(svg), mode) : null;
}

/** The first `<header>`, else the first `<nav>`: where the brand lives. */
function headerOf(doc: Document): Element | null {
  return doc.querySelector('header') ?? doc.querySelector('nav');
}

/** The header brand marker first, then every other marker in document order (spec 0008 data model). */
function candidates(doc: Document, markers: Element[]): Element[] {
  const header = headerOf(doc);
  const brand = header ? markers.find(m => header.contains(m)) : undefined;
  return brand ? [brand, ...markers.filter(m => m !== brand)] : markers;
}

/** The marker's own source; an empty value (or `new`) takes `fallback`. */
function markerSource(marker: Element, fallback: LogoSource): LogoSource {
  const value = (marker.getAttribute(LOGO_ATTR) ?? '').trim().toLowerCase();
  return value === 'user' || value === 'ai' ? value : fallback;
}

/** The winning logo in a parsed document, or `null` when no marker cleans. */
export function logoFromDocument(doc: Document, fallback: LogoSource = 'ai'): SiteLogo | null {
  const markers = topMarkers(doc);
  if (markers.length === 0 || !doc.defaultView) return null;
  const serializer = new doc.defaultView.XMLSerializer();
  for (const marker of candidates(doc, markers)) {
    const source = markerSource(marker, fallback);
    const svg = cleanMarker(marker, source, serializer);
    if (svg) return { svg, source };
  }
  return null;
}

/** `logoFromDocument` from HTML text; documents without a marker are never parsed. */
export function logoFromHtml(html: string, fallback: LogoSource = 'ai'): SiteLogo | null {
  if (!html.includes(LOGO_ATTR)) return null;
  try {
    return logoFromDocument(parseGeneratedHtml(html, { contentType: 'text/html' }).window.document, fallback);
  } catch {
    return null;
  }
}

// ─── Monogram fallback (AC-4) ────────────────────────────────────────────────

/** Stroke glyphs on a 10 by 12 grid, drawn at (7, 6) inside the 24 by 24 mark. No `<text>`: it is not allowlisted. */
const GLYPHS: Record<string, string> = {
  A: 'M0 12L5 0L10 12M2.2 7.5H7.8',
  B: 'M0 0V12H6A3 3 0 0 0 6 6H0M0 6H5.5A3 3 0 0 0 5.5 0H0',
  C: 'M8.5 1.8A5 6 0 1 0 8.5 10.2',
  D: 'M0 0V12H4A6 6 0 0 0 4 0Z',
  E: 'M10 0H0V12H10M0 6H7',
  F: 'M10 0H0V12M0 6H7',
  G: 'M8.5 1.8A5 6 0 1 0 10 6H5.5',
  H: 'M0 0V12M10 0V12M0 6H10',
  I: 'M5 0V12M2 0H8M2 12H8',
  J: 'M8 0V8A4 4 0 0 1 0 8',
  K: 'M0 0V12M10 0L0 7M3.5 4.8L10 12',
  L: 'M0 0V12H9',
  M: 'M0 12V0L5 7L10 0V12',
  N: 'M0 12V0L10 12V0',
  O: 'M5 0A5 6 0 1 0 5 12A5 6 0 1 0 5 0Z',
  P: 'M0 12V0H5.5A3.25 3.25 0 0 1 5.5 6.5H0',
  Q: 'M5 0A5 6 0 1 0 5 12A5 6 0 1 0 5 0ZM6.5 8.5L10 12',
  R: 'M0 12V0H5.5A3.25 3.25 0 0 1 5.5 6.5H0M5 6.5L10 12',
  S: 'M9.5 2.5C8.5 0.5 1 -0.5 1 3C1 6.5 9.5 5 9.5 9C9.5 12.5 1.5 12.5 0.5 9.5',
  T: 'M0 0H10M5 0V12',
  U: 'M0 0V7A5 5 0 0 0 10 7V0',
  V: 'M0 0L5 12L10 0',
  W: 'M0 0L2.5 12L5 4L7.5 12L10 0',
  X: 'M0 0L10 12M10 0L0 12',
  Y: 'M0 0L5 6L10 0M5 6V12',
  Z: 'M0 0H10L0 12H10',
  0: 'M5 0A4.5 6 0 1 0 5 12A4.5 6 0 1 0 5 0Z',
  1: 'M2 2.5L5.5 0V12M2 12H9',
  2: 'M0.5 3C1 -1 10 -1 9 4C8.5 6 3 9 0 12H10',
  3: 'M0.5 1C3 -0.5 9 0 9 3C9 5.5 6 6 4 6C7 6 10 7 10 9C10 12.5 3 13 0 10.5',
  4: 'M7.5 12V0L0 8.5H10',
  5: 'M9 0H1.5L1 5.5C4 4 10 4.5 10 8C10 12.5 3 13 0 10.5',
  6: 'M8.5 0.5C4 0 0 3 0 8C0 13.5 10 13.5 10 8.5C10 4 2 3.5 0 7.5',
  7: 'M0 0H10L4 12',
  8: 'M5 6C1 6 0.5 0 5 0C9.5 0 9 6 5 6C0 6 0 12 5 12C10 12 10 6 5 6Z',
  9: 'M10 4.5C8 8.5 0 8 0 3.5C0 -1.5 10 -1.5 10 4C10 9 6 12 1.5 11.5',
};

/** The first character of `text` that is a letter or digit, when it is A to Z or 0 to 9; else `null`. */
function initialOf(text: string | null | undefined): string | null {
  const first = /[\p{L}\p{N}]/u.exec(text ?? '')?.[0];
  return first && /^[A-Za-z0-9]$/.test(first) ? first.toUpperCase() : null;
}

/** The monogram: the initial in a rounded square, primary fill, on-primary letter, cleaned like any AI logo. */
export function monogramSvg(text: string | null | undefined, ...more: (string | null | undefined)[]): string | null {
  const letter = [text, ...more].map(initialOf).find(Boolean) ?? 'A';
  const glyph = GLYPHS[letter] ?? GLYPHS.A!;
  return cleanLogo(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="var(--color-primary)"/>`
    + `<path d="${glyph}" transform="translate(7 6)" fill="none" stroke="var(--color-on-primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'ai',
  );
}

// ─── Create: fill markers, or place the monogram (AC-1, AC-4) ────────────────

export type LogoOutcome = 'ai' | 'fallback' | 'none';

export interface CreateLogoResult {
  html: string;
  logo: LogoOutcome;
  /** A marker held an SVG that failed the cleaner. */
  invalid: boolean;
}

interface Edit { start: number; end: number; text: string }

/** An element's source location from `includeNodeLocations` (the jsdom types only declare the base fields). */
interface TagSpan { startOffset: number; endOffset: number }
interface ElementSpan extends TagSpan { startTag?: TagSpan; endTag?: TagSpan }

function spanOf(dom: JSDOM, el: Element): ElementSpan | null {
  return (dom.nodeLocation(el) as ElementSpan | null | undefined) ?? null;
}

function textWithoutLogo(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(`[${LOGO_ATTR}]`).forEach(m => m.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The header's brand: an element whose class names a brand or logo, else its first link. */
function brandOf(header: Element): Element | null {
  const named = Array.from(header.querySelectorAll('*'))
    .find(e => /brand|logo/i.test(e.getAttribute('class') ?? '') && !e.closest('svg'));
  return named ?? header.querySelector('a');
}

function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
}

function applyEdits(html: string, edits: Edit[]): string {
  let out = html;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * After a create: every marker gets the cleaned AI mark (or the monogram when no
 * marker cleans), the header brand and the footer get a marker when they have
 * none, and the original HTML is spliced, never reserialized. No AI request,
 * no credits. A document with no header and no marker is returned unchanged.
 */
export function withCreateLogo(html: string): CreateLogoResult {
  const dom = parseGeneratedHtml(html, { contentType: 'text/html', includeNodeLocations: true });
  const doc = dom.window.document;
  const serializer = new dom.window.XMLSerializer();
  const markers = topMarkers(doc);
  const header = headerOf(doc);
  if (!header && markers.length === 0) return { html, logo: 'none', invalid: false };

  let svg: string | null = null;
  for (const marker of candidates(doc, markers)) {
    svg = cleanMarker(marker, 'ai', serializer);
    if (svg) break;
  }
  const invalid = !svg && markers.some(m => m.querySelector('svg'));
  const headerMarker = header ? markers.find(m => header.contains(m)) : undefined;
  const brand = header && !headerMarker ? brandOf(header) : null;
  let outcome: LogoOutcome = 'ai';
  if (!svg) {
    outcome = 'fallback';
    const brandText = headerMarker?.parentElement ? textWithoutLogo(headerMarker.parentElement) : brand ? textWithoutLogo(brand) : '';
    svg = monogramSvg(brandText, doc.title);
    if (!svg) return { html, logo: 'none', invalid };
  }
  const logo: SiteLogo = { svg, source: 'ai' };

  let copy = 0;
  const edits: Edit[] = [];
  const marker = (cls = '') => logoMarkup(logo, ++copy, cls ? ` class="${cls}"` : '');
  for (const m of markers) {
    const loc = spanOf(dom, m);
    if (loc) edits.push({ start: loc.startOffset, end: loc.endOffset, text: marker(cleanClassName(m.getAttribute('class'))) });
  }

  // The header brand holds the mark before the name; a bare text name moves into a <span>,
  // because the importer keeps only element children (spec 0003).
  if (header && !headerMarker) {
    const target = brand ?? header;
    const loc = spanOf(dom, target);
    if (loc?.startTag) {
      const wrap = brand !== null && hasDirectText(brand) && loc.endTag;
      edits.push({ start: loc.startTag.endOffset, end: loc.startTag.endOffset, text: marker() + (wrap ? '<span>' : '') });
      if (wrap && loc.endTag) edits.push({ start: loc.endTag.startOffset, end: loc.endTag.startOffset, text: '</span>' });
    }
  }

  // The footer shows the same mark; one without a marker gets it as its first child.
  const footer = doc.querySelector('footer');
  if (footer && !markers.some(m => footer.contains(m))) {
    const loc = spanOf(dom, footer);
    if (loc?.startTag) edits.push({ start: loc.startTag.endOffset, end: loc.startTag.endOffset, text: marker() });
  }

  return { html: applyEdits(html, edits), logo: outcome, invalid };
}
