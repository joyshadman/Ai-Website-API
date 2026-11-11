import crypto from 'crypto';
import { parseGeneratedHtml, styleElements } from './parseHtml.js';
import {
  LINKABLE_TYPES, PAGE_SWITCHER_SCRIPT, cleanDownloadName, escapeAttr, isMediaFileUrl, isValidAnchor, linkFromHref, normalizeUrl, walkComponents,
  type ElementLink, type NavItem, type Page,
} from './links.js';
import { readElementRules, resolveStylesheets, usesTailwind } from './cssResolve.js';
import { directionFromHtml } from './designChecks.js';
import { INLINE_TAGS, LIMITS, cleanClassName, cleanFavicon, cleanNode, elementAttrs, inlineLinkResolver, isFontLink, keepDirection, keepFavicon, renderElement, siteDocument, type ExportState, type SiteStyles } from './siteStyles.js';
import { animationFromElement, type ElementAnimation } from './animations.js';
import { LOGO_ATTR, logoFromHtml, logoMarkup } from './logo.js';

const uid = () => crypto.randomUUID();

export type ComponentType =
  | 'container' | 'section' | 'row' | 'column'
  | 'heading' | 'text' | 'button' | 'image' | 'video' | 'icon'
  | 'divider' | 'spacer'
  | 'card' | 'testimonial' | 'faq' | 'pricing' | 'feature-grid'
  | 'hero' | 'navbar' | 'footer'
  | 'contact-form' | 'newsletter-form'
  | 'gallery' | 'slider' | 'carousel'
  | 'map' | 'code-block' | 'html-embed'
  /** Draws `globalStyles.logo` (spec 0008); no props of its own, nothing when the site has no logo. */
  | 'logo'
  /** One real HTML element of a generated site (spec 0013). */
  | 'element';

export interface StyleProperties {
  margin?: string; padding?: string;
  width?: string; height?: string; maxWidth?: string; minWidth?: string; minHeight?: string;
  border?: string; borderRadius?: string; boxShadow?: string;
  opacity?: number;
  backgroundColor?: string; backgroundGradient?: string; backgroundImage?: string;
  backgroundSize?: string; backgroundPosition?: string;
  color?: string;
  fontFamily?: string; fontSize?: string; fontWeight?: string; fontStyle?: string;
  lineHeight?: string; letterSpacing?: string; textAlign?: string;
  display?: string; flex?: string; flexDirection?: string; alignItems?: string;
  justifyContent?: string; flexWrap?: string; gap?: string;
  gridTemplateColumns?: string; gridGap?: string;
  position?: string; top?: string; right?: string; bottom?: string; left?: string;
  zIndex?: number;
  overflow?: string; overflowX?: string; overflowY?: string;
  textDecoration?: string; textTransform?: string;
  backdropFilter?: string;
  cursor?: string;
  objectFit?: string;
  borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string;
}

export interface EditorComponent {
  id: string;
  type: ComponentType;
  name: string;
  props: Record<string, any>;
  styles: Record<'desktop' | 'tablet' | 'mobile', StyleProperties>;
  children: EditorComponent[];
  editable?: boolean;
  draggable?: boolean;
  deletable?: boolean;
  hidden?: boolean;
  link?: ElementLink;
  anchor?: string;
  navItems?: NavItem[];
  ctaLink?: ElementLink;
  /** Plain CSS projects: the element's original `class` (spec 0003). Never in `props`. */
  className?: string;
  /** Entrance and hover presets (spec 0004); never on `html-embed`. */
  animation?: ElementAnimation;
  /** `element` only (spec 0013): the real tag, or `#text` for loose text. */
  tag?: string;
  /** `element` only: every other attribute except `class`, `style`, and `data-apx-*`. */
  attrs?: Record<string, string>;
  /** `element` only: the style properties changed in the styles panel. */
  editedStyles?: string[];
}

/** Collects `<a href>` values during import; resolved once the whole tree exists. */
interface ImportCtx {
  pageId: string;
  anchors: Map<string, { id: string; pageId: string }>;
  pending: { href: string | null; download?: string | null; assign: (link: ElementLink) => void }[];
  /** Source element of every plain CSS node, for the stylesheet resolver. */
  elements: Map<Element, EditorComponent>;
}

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseInlineStyles(styleStr: string): StyleProperties {
  const styles: StyleProperties = {};
  if (!styleStr) return styles;
  for (const pair of styleStr.split(';')) {
    const [k, ...v] = pair.split(':');
    const key = k?.trim();
    const val = v.join(':').trim();
    if (key && val) {
      const camel = (key.startsWith('--') ? key : kebabToCamel(key)) as keyof StyleProperties;
      (styles as any)[camel] = val;
    }
  }
  return styles;
}

const TAILWIDTH_MAP: Record<string, string> = {
  'w-full': '100%', 'w-screen': '100vw', 'w-auto': 'auto',
  'h-full': '100%', 'h-screen': '100vh', 'h-auto': 'auto',
  'max-w-full': '100%', 'max-w-screen-xl': '1280px', 'max-w-screen-lg': '1024px',
  'max-w-screen-md': '768px', 'max-w-screen-sm': '640px',
  'max-w-7xl': '1280px', 'max-w-6xl': '1152px', 'max-w-5xl': '1024px',
  'max-w-4xl': '896px', 'max-w-3xl': '768px', 'max-w-2xl': '672px',
  'max-w-xl': '576px', 'max-w-lg': '512px', 'max-w-md': '448px',
  'max-w-sm': '384px', 'max-w-xs': '320px',
  'flex': 'flex', 'grid': 'grid', 'block': 'block', 'inline-block': 'inline-block',
  'hidden': 'none',
  'flex-row': 'row', 'flex-col': 'column', 'flex-wrap': 'wrap',
  'items-start': 'flex-start', 'items-center': 'center', 'items-end': 'flex-end',
  'items-stretch': 'stretch',
  'justify-start': 'flex-start', 'justify-center': 'center', 'justify-end': 'flex-end',
  'justify-between': 'space-between', 'justify-around': 'space-around',
  'text-left': 'left', 'text-center': 'center', 'text-right': 'right',
  'object-cover': 'cover', 'object-contain': 'contain', 'object-fill': 'fill',
  'rounded-none': '0', 'rounded': '4px', 'rounded-sm': '2px',
  'rounded-md': '6px', 'rounded-lg': '8px', 'rounded-xl': '12px',
  'rounded-2xl': '16px', 'rounded-3xl': '24px', 'rounded-full': '9999px',
};

function parseClasses(classStr: string): StyleProperties {
  const styles: StyleProperties = {};
  if (!classStr) return styles;
  const classes = classStr.split(/\s+/).filter(Boolean);

  for (const cls of classes) {
    if (TAILWIDTH_MAP[cls]) {
      const prop = clsToProp(cls);
      if (prop) (styles as any)[prop] = TAILWIDTH_MAP[cls];
      continue;
    }

    if (cls.startsWith('text-') && !cls.startsWith('text-[')) {
      const size = cls.replace('text-', '');
      if (/^\d/.test(size) || ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'].includes(size)) {
        const sizeMap: Record<string, string> = {
          'xs': '12px', 'sm': '14px', 'base': '16px', 'lg': '18px',
          'xl': '20px', '2xl': '24px', '3xl': '30px', '4xl': '36px',
          '5xl': '48px', '6xl': '60px', '7xl': '72px', '8xl': '96px', '9xl': '128px'
        };
        styles.fontSize = (sizeMap[size] || size + 'px') as string;
      }
    }

    if (cls.startsWith('p-')) {
      const val = cls.replace('p-', '');
      if (['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'].includes(val)) {
        const pMap: Record<string, string> = { '0': '0', '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px', '12': '48px', '16': '64px', '20': '80px', '24': '96px' };
        styles.padding = pMap[val] as string;
      }
    }

    if (cls.match(/^m-\d+/) || cls.match(/^m-[0-9]/)) {
      const val = cls.replace('m-', '');
      if (['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'].includes(val)) {
        const mMap: Record<string, string> = { '0': '0', '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px', '12': '48px', '16': '64px', '20': '80px', '24': '96px' };
        styles.margin = mMap[val] as string;
      }
    }

    if (cls.startsWith('gap-')) {
      const val = cls.replace('gap-', '');
      if (['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'].includes(val)) {
        const gMap: Record<string, string> = { '0': '0', '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px', '12': '48px', '16': '64px' };
        styles.gap = gMap[val] as string;
      }
    }

    if (cls.startsWith('font-')) {
      const w = cls.replace('font-', '');
      const wMap: Record<string, string> = { 'thin': '100', 'extralight': '200', 'light': '300', 'normal': '400', 'medium': '500', 'semibold': '600', 'bold': '700', 'extrabold': '800', 'black': '900' };
      if (wMap[w]) styles.fontWeight = wMap[w];
    }

    if (cls.match(/^shadow/) && cls !== 'shadow') {
      const shadowMap: Record<string, string> = {
        'shadow-sm': '0 1px 2px 0 rgba(0,0,0,0.05)',
        'shadow': '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
        'shadow-md': '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
        'shadow-lg': '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
        'shadow-xl': '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
        'shadow-2xl': '0 25px 50px -12px rgba(0,0,0,0.25)',
      };
      if (shadowMap[cls]) styles.boxShadow = shadowMap[cls];
    }
  }

  return styles;
}

function clsToProp(cls: string): string | null {
  const map: Record<string, string> = {
    'flex': 'display', 'grid': 'display', 'block': 'display', 'inline-block': 'display', 'hidden': 'display',
    'flex-row': 'flexDirection', 'flex-col': 'flexDirection', 'flex-wrap': 'flexWrap',
    'items-start': 'alignItems', 'items-center': 'alignItems', 'items-end': 'alignItems', 'items-stretch': 'alignItems',
    'justify-start': 'justifyContent', 'justify-center': 'justifyContent', 'justify-end': 'justifyContent', 'justify-between': 'justifyContent', 'justify-around': 'justifyContent',
    'text-left': 'textAlign', 'text-center': 'textAlign', 'text-right': 'textAlign',
    'object-cover': 'objectFit', 'object-contain': 'objectFit', 'object-fill': 'objectFit',
    'w-full': 'width', 'w-screen': 'width', 'w-auto': 'width',
    'h-full': 'height', 'h-screen': 'height', 'h-auto': 'height',
    'max-w-full': 'maxWidth',
    'rounded-none': 'borderRadius', 'rounded': 'borderRadius', 'rounded-sm': 'borderRadius',
    'rounded-md': 'borderRadius', 'rounded-lg': 'borderRadius', 'rounded-xl': 'borderRadius',
    'rounded-2xl': 'borderRadius', 'rounded-3xl': 'borderRadius', 'rounded-full': 'borderRadius',
  };
  return map[cls] || null;
}

function mergeStyles(a: StyleProperties, b: StyleProperties): StyleProperties {
  return { ...a, ...b };
}

function getClassString(el: Element): string {
  return el.getAttribute('class') || '';
}

function getContentText(el: Element): string {
  if (el.textContent) {
    return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return '';
}

/** Content text with any logo marker removed, so an SVG `<title>` never becomes a brand name. */
function textWithoutLogo(el: Element): string {
  if (!el.querySelector(`[${LOGO_ATTR}]`)) return getContentText(el);
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(`[${LOGO_ATTR}]`).forEach(m => m.remove());
  return getContentText(copy);
}

const inLogo = (el: Element): boolean => el.closest(`[${LOGO_ATTR}]`) !== null;

function getImgSrc(el: Element): string {
  return el.getAttribute('src') || 'https://placehold.co/600x400';
}

function getHref(el: Element): string {
  return el.getAttribute('href') || '#';
}

function hasGradientBg(el: Element): boolean {
  return getClassString(el).includes('bg-gradient') || (el.getAttribute('style') || '').includes('gradient');
}

function isNavbar(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'nav') return true;
  const id = el.getAttribute('id') || '';
  return getClassString(el).includes('nav') || id.includes('nav') || id.includes('header');
}

function isFooter(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'footer') return true;
  const id = el.getAttribute('id') || '';
  return getClassString(el).includes('footer') || id.includes('footer');
}

function isHero(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id') || '';
  if (tag === 'header' && (getClassString(el).includes('hero') || id.includes('hero') || id.includes('header'))) return true;
  if (getClassString(el).includes('hero') || id.includes('hero')) return true;
  if (tag === 'section') {
    const h1 = el.querySelectorAll('h1');
    const hasBigText = h1.length > 0;
    const children = Array.from(el.children);
    const hasCTA = children.some(c => c.tagName === 'A' || c.tagName === 'BUTTON');
    return hasBigText && hasCTA;
  }
  return false;
}

function isForm(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'form') return true;
  // A "contact" or "form" class only counts when real form fields are inside; a contact section with
  // just text and links stays a section, so its content and presets survive an editor save (spec 0007 AC-7).
  const cls = getClassString(el);
  return (cls.includes('form') || cls.includes('contact')) && el.querySelector('form, input, textarea, select') !== null;
}

function isList(el: Element): boolean {
  return ['ul', 'ol', 'dl'].includes(el.tagName.toLowerCase());
}

function isCard(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'article' || tag === 'aside') return true;
  const childDivs = Array.from(el.children).filter(c => c.tagName === 'DIV').length;
  const childCount = Array.from(el.children).length;
  return (getClassString(el).includes('card') || (childDivs >= 2 && childCount <= 4 && childCount > 1));
}

function getGridColumns(el: Element): number {
  const style = el.getAttribute('style') || '';
  const gridMatch = getClassString(el).match(/grid-cols-(\d+)/) || style.match(/grid-template-columns:\s*repeat\((\d+)/);
  return gridMatch ? parseInt(gridMatch[1]!) : 3;
}

function hasContainerStructure(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const childCount = el.children.length;
  const hasChildSections = Array.from(el.children).some(c => {
    const t = c.tagName.toLowerCase();
    return ['section', 'header', 'footer', 'article', 'nav'].includes(t) ||
      (c.getAttribute('class') || '').includes('section') || (c.getAttribute('class') || '').includes('container');
  });
  return tag === 'main' || tag === 'div' && (getClassString(el).includes('container') || hasChildSections) ||
    tag === 'div' && childCount > 3 && childCount < 10 && !isCard(el);
}

function detectComponentType(el: Element, depth: number): { type: ComponentType; name: string } {
  const tag = el.tagName.toLowerCase();

  if (isNavbar(el)) return { type: 'navbar', name: 'Navbar' };
  if (isFooter(el)) return { type: 'footer', name: 'Footer' };
  if (isHero(el)) return { type: 'hero', name: 'Hero' };
  if (isForm(el)) return { type: 'contact-form', name: 'Contact Form' };

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return { type: 'heading', name: `Heading (${tag})` };
    case 'p':
      return { type: 'text', name: 'Text' };
    case 'button':
      return { type: 'button', name: 'Button' };
    case 'a':
      // An <a> wrapping elements is a linked block, a text only <a> a linked button.
      return el.children.length > 0 ? { type: 'container', name: 'Link Block' } : { type: 'button', name: 'Link Button' };
    case 'img':
      return { type: 'image', name: 'Image' };
    case 'iframe':
      return getClassString(el).includes('maps') ? { type: 'map', name: 'Map' } : { type: 'html-embed', name: 'Embed' };
    case 'video':
      return { type: 'video', name: 'Video' };
    case 'hr':
      return { type: 'divider', name: 'Divider' };
    case 'br':
      return { type: 'spacer', name: 'Spacer' };
    case 'ul': case 'ol':
      return { type: 'text', name: 'List' };
    case 'nav':
      return { type: 'navbar', name: 'Navbar' };
    case 'header':
      return { type: 'hero', name: 'Header' };
    case 'footer':
      return { type: 'footer', name: 'Footer' };
    case 'form':
      return { type: 'contact-form', name: 'Contact Form' };
    case 'article': case 'aside':
      return { type: 'card', name: 'Card' };
    case 'section':
      return { type: 'section', name: 'Section' };
    case 'pre': case 'code':
      return { type: 'code-block', name: 'Code Block' };
    default:
      if (tag === 'div' || tag === 'span') {
        const childCount = el.children.length;
        if (childCount === 0) return { type: 'text', name: 'Text' };
        if (getClassString(el).includes('grid') || (el.getAttribute('style') || '').includes('grid')) {
          return { type: 'feature-grid', name: 'Feature Grid' };
        }
        const childDivs = Array.from(el.children).filter(c => c.tagName === 'DIV');
        const imgChildren = Array.from(el.children).filter(c => c.tagName === 'IMG');
        if (imgChildren.length >= 3) return { type: 'gallery', name: 'Gallery' };
        if (isCard(el)) return { type: 'card', name: 'Card' };
        // A logo marker's SVG does not make its brand wrapper an icon (spec 0008).
        if (getClassString(el).includes('icon') || Array.from(el.querySelectorAll('svg')).some(svg => !inLogo(svg))) return { type: 'icon', name: 'Icon' };
        if (depth === 0 && childDivs.length >= 2 && (getClassString(el).includes('container') || hasContainerStructure(el))) {
          return { type: 'container', name: 'Container' };
        }
        if (getClassString(el).includes('flex') && childCount > 1) return { type: 'row', name: 'Row' };
        return { type: 'container', name: 'Container' };
      }
      if (tag === 'main') return { type: 'container', name: 'Container' };
      return { type: 'html-embed', name: 'HTML Embed' };
  }
}

function extractTextContent(el: Element): Record<string, any> {
  const tag = el.tagName.toLowerCase();
  const props: Record<string, any> = {};

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      props.text = getContentText(el);
      props.level = tag;
      break;
    case 'p': case 'span':
      props.text = getContentText(el);
      break;
    case 'button':
      props.text = getContentText(el) || 'Button';
      break;
    case 'a':
      if (el.children.length === 0) props.text = getContentText(el) || 'Button';
      break;
    case 'img':
      props.src = el.getAttribute('src') || '';
      props.alt = el.getAttribute('alt') || '';
      break;
    case 'input':
      props.placeholder = el.getAttribute('placeholder') || '';
      break;
    case 'textarea':
      props.placeholder = el.getAttribute('placeholder') || '';
      break;
    case 'iframe':
      props.src = el.getAttribute('src') || '';
      props.title = el.getAttribute('title') || '';
      break;
    case 'video':
      props.src = el.getAttribute('src') || '';
      break;
    default:
      break;
  }

  return props;
}

/** A logo marker becomes a `logo` component; its SVG lives once in `globalStyles.logo` (spec 0008). */
function logoComponent(): EditorComponent {
  return {
    id: uid(), type: 'logo', name: 'Logo', props: {},
    styles: { desktop: {}, tablet: {}, mobile: {} },
    children: [], editable: true, draggable: true, deletable: true,
  };
}

/* Plain CSS import (spec 0013): one `element` node per real HTML element. */
const INLINE_BY_DEFAULT: ReadonlySet<string> = new Set([...INLINE_TAGS, 'button', 'img', 'input', 'label', 'select', 'svg', 'textarea']);
const NOT_CONTENT: ReadonlySet<string> = new Set(['script', 'style', 'meta', 'link', 'head', 'base', 'template']);
const hasText = (text: string) => /[^ \t\r\n\f]/.test(text);

/**
 * Only text and inline tags at every depth, with text directly inside it (spec 0013 AC-2). A `nav`
 * holding only links has none, so it stays a box and each link can be selected. `<pre>` is exempt.
 */
function isTextBlock(el: Element): boolean {
  if (el.querySelector(`[${LOGO_ATTR}]`)) return false;
  if (!Array.from(el.querySelectorAll('*')).every(d => INLINE_TAGS.has(d.localName.toLowerCase()))) return false;
  if (el.localName.toLowerCase() === 'pre') return true;
  return Array.from(el.childNodes).some(child => child.nodeType === 3 && hasText(child.textContent ?? ''));
}

function textNode(text: string): EditorComponent {
  return {
    id: uid(), type: 'element', name: 'text', tag: '#text', attrs: {}, props: { html: text },
    styles: { desktop: {}, tablet: {}, mobile: {} },
    children: [], editable: true, draggable: true, deletable: true,
  };
}

function elementNode(el: Element, ctx: ImportCtx): EditorComponent | null {
  const tag = el.localName.toLowerCase();
  if (NOT_CONTENT.has(tag)) return null;

  if (el.hasAttribute(LOGO_ATTR)) {
    const logo = logoComponent();
    const cls = cleanClassName(el.getAttribute('class'));
    if (cls) logo.className = cls;
    ctx.elements.set(el, logo);
    return logo;
  }

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (!/^(class|data-c|data-apx-.*)$/.test(attr.name)) attrs[attr.name] = attr.value;
  }
  const node: EditorComponent = {
    id: uid(), type: 'element', name: tag, tag, attrs, props: {},
    styles: { desktop: parseInlineStyles(el.getAttribute('style') || ''), tablet: {}, mobile: {} },
    children: [], editable: true, draggable: true, deletable: true,
  };
  const cls = cleanClassName(el.getAttribute('class'));
  if (cls) node.className = cls;
  const animation = animationFromElement(el, 'element');
  if (animation) node.animation = animation;
  ctx.elements.set(el, node);

  const id = attrs.id;
  if (id && id === id.toLowerCase() && isValidAnchor(id) && !ctx.anchors.has(id)) {
    node.anchor = id;
    delete attrs.id;
    ctx.anchors.set(id, { id: node.id, pageId: ctx.pageId });
  }

  if (tag === 'a') {
    ctx.pending.push({
      href: el.getAttribute('href'),
      download: el.getAttribute('download'),
      assign: link => {
        // A page link with no matching page has no address to give back, so the original stays.
        if (link.kind === 'page' && !link.pageId) return;
        link.newTab = el.getAttribute('target') === '_blank';
        node.link = link;
        delete attrs.href;
        delete attrs.target;
        if (link.newTab) delete attrs.rel;
        if (link.kind === 'file') delete attrs.download;
      },
    });
  }

  if (tag === 'svg' || tag === 'select' || tag === 'textarea' || isTextBlock(el)) node.props.html = el.innerHTML;
  else node.children = elementChildren(el, ctx);
  return node;
}

/** A parent's content in order: elements as nodes, text as `#text` nodes. */
function elementChildren(parent: Element, ctx: ImportCtx): EditorComponent[] {
  const inlineSibling = (node: ChildNode | null) => node?.nodeType === 1 && INLINE_BY_DEFAULT.has((node as Element).localName.toLowerCase());
  const nodes: EditorComponent[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      const node = elementNode(child as Element, ctx);
      if (node) nodes.push(node);
    } else if (child.nodeType === 3) {
      const text = child.textContent ?? '';
      if (hasText(text) || parent.localName.toLowerCase() === 'pre') nodes.push(textNode(text));
      else if (inlineSibling(child.previousSibling) && inlineSibling(child.nextSibling)) nodes.push(textNode(' '));
    }
  }
  return nodes;
}

/** Tailwind sites only (spec 0013): the older import that guesses a component type. */
function elementToComponent(el: Element, depth: number, ctx: ImportCtx): EditorComponent | null {
  const tag = el.tagName?.toLowerCase?.() || '';
  if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'head') return null;

  if (el.hasAttribute(LOGO_ATTR)) return logoComponent();

  let type: ComponentType;
  let name: string;
  try {
    const detected = detectComponentType(el, depth);
    type = detected.type;
    name = detected.name;
  } catch (err) {
    console.error('Component detection error for tag:', tag, err);
    type = 'container';
    name = 'Container';
  }

  const inlineStyles = parseInlineStyles(el.getAttribute('style') || '');
  const mergedStyles = mergeStyles(parseClasses(getClassString(el)), inlineStyles);

  const props = extractTextContent(el);

  let navItems: NavItem[] | undefined;
  let heroCta: Element | undefined;
  if (type === 'navbar' || type === 'footer' || type === 'hero' || type === 'contact-form') {
    if (type === 'navbar') {
      // The first a/span/div outside a logo marker is the brand; every other <a> becomes a nav item.
      const brandEl = Array.from(el.querySelectorAll('a, span, div')).find(e => !inLogo(e));
      props.brand = brandEl ? textWithoutLogo(brandEl) || 'Logo' : 'Logo';
      // The navbar is a leaf, so a marker in its brand becomes a flag (spec 0008).
      if (el.querySelector(`[${LOGO_ATTR}]`)) props.brandLogo = true;
      navItems = [];
      for (const a of Array.from(el.querySelectorAll('a'))) {
        if (a === brandEl || inLogo(a)) continue;
        const label = textWithoutLogo(a);
        if (!label) continue;
        const item: NavItem = { id: uid(), label };
        navItems.push(item);
        ctx.pending.push({ href: a.getAttribute('href'), download: a.getAttribute('download'), assign: link => { item.link = link; } });
      }
      if (navItems.length === 0) {
        navItems = ['Home', 'About', 'Contact'].map(label => ({ id: uid(), label }));
      }
    }
    if (type === 'hero' && !props.text) {
      const h1 = el.querySelector('h1'); const h2 = el.querySelector('h2');
      props.title = h1 ? getContentText(h1) : h2 ? getContentText(h2) : 'Hero Title';
      const ps = Array.from(el.querySelectorAll('p'));
      props.subtitle = ps.length > 0 ? getContentText(ps[0]!) : '';
      // The CTA is the last link or button in the block that is not part of a nav.
      const ctas = Array.from(el.querySelectorAll('a, button')).filter(c => !c.closest('nav'));
      heroCta = ctas[ctas.length - 1];
      props.cta = heroCta ? getContentText(heroCta) || 'Get Started' : 'Get Started';
    }
    if (type === 'contact-form') {
      props.email = 'contact@example.com';
    }
    if (type === 'footer') {
      const ps = Array.from(el.querySelectorAll('p'));
      props.text = ps.length > 0 ? getContentText(ps[0]!) : '© 2026 All rights reserved.';
    }
  }

  if (type === 'gallery') {
    const imgs: string[] = [];
    el.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src) imgs.push(src);
    });
    props.images = imgs.length > 0 ? imgs.join(',') : 'https://placehold.co/600x400';
  }

  if (type === 'feature-grid') {
    props.columns = String(getGridColumns(el));
  }

  // For section-level types that extract content to props, skip children
  // to avoid rendering both props AND child components (duplication).
  const SECTION_TYPES = ['hero', 'navbar', 'footer', 'contact-form', 'newsletter-form', 'pricing', 'testimonial', 'faq'];

  const component: EditorComponent = {
    id: uid(),
    type,
    name,
    props,
    styles: {
      desktop: mergedStyles,
      tablet: {},
      mobile: {},
    },
    children: [],
    editable: true,
    draggable: true,
    deletable: true,
  };
  if (navItems) component.navItems = navItems;
  // Animation presets come back from their `data-apx-*` attributes on both paths (spec 0004 AC-9).
  const animation = animationFromElement(el, type);
  if (animation) component.animation = animation;

  // A valid, unique HTML id on a target type becomes the element's anchor.
  const htmlId = (el.getAttribute('id') || '').toLowerCase();
  if (htmlId && LINKABLE_TYPES.has(type) && isValidAnchor(htmlId) && !ctx.anchors.has(htmlId)) {
    component.anchor = htmlId;
    ctx.anchors.set(htmlId, { id: component.id, pageId: ctx.pageId });
  }

  if (tag === 'a' && LINKABLE_TYPES.has(type)) {
    ctx.pending.push({ href: el.getAttribute('href'), download: el.getAttribute('download'), assign: link => { component.link = link; } });
  }
  if (heroCta && heroCta.tagName === 'A') {
    ctx.pending.push({ href: heroCta.getAttribute('href'), download: heroCta.getAttribute('download'), assign: link => { component.ctaLink = link; } });
  }

  if (!SECTION_TYPES.includes(type)) {
    const children = Array.from(el.children);
    for (const child of children) {
      const childComp = elementToComponent(child, depth + 1, ctx);
      if (childComp) {
        if (childComp.type === 'image' && type === 'gallery') continue;
        component.children.push(childComp);
      }
    }
  }

  return component;
}

export interface ImportOptions {
  /** The project's current pages, used to match `/slug` links and keep anchors unique. */
  pages?: Page[];
  /** The page the imported components will live on. */
  pageId?: string;
}

function embedFallback(html: string): EditorComponent {
  return {
    id: uid(),
    type: 'html-embed',
    name: 'HTML Embed',
    props: { html },
    styles: { desktop: {}, tablet: {}, mobile: {} },
    children: [],
    editable: true,
    draggable: true,
    deletable: true,
  };
}

function buildComponents(doc: Document, html: string, options: ImportOptions, css: boolean): { components: EditorComponent[]; elements: Map<Element, EditorComponent> } {
  const components: EditorComponent[] = [];
  const pageId = options.pageId ?? 'page-1';
  const pages = options.pages ?? [];

  // Anchors already used on other pages stay reserved; the page being replaced does not count.
  const ctx: ImportCtx = { pageId, anchors: new Map(), pending: [], elements: new Map() };
  for (const page of pages) {
    if (page.id === pageId) continue;
    walkComponents(page.components || [], c => {
      if (c.anchor) ctx.anchors.set(c.anchor, { id: c.id, pageId: page.id });
    });
  }

  if (css) {
    // A plain CSS page imports whole or not at all, so nothing is lost without anyone knowing.
    components.push(...elementChildren(doc.body, ctx));
  } else {
    for (const child of Array.from(doc.body.children)) {
      try {
        const comp = elementToComponent(child, 0, ctx);
        if (comp) components.push(comp);
      } catch (err) {
        console.error('elementToComponent error for child:', child.tagName, err);
      }
    }
  }

  // Page links match against the pages the result will sit beside (the imported page keeps its slug).
  const linkPages: Page[] = pages.length > 0 ? pages : [{ id: pageId, name: 'Home', slug: '/', components }];
  for (const { href, download, assign } of ctx.pending) {
    const link = linkFromHref(href, linkPages, ctx.anchors, download);
    if (link) assign(link);
  }

  console.log('Components generated:', components.length);

  if (components.length === 0) {
    console.warn('No components generated, creating fallback html-embed');
    components.push(embedFallback(html));
  }

  return { components, elements: ctx.elements };
}

/** Legacy (Tailwind) import: components only. */
export function htmlToComponents(html: string, options: ImportOptions = {}): EditorComponent[] {
  try {
    const dom = parseGeneratedHtml(html, { contentType: 'text/html' });
    return buildComponents(dom.window.document, html, options, false).components;
  } catch (error) {
    console.error('HTML to schema conversion error:', error);
    return [embedFallback(html)];
  }
}

export interface PageData {
  pages: Page[];
  globalStyles: SiteStyles;
}

/**
 * Generated or saved HTML to one editor page plus site styles (spec 0003 import).
 * Tailwind documents take the legacy path; everything else is a plain CSS project.
 */
/** The first `<link rel="icon">` href in the document, when it is a valid favicon (spec 0006). */
export function faviconFromHtml(html: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    const rel = attr('rel');
    if (!rel || !/(^|\s)icon(\s|$)/i.test(rel[1] ?? rel[2] ?? rel[3] ?? '')) continue;
    const href = attr('href');
    const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').replace(/&amp;/g, '&');
    const favicon = cleanFavicon(raw);
    if (favicon) return favicon;
  }
  return undefined;
}

/** Puts the edits in the exported `[data-c]` sheet back on their nodes, per device (spec 0013 AC-15). */
function readHandEdits(styleTags: { open: string; text: string }[], elements: Map<Element, EditorComponent>): void {
  const byId = new Map<string, EditorComponent[]>();
  for (const [el, comp] of elements) {
    const id = el.getAttribute('data-c');
    if (id) byId.set(id, [...(byId.get(id) ?? []), comp]);
  }
  const rules = styleTags.filter(s => /\bdata-apexium-elements\b/i.test(s.open)).flatMap(s => readElementRules(s.text));
  for (const rule of rules) {
    for (const comp of byId.get(rule.id) ?? []) {
      comp.styles[rule.device] = { ...comp.styles[rule.device], ...rule.styles };
      comp.editedStyles = [...new Set([...(comp.editedStyles ?? []), ...Object.keys(rule.styles).map(key => `${rule.device}:${key}`)])];
    }
  }
}

export function htmlToPageData(html: string, options: ImportOptions = {}): PageData {
  const pageId = options.pageId ?? 'page-1';
  const asPages = (components: EditorComponent[]): Page[] => [{ id: pageId, name: 'Home', slug: '/', components }];
  // Read once, before any branch returns, so no import path drops the favicon (AC-11).
  const favicon = faviconFromHtml(html);
  // The design direction meta (spec 0007) travels the same way, so an editor save keeps it.
  const direction = directionFromHtml(html);
  // The HTML marker is the versioned source of the logo: no marker means no logo (spec 0008).
  const logo = logoFromHtml(html);
  const withIcon = (site: SiteStyles): SiteStyles => ({
    ...site,
    ...(favicon ? { favicon } : {}),
    ...(direction ? { direction } : {}),
    ...(logo ? { logo } : {}),
  });
  if (usesTailwind(html)) return { pages: asPages(htmlToComponents(html, options)), globalStyles: withIcon({}) };

  let doc: Document;
  let built: ReturnType<typeof buildComponents>;
  try {
    doc = parseGeneratedHtml(html, { contentType: 'text/html' }).window.document;
    built = buildComponents(doc, html, options, true);
  } catch (error) {
    console.error('HTML to schema conversion error:', error);
    return { pages: asPages([embedFallback(html)]), globalStyles: withIcon({ mode: 'css', importFailed: true }) };
  }

  // The animation preset sheet and scripts (spec 0004) are rewritten on export, never site styles.
  const styleTags = styleElements(html);
  const sheets = styleTags.filter(s => !/\bdata-apexium-(anim|elements)\b/i.test(s.open)).map(s => s.text);
  const script = Array.from(doc.querySelectorAll('script:not([src])'))
    .filter(s => !s.hasAttribute('data-apexium-pages') && !s.hasAttribute('data-apexium-link-guard') && !s.hasAttribute('data-apexium-anim'))
    .map(s => (s.textContent ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const linkHrefs = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))
    .map(l => l.getAttribute('href') ?? '')
    .filter(isFontLink);

  const site: SiteStyles = { mode: 'css' };
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (doc.title) site.title = doc.title;
  if (description) site.description = description;
  let fontLinks = linkHrefs;
  // The site's sheet stays exactly as written, so an unedited site is the same page (AC-15).
  site.css = sheets.join('\n');
  try {
    const cssLength = sheets.reduce((n, s) => n + s.length, 0);
    if (cssLength > LIMITS.css || script.length > LIMITS.script || linkHrefs.length > LIMITS.fontLinks) {
      throw new Error(`size limit exceeded (css ${cssLength}, script ${script.length}, font links ${linkHrefs.length})`);
    }
    // Resolved values only fill the styles panel; export never writes them unless they are edited.
    const result = resolveStylesheets(doc, sheets, new Set(built.elements.keys()));
    for (const [el, comp] of built.elements) {
      const styles = result.styles.get(el);
      if (!styles) continue;
      // The resolver only keeps properties the panel knows, so other inline ones are carried over.
      if (comp.type === 'element') styles.desktop = { ...comp.styles.desktop, ...styles.desktop };
      comp.styles = styles;
    }
    fontLinks = [...linkHrefs, ...result.imports.filter(isFontLink)];
  } catch (error) {
    // AC-14: never fail the run or the load; the sheet is already kept as written.
    console.error('[plain-css] stylesheet resolve skipped, keeping the sheet verbatim:', error);
  }
  readHandEdits(styleTags, built.elements);
  const uniqueFonts = [...new Set(fontLinks)].slice(0, LIMITS.fontLinks);
  if (uniqueFonts.length > 0) site.fontLinks = uniqueFonts;
  if (script) site.script = script;
  const components = built.components.flatMap(node => {
    const clean = cleanNode(node);
    return clean ? [clean] : [];
  });
  return { pages: asPages(components), globalStyles: withIcon(site) };
}

/**
 * `htmlToPageData` for paths that replace a project's stored pageData (AI finalize, rollback,
 * "Save code"): the stored favicon wins, since it is a site setting, not versioned content (spec 0006).
 */
export function rebuildPageData(html: string, storedPageData: string | null | undefined, options: ImportOptions = {}): PageData {
  const next = htmlToPageData(html, options);
  let stored: SiteStyles | undefined;
  try {
    const parsed = JSON.parse(storedPageData || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed.globalStyles;
  } catch { /* no usable stored styles */ }
  return { ...next, globalStyles: keepDirection(stored, keepFavicon(stored, next.globalStyles)) };
}

type Device = 'desktop' | 'tablet' | 'mobile';

/** Box types render as the link element itself when linked (spec 0002 render table). */
const BOX_TYPES = new Set(['container', 'section', 'row', 'column', 'card']);

interface RenderCtx {
  device: Device;
  pageSlugs: Map<string, string>;
  /** Component id → its anchor and page, first anchor wins so no `id` repeats. */
  anchors: Map<string, { anchor: string; pageId: string }>;
}

function buildRenderCtx(pages: Page[], device: Device): RenderCtx {
  const pageSlugs = new Map(pages.map(p => [p.id, p.slug || '/']));
  const anchors = new Map<string, { anchor: string; pageId: string }>();
  const used = new Set<string>();
  for (const page of pages) {
    walkComponents(page.components || [], c => {
      if (c.anchor && isValidAnchor(c.anchor) && !used.has(c.anchor)) {
        used.add(c.anchor);
        anchors.set(c.id, { anchor: c.anchor, pageId: page.id });
      }
    });
  }
  return { device, pageSlugs, anchors };
}

/** `href` plus `target`/`rel` for a link, or `null` when it is broken or not allowed. */
function linkAttrs(link: ElementLink | undefined, ctx: RenderCtx): string | null {
  if (!link) return null;
  let href: string | null = null;
  if (link.kind === 'url') {
    href = normalizeUrl(link.url ?? '');
  } else if (link.kind === 'page') {
    const slug = link.pageId ? ctx.pageSlugs.get(link.pageId) : undefined;
    href = slug ? `#${slug}` : null;
  } else if (link.kind === 'section') {
    const target = link.targetId ? ctx.anchors.get(link.targetId) : undefined;
    href = target && target.pageId === link.pageId ? `#${target.anchor}` : null;
  } else if (link.kind === 'file') {
    // Uploads only, never a target; the Save as name is cleaned again here (spec 0009 AC-3, AC-11).
    const url = link.url;
    if (typeof url !== 'string' || !isMediaFileUrl(url)) return null;
    const name = cleanDownloadName(link.fileName, url);
    return `href="${escapeAttr(url)}" ${name ? `download="${escapeAttr(name)}"` : 'download'}`;
  }
  if (!href) return null;
  return `href="${escapeAttr(href)}"${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
}

/** Normalizes any saved `pageData` shape (`{ pages }`, `{ components }`, a pages or components array) to pages. */
export function toPages(pageData: any): Page[] {
  if (Array.isArray(pageData?.pages)) return pageData.pages;
  if (Array.isArray(pageData) && pageData.every((p: any) => Array.isArray(p?.components))) return pageData;
  const components = Array.isArray(pageData?.components) ? pageData.components : Array.isArray(pageData) ? pageData : [];
  return [{ id: 'page-1', name: 'Home', slug: '/', components }];
}

/**
 * Pages to the published document (spec 0003 export). Component styles go into a
 * generated `[data-c]` sheet, not inline, so the site sheet's media queries and
 * hover rules keep working. Mirrored by `generateHtml` in `EditorPage.tsx`.
 */
export function componentsToHtml(pages: Page[], site: SiteStyles = {}): string {
  const ctx = buildRenderCtx(pages, 'desktop');
  const resolveLink = inlineLinkResolver(ctx.pageSlugs, ctx.anchors);
  const CTA_STYLE = 'display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none';
  const state: ExportState = { styled: [], animated: false };
  // Every copy of the logo gets its own id prefix (spec 0008).
  let logoCopies = 0;
  const logo = (): string => site.logo ? logoMarkup(site.logo, ++logoCopies) : '';

  const renderOne =(comp: EditorComponent, insideLink: boolean): string => {
    const s = comp.styles?.desktop ?? {};
    const styleParts: string[] = [];
    const styleStr = '';
    // The outermost link wins: nothing inside a linked element renders another <a>.
    const ownLink = !insideLink && LINKABLE_TYPES.has(comp.type) && (comp.type !== 'element' || comp.tag === 'a') ? linkAttrs(comp.link, ctx) : null;
    const inLink = insideLink || ownLink !== null;
    // Real elements keep their real spacing, so nothing is added between their children.
    const childrenHtml = (comp.children || []).filter(c => !c.hidden).map(c => renderOne(c, inLink)).join(comp.type === 'element' ? '' : '\n');
    if (comp.type === 'element') {
      return renderElement(comp, { link: ownLink, children: childrenHtml, anchor: ctx.anchors.get(comp.id)?.anchor, state, editor: false, resolveLink });
    }
    const propsStr = Object.entries(comp.props)
      .filter(([, v]) => v && typeof v !== 'object')
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join(' ');

    // A linked box becomes <a> carrying its own styles, so its layout does not change.
    const box = (tag: string, content: string, withProps: boolean): string => {
      if (ownLink && BOX_TYPES.has(comp.type)) {
        const linkStyle = [...styleParts, ...(s.display ? [] : ['display: block']), 'color: inherit', 'text-decoration: none'].join('; ');
        return `<a ${ownLink} style="${linkStyle}">${content}</a>`;
      }
      return `<${tag} style="${styleStr}"${withProps && propsStr ? ' ' + propsStr : ''}>${content}</${tag}>`;
    };
    const linkedText = (text: string): string =>
      ownLink ? `<a ${ownLink} style="color:inherit;text-decoration:inherit">${text}</a>` : text;
    // Buttons and CTAs: an <a> normally, a <span> when an ancestor already links.
    const action = (attrs: string | null, style: string, text: string): string =>
      inLink && !ownLink ? `<span style="${style}">${text}</span>` : `<a ${attrs ?? 'href="#"'} style="${style}">${text}</a>`;
    const cta = (link: ElementLink | undefined, text: string): string =>
      insideLink ? `<span style="${CTA_STYLE}">${text}</span>` : `<a ${linkAttrs(link, ctx) ?? 'href="#"'} style="${CTA_STYLE}">${text}</a>`;
    const navItems = (): string => {
      const items = comp.navItems ?? String(comp.props.links || '').split(',').filter(l => l.trim()).map(l => ({ id: '', label: l.trim() }));
      return items.map(item => {
        const attrs = insideLink ? null : linkAttrs((item as NavItem).link, ctx);
        return attrs ? `<a ${attrs} style="color:inherit;text-decoration:none">${item.label}</a>` : `<span>${item.label}</span>`;
      }).join('');
    };

    let html: string;
    switch (comp.type) {
      case 'container': html = box('div', childrenHtml, true); break;
      case 'section': html = box('section', childrenHtml, true); break;
      case 'row': html = box('div', childrenHtml, true); break;
      case 'column': html = box('div', childrenHtml, true); break;
      case 'heading': {
        const lvl = comp.props.level || 'h2';
        html = `<${lvl} style="${styleStr}">${linkedText(comp.props.text || '')}</${lvl}>`;
        break;
      }
      case 'text': html = `<p style="${styleStr}">${linkedText(comp.props.text || '')}</p>`; break;
      case 'button': html = action(ownLink, styleStr, comp.props.text || 'Button'); break;
      case 'image': html = `<img src="${comp.props.src || ''}" alt="${comp.props.alt || ''}" style="${styleStr}" loading="lazy" />`; break;
      case 'video': html = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px"><iframe src="${comp.props.src || ''}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>`; break;
      case 'icon': html = `<span style="${styleStr}">${comp.props.name || 'star'}</span>`; break;
      case 'divider': html = `<hr style="${styleStr}" />`; break;
      case 'spacer': html = `<div style="${styleStr}"></div>`; break;
      case 'card': html = box('div', `<h3>${comp.props.title || ''}</h3><p>${comp.props.text || ''}</p>${childrenHtml}`, false); break;
      case 'testimonial': html = `<blockquote style="${styleStr}"><p>"${comp.props.quote || ''}"</p><footer><strong>${comp.props.author || ''}</strong> ${comp.props.role || ''}</footer></blockquote>`; break;
      case 'faq': html = `<details style="${styleStr}"><summary>${comp.props.question || ''}</summary><p>${comp.props.answer || ''}</p>${childrenHtml}</details>`; break;
      case 'pricing': html = `<div style="${styleStr}"><h3>${comp.props.plan || ''}</h3><div style="font-size:36px;font-weight:700">${comp.props.price || ''}<span style="font-size:14px;opacity:0.6">${comp.props.period || ''}</span></div><ul>${(comp.props.features || '').split(',').map((f: string) => `<li>${f.trim()}</li>`).join('')}</ul>${cta(comp.ctaLink, comp.props.cta || 'Get Started')}${childrenHtml}</div>`; break;
      case 'feature-grid': html = `<div style="${styleStr}">${childrenHtml}</div>`; break;
      case 'hero': html = `<section style="${styleStr}"><h1>${comp.props.title || ''}</h1><p>${comp.props.subtitle || ''}</p>${cta(comp.ctaLink, comp.props.cta || 'Get Started')}${childrenHtml}</section>`; break;
      case 'navbar': {
        const mark = comp.props.brandLogo ? logo() : '';
        const brandStyle = mark ? 'display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px' : 'font-weight:700;font-size:18px';
        html = `<nav style="${styleStr}"><div style="${brandStyle}">${mark}${comp.props.brand || ''}</div><div style="display:flex;gap:16px">${navItems()}</div>${childrenHtml}</nav>`;
        break;
      }
      case 'logo': html = logo(); break;
      case 'footer': html = `<footer style="${styleStr}"><p>${comp.props.text || ''}</p>${childrenHtml}</footer>`; break;
      case 'contact-form': html = `<form style="${styleStr}"><input placeholder="Name" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><input type="email" placeholder="Email" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><textarea placeholder="Message" rows={4} style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff"></textarea><button type="submit" style="padding:12px 24px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer">Send</button></form>`; break;
      case 'newsletter-form': html = `<div style="${styleStr}"><h3>Subscribe</h3><div style="display:flex;gap:8px"><input placeholder="${comp.props.placeholder || 'Email'}" style="flex:1;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><button style="padding:12px 24px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer">${comp.props.cta || 'Subscribe'}</button></div></div>`; break;
      case 'gallery': html = `<div style="${styleStr}">${(comp.props.images || '').split(',').map((url: string) => `<img src="${url.trim()}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px" loading="lazy" />`).join('')}</div>`; break;
      case 'slider': html = `<div style="${styleStr}"><div style="display:flex;transition:transform 0.3s">${(comp.props.slides || '').split(',').map((sl: string) => `<div style="min-width:100%;padding:20px">${sl.trim()}</div>`).join('')}</div>${childrenHtml}</div>`; break;
      case 'carousel': html = `<div style="${styleStr};display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:8px">${(comp.props.images || '').split(',').map((url: string) => `<img src="${url.trim()}" style="scroll-snap-align:start;width:80%;flex-shrink:0;aspect-ratio:16/10;object-fit:cover;border-radius:8px" loading="lazy" />`).join('')}</div>`; break;
      case 'map': html = `<iframe style="${styleStr}" src="https://maps.google.com/maps?q=${encodeURIComponent(comp.props.address || 'New York')}&z=${comp.props.zoom || '12'}&output=embed" loading="lazy"></iframe>`; break;
      case 'code-block': html = `<pre style="${styleStr}"><code>${comp.props.code || ''}</code></pre>`; break;
      case 'html-embed': html = comp.props.html || ''; break;
      default: html = `<div style="${styleStr}">${childrenHtml}</div>`;
    }

    // The outer element carries the section anchor id, `data-c`, and the site class.
    if (comp.type !== 'html-embed') {
      const anchor = ctx.anchors.get(comp.id);
      const attrs = (anchor ? ` id="${escapeAttr(anchor.anchor)}"` : '') + elementAttrs(comp, state);
      html = html.replace(/ style=""/g, '').replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1${attrs}`);
    }
    // A linked image or icon keeps its attributes: the `display:contents` link draws no box.
    if (ownLink && (comp.type === 'image' || comp.type === 'icon')) html = `<a ${ownLink} style="display:contents">${html}</a>`;
    return html;
  };

  const renderList = (components: EditorComponent[]) => components.filter(c => !c.hidden).map(c => renderOne(c, false)).join('\n');

  let body: string;
  if (pages.length <= 1) {
    body = renderList(pages[0]?.components ?? []);
  } else {
    // Multipage: one wrapper per page, only the start page visible without the switcher.
    const start = pages.find(p => p.slug === '/') ?? pages[0]!;
    body = PAGE_SWITCHER_SCRIPT + pages.map(p =>
      `<div data-apexium-page="${escapeAttr(p.slug || '/')}"${p === start ? '' : ' hidden'}>${renderList(p.components ?? [])}</div>`
    ).join('\n');
  }
  return siteDocument(body, state, site);
}
