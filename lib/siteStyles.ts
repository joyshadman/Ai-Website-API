import type { EditorComponent, StyleProperties } from './htmlToSchema.js';
import { escapeAttr, normalizeUrl } from './links.js';
import { DIRECTIONS, type Direction } from './designPrompt.js';
import { ANIMATION_BODY_SCRIPT, ANIMATION_HEAD_SCRIPT, ANIMATION_SHEET, animationAttrs } from './animations.js';
import { cleanSiteLogo, type SiteLogo } from './logo.js';

/**
 * Site level styles and the export document for plain CSS projects (spec 0003).
 * Mirrors `Ai-Website/src/lib/siteStyles.ts`; keep the document shape and the
 * safety rules in step.
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

function hasStyles(comp: EditorComponent): boolean {
  const s = comp.styles;
  return !!s && (['desktop', 'tablet', 'mobile'] as const).some(d => declarations(s[d]) !== '');
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
    const sel = `[data-c="${c.id}"]`;
    const d = declarations(c.styles?.desktop);
    const t = declarations(c.styles?.tablet);
    const m = declarations(c.styles?.mobile);
    if (d) base.push(`${sel}{${d}}`);
    if (t) tablet.push(`${sel}{${t}}`);
    if (m) mobile.push(`${sel}{${m}}`);
  }
  let out = base.join('\n');
  if (tablet.length) out += `\n@media (max-width: 1024px){\n${tablet.join('\n')}\n}`;
  if (mobile.length) out += `\n@media (max-width: 640px){\n${mobile.join('\n')}\n}`;
  return out.trim();
}

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
  if (base.mode) next.mode = base.mode;
  if (typeof base.css === 'string' && typeof next.css !== 'string') next.css = base.css;
  return next;
}
