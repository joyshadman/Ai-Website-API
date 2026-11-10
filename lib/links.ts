import type { EditorComponent } from './htmlToSchema.js';

/**
 * Typed links on editor elements (spec 0002). Mirrors `Ai-Website/src/lib/links.ts`;
 * keep the URL rules, slug and anchor rules, and the switcher script in step.
 */

export type LinkKind = 'url' | 'page' | 'section' | 'file';

export interface ElementLink {
  kind: LinkKind;
  url?: string;
  pageId?: string;
  targetId?: string;
  /** File links only: the "Save as" name (spec 0009). */
  fileName?: string;
  newTab: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  link?: ElementLink;
}

export interface Page {
  id: string;
  name: string;
  slug: string;
  components: EditorComponent[];
}

/** Element types that can carry a `link`; also the section link target list. */
export const LINKABLE_TYPES: ReadonlySet<string> = new Set([
  'button', 'text', 'heading', 'image', 'icon', 'card', 'container', 'section', 'row', 'column', 'element',
]);

/** An uploaded file's URL; anything else publishes no File link (spec 0009 AC-11). */
const MEDIA_FILE_RE = /^\/media\/projects\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9-]{1,64}\.[a-z0-9]{1,5}$/;

export function isMediaFileUrl(value: unknown): boolean {
  return typeof value === 'string' && MEDIA_FILE_RE.test(value);
}

/**
 * The "Save as" name (spec 0009 AC-2): unsafe and direction override characters out, ends trimmed,
 * any typed extension replaced by the real one from `url`, at most 200 characters in all.
 */
export function cleanDownloadName(name: unknown, url: string): string {
  const ext = /\.([a-z0-9]{1,5})$/.exec(url)?.[1] ?? '';
  const trimEnds = (s: string) => s.replace(/^[\s.]+|[\s.]+$/g, '');
  let base = trimEnds((typeof name === 'string' ? name : '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ''));
  base = trimEnds(base.replace(/\.[A-Za-z0-9]{1,5}$/, ''));
  base = trimEnds(base.slice(0, 200 - (ext ? ext.length + 1 : 0)));
  if (!base) return '';
  return ext ? `${base}.${ext}` : base;
}

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const ANCHOR_RE = /^[a-z0-9-]+$/;

/** Normalizes a typed or imported URL; `null` when it is not allowed. */
export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (!ALLOWED_SCHEMES.has(name)) return null;
    return name + text.slice(name.length);
  }
  if (text.includes('@') && !text.includes('/')) return `mailto:${text.toLowerCase()}`;
  if (text.startsWith('//')) return `https:${text}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return null;
}

export function defaultNewTab(kind: LinkKind, url?: string): boolean {
  return kind === 'url' && /^https?:/i.test(url ?? '');
}

/** Lowercase `[a-z0-9-]`, spaces as `-`; empty becomes `fallback`. */
export function slugify(text: string, fallback: string): string {
  const s = text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || fallback;
}

export function isValidAnchor(value: string): boolean {
  return ANCHOR_RE.test(value);
}

/** Escapes a value for a double quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function walkComponents(components: EditorComponent[], visit: (c: EditorComponent) => void): void {
  for (const c of components) {
    visit(c);
    walkComponents(c.children || [], visit);
  }
}

/**
 * Maps a raw `href` to a link by the import rules (AC-11). `anchorOwners` maps an
 * anchor to the element id and page id that carry it.
 */
export function linkFromHref(
  href: string | null,
  pages: Page[],
  anchorOwners: Map<string, { id: string; pageId: string }>,
  downloadName?: string | null
): ElementLink | null {
  const raw = (href ?? '').trim();
  if (!raw || raw === '#') return null;
  // Uploads before the slug rule, so `/media/...` never becomes a Page link (spec 0009 AC-10).
  if (isMediaFileUrl(raw)) return { kind: 'file', url: raw, fileName: cleanDownloadName(downloadName ?? '', raw), newTab: false };
  if (raw.startsWith('/media/')) {
    const url = normalizeUrl(raw);
    return url ? { kind: 'url', url, newTab: defaultNewTab('url', url) } : null;
  }
  const slugMatch = /^#?(\/(?!\/)[^#?]*)$/.exec(raw);
  if (slugMatch) {
    const slug = slugMatch[1]!.toLowerCase();
    const page = pages.find(p => p.slug === slug);
    return { kind: 'page', pageId: page ? page.id : '', newTab: false };
  }
  if (raw.startsWith('#')) {
    const owner = anchorOwners.get(raw.slice(1).toLowerCase());
    return owner ? { kind: 'section', pageId: owner.pageId, targetId: owner.id, newTab: false } : null;
  }
  const url = normalizeUrl(raw);
  return url ? { kind: 'url', url, newTab: defaultNewTab('url', url) } : null;
}

/**
 * Inline script for multipage published sites. Shows one `data-apexium-page` at a
 * time, handles `#/<slug>` and `#<anchor>` clicks before the preview link guard
 * (registered first, `preventDefault` only), reads the start hash from the
 * `apexium-start` meta, and talks to a parent page through `postMessage`.
 */
export const PAGE_SWITCHER_SCRIPT = `<script data-apexium-pages>(function(){
function ps(){return document.querySelectorAll("[data-apexium-page]")}
function bySlug(s){var a=ps();for(var i=0;i<a.length;i++)if(a[i].getAttribute("data-apexium-page")===s)return a[i];return null}
function home(){return bySlug("/")||ps()[0]}
function show(p){var a=ps();for(var i=0;i<a.length;i++){if(a[i]===p)a[i].removeAttribute("hidden");else a[i].setAttribute("hidden","")}}
function resolve(h){if(!h||h.charAt(0)!=="#"||h==="#")return null;
if(h.charAt(1)==="/"){var p=bySlug(h.slice(1).toLowerCase());return{page:p||home(),el:null}}
var id=h.slice(1);try{id=decodeURIComponent(id)}catch(e){}
var el=document.getElementById(id);var pg=el&&el.closest?el.closest("[data-apexium-page]"):null;return pg?{page:pg,el:el}:null}
function apply(h,smooth){var r=resolve(h);if(!r||!r.page)return false;show(r.page);
if(r.el)r.el.scrollIntoView({behavior:smooth?"smooth":"auto",block:"start"});else window.scrollTo(0,0);return true}
document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0)return;
var a=e.target&&e.target.closest?e.target.closest("a[href^='#']"):null;if(!a||a.getAttribute("target")==="_blank")return;
var h=a.getAttribute("href");if(!apply(h,true))return;e.preventDefault();
try{if(window.parent!==window)window.parent.postMessage({type:"apexium-nav",hash:h},"*")}catch(err){}});
window.addEventListener("message",function(e){var d=e.data;if(e.source===window.parent&&d&&d.type==="apexium-go"&&typeof d.hash==="string"){if(!apply(d.hash||"#/",false))apply("#/",false)}});
function init(){var m=document.querySelector('meta[name="apexium-start"]');var h=(m&&m.getAttribute("content"))||location.hash;if(h)apply(h,false)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();</script>`;
