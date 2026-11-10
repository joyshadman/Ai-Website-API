import type { EditorComponent, StyleProperties } from './htmlToSchema.js';
import { escapeAttr, normalizeUrl } from './links.js';
import { DIRECTIONS, type Direction } from './designPrompt.js';
import { ANIMATION_BODY_SCRIPT, ANIMATION_HEAD_SCRIPT, ANIMATION_SHEET, animationAttrs } from './animations.js';
import { cleanSiteLogo, type SiteLogo } from './logo.js';

/**
 * Site level styles and the export document for plain CSS projects (spec 0003).
 * Mirrors `Ai-Website/src/lib/siteStyles.ts`; keep the document shape and the
 * safety rules in step. The marked spec 0013 block must be byte identical in both.
 */

export type Device = 'desktop' | 'tablet' | 'mobile';

export interface SiteStyles {
  /** The only marker of a plain CSS project; absent means legacy Tailwind. */
  mode?: 'css';
  /** The residual sheet: everything that did not move into component styles. */
  css?: string;
  fontLinks?: string[];
  script?: string;
  body?: StyleProperties;
  /** Site icon (spec 0006): an uploaded `/media/...` path or an http(s) URL; `""` means none. */
  favicon?: string;
  /** The generated site's design direction (spec 0007): a read only label, written back as a meta tag. */
  direction?: Direction;
  /** The site logo (spec 0008): always cleaner output. Absent means no logo. */
  logo?: SiteLogo;
  /** Set when the site could not be imported (spec 0013): the editor shows it read only. */
  importFailed?: boolean;
  /** The page's `<title>` and description meta (spec 0013). */
  title?: string;
  description?: string;
}

/** A valid direction, or `null`. */
export function cleanDirection(value: unknown): Direction | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (DIRECTIONS as readonly string[]).includes(text) ? text as Direction : null;
}

/** When the new HTML lost its direction meta, the stored direction stays (spec 0007). */
export function keepDirection(stored: SiteStyles | undefined, next: SiteStyles): SiteStyles {
  const direction = cleanDirection(stored?.direction);
  return direction && !next.direction ? { ...next, direction } : next;
}

/** The favicon as it may be stored: `""`, a `/media/` path, or an http(s) URL; `null` when invalid. */
export function cleanFavicon(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  const text = value.trim();
  if (text === '' || /^\/media\/[^\s"'<>]+$/.test(text)) return text;
  const url = normalizeUrl(text);
  return url && /^https?:/i.test(url) ? url : null;
}

/** A stored favicon survives every rebuild of `pageData` from HTML; rollback keeps the current one (AC-11). */
export function keepFavicon(stored: SiteStyles | undefined, next: SiteStyles): SiteStyles {
  const favicon = stored?.favicon;
  return typeof favicon === 'string' && favicon !== '' ? { ...next, favicon } : next;
}

/** Above any of these the importer skips resolving and keeps the sheet verbatim (AC-14). */
export const LIMITS = { css: 200_000, script: 50_000, fontLinks: 10 };

const LEGACY_BODY = 'margin:0;background:#030712;color:#f1f5f9;font-family:system-ui,-apple-system,sans-serif';
const TAILWIND_SCRIPT = '<script src="https://cdn.tailwindcss.com"></script>';
/** Ids allowed in `data-c`: uuids from the importer and `e12_ab3cd` ids from the editor. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isFontLink(url: string): boolean {
  try { return new URL(url).origin === 'https://fonts.googleapis.com'; } catch { return false; }
}

/** Keeps only `[A-Za-z0-9_-]` class tokens; `apx-` tokens are live animation state, never site classes. */
export function cleanClassName(value: string | null | undefined): string {
  return (value ?? '').split(/\s+/).filter(t => /^[A-Za-z0-9_-]+$/.test(t) && !t.startsWith('apx-')).join(' ');
}

/** Collected while rendering: components that need a `[data-c]` rule, and whether anything animates. */
export interface ExportState {
  styled: EditorComponent[];
  animated: boolean;
}

/** `<\/` reads the same as `</` inside CSS and JS strings, but can never close the tag. */
function escapeClose(text: string, tag: 'style' | 'script'): string {
  return text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
}

function cssProperty(key: string): string {
  if (key.startsWith('--')) return key;
  if (key === 'backgroundGradient') return 'background-image';
  return key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

/** `prop:value` pairs for a style object; a value holding `{` or `}` is dropped. */
export function declarations(styles: StyleProperties | undefined): string {
  return Object.entries(styles ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !/[{}]/.test(String(v)))
    .map(([k, v]) => `${cssProperty(k)}:${String(v)}`)
    .join(';');
}

/** What a component exports for a device: on an `element` node, only what the panel changed (spec 0013). */
function exportedStyles(comp: EditorComponent, device: Device): StyleProperties | undefined {
  const styles = comp.styles?.[device];
  return comp.type === 'element' ? editedStylesFor(styles, comp.editedStyles, device) : styles;
}

function hasStyles(comp: EditorComponent): boolean {
  return (['desktop', 'tablet', 'mobile'] as const).some(d => declarations(exportedStyles(comp, d)) !== '');
}

/**
 * The `data-c`, `class`, and `data-apx-*` attributes for a component's outer
 * element. A component with styles is added to `state.styled`, which feeds the
 * generated sheet; an animated one sets `state.animated`.
 */
export function elementAttrs(comp: EditorComponent, state: ExportState): string {
  let attrs = '';
  if (SAFE_ID.test(comp.id) && hasStyles(comp)) {
    attrs += ` data-c="${comp.id}"`;
    state.styled.push(comp);
  }
  const cls = cleanClassName(comp.className);
  if (cls) attrs += ` class="${cls}"`;
  const anim = animationAttrs(comp.animation, comp.type);
  if (anim) {
    attrs += anim;
    state.animated = true;
  }
  return attrs;
}

/** One `[data-c]` rule per styled component, tablet and mobile deltas in their media blocks. */
function elementRules(styled: EditorComponent[]): string {
  const base: string[] = [];
  const tablet: string[] = [];
  const mobile: string[] = [];
  for (const c of styled) {
    const one = `[data-c="${c.id}"]`;
    // Doubled on `element` nodes, so a hand edit beats the site's own rules (spec 0013 AC-15).
    const sel = c.type === 'element' ? one + one : one;
    const push = (list: string[], device: Device) => {
      const text = declarations(exportedStyles(c, device));
      if (text) list.push(`${sel}{${text}}`);
    };
    push(base, 'desktop');
    push(tablet, 'tablet');
    push(mobile, 'mobile');
  }
  let out = base.join('\n');
  if (tablet.length) out += `\n@media (max-width: 1024px){\n${tablet.join('\n')}\n}`;
  if (mobile.length) out += `\n@media (max-width: 640px){\n${mobile.join('\n')}\n}`;
  return out.trim();
}

// === spec 0013 shared block start ===
/** What a generic element is, worked out from its tag and contents. Never stored. */
export type ElementKind = 'svg' | 'image' | 'field' | 'text' | 'leaf' | 'link' | 'box';

/** Tags that may stay inside a text block's markup. */
export const INLINE_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'br', 'small', 'sub', 'sup', 'mark', 'code', 'span', 'abbr', 'a']);
export const VOID_TAGS: ReadonlySet<string> = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'source', 'track', 'wbr']);

const BANNED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'object', 'embed', 'base', 'meta', 'link', 'html', 'head', 'body', 'frame', 'frameset', 'template']);
const SVG_TAGS: ReadonlySet<string> = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'clippath', 'mask', 'symbol', 'use', 'text', 'tspan', 'filter']);
const SELECT_TAGS: ReadonlySet<string> = new Set(['option', 'optgroup']);
const INLINE_ATTRS: ReadonlySet<string> = new Set(['class', 'id', 'lang', 'dir', 'href', 'target', 'rel', 'title', 'style']);
const SELECT_ATTRS: ReadonlySet<string> = new Set(['value', 'label', 'selected', 'disabled']);
const URL_ATTRS: ReadonlySet<string> = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);
const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel']);
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };
const TAG_NAME = /^[a-z][a-z0-9-]*$/;
const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const TAG_TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*(\/?)>/y;
const ATTR_TOKEN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g;
const MAX_VALUE = 4000;
const MAX_MARKUP = 100000;

export type MarkupMode = 'inline' | 'svg' | 'select';

export function elementKind(node: Pick<EditorComponent, 'tag' | 'props'>): ElementKind {
  const tag = node.tag ?? '';
  if (tag === 'svg') return 'svg';
  if (tag === 'img') return 'image';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'field';
  if (tag === '#text' || typeof node.props?.html === 'string') return 'text';
  if (VOID_TAGS.has(tag) || tag === 'iframe') return 'leaf';
  return tag === 'a' ? 'link' : 'box';
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);?/gi, (whole: string, body: string) => {
    if (body.charAt(0) !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function isSafeUrl(value: string, httpsOnly: boolean): boolean {
  const compact = value.replace(/[\u0000- \u007f-\u009f]+/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (httpsOnly) return !!scheme && (scheme[1] as string).toLowerCase() === 'https';
  return !scheme || SAFE_SCHEMES.has((scheme[1] as string).toLowerCase());
}

/** Drops any declaration that could load or run something it shouldn't. */
export function cleanStyleValue(value: string): string {
  return value.split(';').filter(declaration => {
    if (/expression|behavior|-moz-binding|@import|</i.test(declaration)) return false;
    for (const match of declaration.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) {
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(match[1] ?? '');
      if (scheme && !/^https?$/i.test(scheme[1] as string)) return false;
    }
    return true;
  }).join(';');
}

function cleanAttrValue(tag: string, name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (!ATTR_NAME.test(name) || lower.startsWith('on') || lower === 'srcdoc' || value.length > MAX_VALUE) return null;
  if (lower === 'style') return cleanStyleValue(value);
  if (URL_ATTRS.has(lower) && !isSafeUrl(value, tag === 'iframe' && lower === 'src')) return null;
  return value;
}

function allowedInMarkup(mode: MarkupMode, lower: string): boolean {
  if (mode === 'inline') return INLINE_TAGS.has(lower);
  if (mode === 'select') return SELECT_TAGS.has(lower);
  return SVG_TAGS.has(lower) || /^fe[a-z]+$/.test(lower);
}

function markupAttrs(mode: MarkupMode, tag: string, raw: string): string {
  let out = '';
  for (const match of raw.matchAll(ATTR_TOKEN)) {
    const name = match[1] as string;
    const lower = name.toLowerCase();
    if (mode === 'inline' && !INLINE_ATTRS.has(lower) && !lower.startsWith('aria-')) continue;
    if (mode === 'select' && !SELECT_ATTRS.has(lower)) continue;
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    if (mode === 'svg' && (lower === 'href' || lower === 'xlink:href') && !value.startsWith('#')) continue;
    const clean = cleanAttrValue(tag, name, value);
    if (clean !== null) out += ` ${name}="${escapeAttr(clean)}"`;
  }
  return out;
}

/** Rebuilds markup from allowed tags only. The same text gives the same result in the browser and in Node. */
export function cleanMarkup(html: string, mode: MarkupMode): string {
  if (html.length > MAX_MARKUP) return '';
  let out = '';
  let at = 0;
  let skipDepth = 0;
  let skipName = '';
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open === -1) {
      if (skipDepth === 0) out += html.slice(at);
      break;
    }
    if (skipDepth === 0) out += html.slice(at, open);
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    TAG_TOKEN.lastIndex = open;
    const token = TAG_TOKEN.exec(html);
    if (!token) {
      if (skipDepth === 0) out += '&lt;';
      at = open + 1;
      continue;
    }
    at = open + token[0].length;
    const closing = token[1] === '/';
    const name = token[2] as string;
    const lower = name.toLowerCase();
    const selfClosed = token[4] === '/';
    if (skipDepth > 0) {
      if (lower === skipName) skipDepth += closing ? -1 : selfClosed ? 0 : 1;
      continue;
    }
    if (!allowedInMarkup(mode, lower)) {
      if (mode !== 'svg') out += escapeText(token[0]);
      else if (!closing && !selfClosed) {
        skipDepth = 1;
        skipName = lower;
      }
      continue;
    }
    if (closing) out += `</${name}>`;
    else out += `<${name}${markupAttrs(mode, lower, token[3] ?? '')}${selfClosed && mode === 'svg' ? '/>' : '>'}`;
  }
  return out;
}

function cleanFields(node: EditorComponent): { tag: string; attrs: Record<string, string>; html: string | undefined } | null {
  const tag = typeof node.tag === 'string' ? node.tag : '';
  if (tag !== '#text' && (!TAG_NAME.test(tag) || BANNED_TAGS.has(tag))) return null;
  const attrs: Record<string, string> = {};
  const source = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string' || /^(class|data-c|data-editor-id|data-apx-.*)$/i.test(name)) continue;
    const clean = cleanAttrValue(tag, name, value);
    if (clean !== null && !(name.toLowerCase() === 'style' && clean.trim() === '')) attrs[name] = clean;
  }
  const raw = typeof node.props?.html === 'string' ? node.props.html as string : undefined;
  let html: string | undefined;
  if (raw !== undefined && !VOID_TAGS.has(tag)) {
    if (tag === '#text') html = raw.length > MAX_MARKUP ? '' : raw;
    else if (tag === 'textarea') html = raw.length > MAX_MARKUP ? '' : raw.replace(/</g, '&lt;');
    else html = cleanMarkup(raw, tag === 'svg' ? 'svg' : tag === 'select' ? 'select' : 'inline');
  }
  return { tag, attrs, html };
}

/** A node safe to store: bad `element` nodes are dropped, older types pass through unchanged. */
export function cleanNode(node: EditorComponent): EditorComponent | null {
  if (!node || typeof node !== 'object') return null;
  const children = Array.isArray(node.children) ? node.children.flatMap(child => {
    const clean = cleanNode(child);
    return clean ? [clean] : [];
  }) : undefined;
  if (node.type !== 'element') return children ? { ...node, children } : node;
  const fields = cleanFields(node);
  if (!fields) return null;
  const props: Record<string, any> = { ...node.props };
  if (fields.html === undefined) delete props.html;
  else props.html = fields.html;
  const next: EditorComponent = { ...node, tag: fields.tag, attrs: fields.attrs, props, children: children ?? [] };
  const kind = elementKind(next);
  return kind === 'link' || kind === 'box' ? next : { ...next, children: [] };
}

/** Every page with its `element` nodes cleaned. */
export function cleanPageNodes<T extends { components: EditorComponent[] }>(pages: T[]): T[] {
  return pages.map(page => Array.isArray(page.components)
    ? { ...page, components: page.components.flatMap(node => { const clean = cleanNode(node); return clean ? [clean] : []; }) }
    : page);
}

export interface RenderElementOptions {
  /** `href` and friends from the exporter's own link rules, or null. */
  link: string | null;
  /** The exporter's already rendered children. */
  children: string;
  anchor: string | undefined;
  state: ExportState;
  /** Adds `data-editor-id`, for the editor canvas only. */
  editor: boolean;
}

export function renderElement(node: EditorComponent, options: RenderElementOptions): string {
  const fields = cleanFields(node);
  if (!fields) return '';
  const { tag, attrs, html } = fields;
  if (tag === '#text') return escapeText(html ?? '');
  let out = `<${tag}`;
  if (options.anchor) out += ` id="${escapeAttr(options.anchor)}"`;
  out += elementAttrs(node, options.state);
  if (options.editor) out += ` data-editor-id="${escapeAttr(node.id)}"`;
  if (options.link) out += ` ${options.link}`;
  for (const [name, value] of Object.entries(attrs)) {
    const lower = name.toLowerCase();
    if (lower === 'id' && options.anchor) continue;
    if (options.link && (lower === 'href' || lower === 'target' || (lower === 'rel' && options.link.includes(' rel=')))) continue;
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  out += '>';
  if (VOID_TAGS.has(tag)) return out;
  return `${out}${html ?? options.children}</${tag}>`;
}

/** The properties changed in the styles panel on this device, read from `device:property` entries. */
export function editedStylesFor(styles: StyleProperties | undefined, edited: readonly string[] | undefined, device: Device): StyleProperties {
  const marked: readonly string[] = Array.isArray(edited) ? edited : [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styles ?? {})) if (marked.includes(`${device}:${key}`)) out[key] = value;
  return out as StyleProperties;
}
// === spec 0013 shared block end ===

/** The full published document around a rendered body (spec 0003 export). */
export function siteDocument(body: string, state: ExportState, site: SiteStyles = {}): string {
  const css = site.mode === 'css';
  const fonts = (site.fontLinks ?? []).filter(isFontLink).slice(0, LIMITS.fontLinks)
    .map(href => `<link rel="stylesheet" href="${escapeAttr(href)}">`).join('');
  const bodyRule = css ? declarations(site.body) : LEGACY_BODY;
  const rules = [bodyRule ? `body{${bodyRule}}` : '', elementRules(state.styled)].filter(Boolean).join('\n');
  // Animation presets (spec 0004): only when something animates, after the generated sheet so presets win ties.
  const anim = state.animated;
  const favicon = cleanFavicon(site.favicon);
  const direction = cleanDirection(site.direction);
  const head = '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + (site.title ? `<title>${escapeText(site.title)}</title>` : '')
    + (site.description ? `<meta name="description" content="${escapeAttr(site.description)}">` : '')
    + (direction ? `<meta name="apexium-direction" content="${direction}">` : '')
    + (favicon ? `<link rel="icon" href="${escapeAttr(favicon)}">` : '')
    + fonts
    + (css ? '' : TAILWIND_SCRIPT)
    + (css && site.css ? `<style data-apexium-site>${escapeClose(site.css, 'style')}</style>` : '')
    + (rules ? `<style data-apexium-elements>${escapeClose(rules, 'style')}</style>` : '')
    + (anim ? `<style data-apexium-anim>${ANIMATION_SHEET}</style>${ANIMATION_HEAD_SCRIPT}` : '');
  const script = (anim ? ANIMATION_BODY_SCRIPT : '')
    + (css && site.script ? `<script data-apexium-site>${escapeClose(site.script, 'script')}</script>` : '');
  return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}${script}</body></html>`;
}

/** Merges an incoming `globalStyles` by key; `mode` and `css` are never removed (AC-10). */
export function mergeSiteStyles(stored: SiteStyles | undefined, incoming: unknown): SiteStyles {
  const base: SiteStyles = stored && typeof stored === 'object' ? { ...stored } : {};
  if (!incoming || typeof incoming !== 'object') return base;
  const next: SiteStyles = { ...base, ...(incoming as SiteStyles) };
  // An invalid incoming favicon is dropped, so the stored one stays (spec 0006).
  if ('favicon' in (incoming as object)) {
    const favicon = cleanFavicon((incoming as SiteStyles).favicon);
    if (favicon === null) {
      if (base.favicon === undefined) delete next.favicon; else next.favicon = base.favicon;
    } else next.favicon = favicon;
  }
  // The direction is a read only label: an invalid incoming value never replaces the stored one (spec 0007).
  if ('direction' in (incoming as object)) {
    const direction = cleanDirection((incoming as SiteStyles).direction);
    if (direction) next.direction = direction;
    else if (base.direction === undefined) delete next.direction;
    else next.direction = base.direction;
  }
  // The logo (spec 0008): `null` removes it, an unchanged SVG keeps the stored source, and an
  // invalid one is never stored, so the stored logo stays (AC-3, AC-6).
  if ('logo' in (incoming as object)) {
    const raw = (incoming as { logo?: unknown }).logo;
    const rawSvg = raw && typeof raw === 'object' ? (raw as { svg?: unknown }).svg : undefined;
    const clean = raw === null ? null : base.logo && rawSvg === base.logo.svg ? base.logo : cleanSiteLogo(raw);
    if (clean) next.logo = clean;
    else if (raw !== null && base.logo) next.logo = base.logo;
    else delete next.logo;
  }
  // Set only by the importer, never by a client (spec 0013).
  for (const key of ['importFailed', 'title', 'description'] as const) {
    if (base[key] === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = base[key];
  }
  if (base.mode) next.mode = base.mode;
  if (typeof base.css === 'string' && typeof next.css !== 'string') next.css = base.css;
  return next;
}
