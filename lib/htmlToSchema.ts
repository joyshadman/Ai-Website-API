import { JSDOM } from 'jsdom';
import crypto from 'crypto';

const uid = () => crypto.randomUUID();

export type ComponentType =
  | 'container' | 'section' | 'row' | 'column'
  | 'heading' | 'text' | 'button' | 'image' | 'video' | 'icon'
  | 'divider' | 'spacer'
  | 'card' | 'testimonial' | 'faq' | 'pricing' | 'feature-grid'
  | 'hero' | 'navbar' | 'footer'
  | 'contact-form' | 'newsletter-form'
  | 'gallery' | 'slider' | 'carousel'
  | 'map' | 'code-block' | 'html-embed';

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
      const camel = kebabToCamel(key) as keyof StyleProperties;
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
  return getClassString(el).includes('form') || getClassString(el).includes('contact');
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
      return { type: 'button', name: 'Link Button' };
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
        if (getClassString(el).includes('icon') || el.querySelector('svg')) return { type: 'icon', name: 'Icon' };
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
    case 'button': case 'a':
      props.text = getContentText(el) || 'Button';
      props.link = el.getAttribute('href') || '#';
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
      if (tag === 'nav') {
        const brandEl = el.querySelector('a, span, div');
        props.brand = brandEl ? getContentText(brandEl) || 'Logo' : 'Logo';
        const links: string[] = [];
        el.querySelectorAll('a').forEach(a => { const t = getContentText(a); if (t) links.push(t); });
        props.links = links.length > 0 ? links.join(',') : 'Home,About,Contact';
      }
      break;
  }

  return props;
}

function elementToComponent(el: Element, depth: number = 0): EditorComponent | null {
  const tag = el.tagName?.toLowerCase?.() || '';
  if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'head') return null;

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
  const classStyles = parseClasses(getClassString(el));
  const mergedStyles = mergeStyles(classStyles, inlineStyles);

  const props = extractTextContent(el);

  if (type === 'navbar' || type === 'footer' || type === 'hero' || type === 'contact-form') {
    if (type === 'navbar' && !props.brand) {
      props.brand = 'Logo';
      props.links = 'Home,About,Contact';
    }
    if (type === 'hero' && !props.text) {
      const h1 = el.querySelector('h1'); const h2 = el.querySelector('h2');
      props.title = h1 ? getContentText(h1) : h2 ? getContentText(h2) : 'Hero Title';
      const ps = Array.from(el.querySelectorAll('p'));
      props.subtitle = ps.length > 0 ? getContentText(ps[0]!) : '';
      const cta = el.querySelector('a') || el.querySelector('button');
      props.cta = cta ? getContentText(cta) || 'Get Started' : 'Get Started';
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

  if (!SECTION_TYPES.includes(type)) {
    const children = Array.from(el.children);
    for (const child of children) {
      const childComp = elementToComponent(child, depth + 1);
      if (childComp) {
        if (childComp.type === 'image' && type === 'gallery') continue;
        component.children.push(childComp);
      }
    }
  }

  return component;
}

export function htmlToComponents(html: string): EditorComponent[] {
  try {
    const dom = new JSDOM(html, { contentType: 'text/html' });
    const body = dom.window.document.body;
    const components: EditorComponent[] = [];

    for (const child of Array.from(body.children)) {
      try {
        const comp = elementToComponent(child, 0);
        if (comp) components.push(comp);
      } catch (err) {
        console.error('elementToComponent error for child:', child.tagName, err);
      }
    }

    console.log('Components generated:', components.length);

    if (components.length === 0) {
      console.warn('No components generated, creating fallback html-embed');
      components.push({
        id: uid(),
        type: 'html-embed',
        name: 'HTML Embed',
        props: { html },
        styles: { desktop: {}, tablet: {}, mobile: {} },
        children: [],
        editable: true,
        draggable: true,
        deletable: true,
      });
    }

    return components;
  } catch (error) {
    console.error('HTML to schema conversion error:', error);
    return [{
      id: uid(),
      type: 'html-embed',
      name: 'HTML Embed',
      props: { html },
      styles: { desktop: {}, tablet: {}, mobile: {} },
      children: [],
      editable: true,
      draggable: true,
      deletable: true,
    }];
  }
}

export function componentsToHtml(components: EditorComponent[], device: 'desktop' | 'tablet' | 'mobile' = 'desktop'): string {
  const renderOne = (comp: EditorComponent): string => {
    const s = comp.styles[device];
    const styleStr = Object.entries(s)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v}`)
      .join('; ');
    const childrenHtml = comp.children.filter(c => !c.hidden).map(renderOne).join('\n');
    const propsStr = Object.entries(comp.props)
      .filter(([, v]) => v && typeof v !== 'object')
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join(' ');

    switch (comp.type) {
      case 'container': return `<div style="${styleStr}" ${propsStr}>${childrenHtml}</div>`;
      case 'section': return `<section style="${styleStr}" ${propsStr}>${childrenHtml}</section>`;
      case 'row': return `<div style="${styleStr}" ${propsStr}>${childrenHtml}</div>`;
      case 'column': return `<div style="${styleStr}" ${propsStr}>${childrenHtml}</div>`;
      case 'heading': {
        const lvl = comp.props.level || 'h2';
        return `<${lvl} style="${styleStr}">${comp.props.text || ''}</${lvl}>`;
      }
      case 'text': return `<p style="${styleStr}">${comp.props.text || ''}</p>`;
      case 'button': return `<a href="${comp.props.link || '#'}" style="${styleStr}">${comp.props.text || 'Button'}</a>`;
      case 'image': return `<img src="${comp.props.src || ''}" alt="${comp.props.alt || ''}" style="${styleStr}" loading="lazy" />`;
      case 'video': return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px"><iframe src="${comp.props.src || ''}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>`;
      case 'icon': return `<span style="${styleStr}">${comp.props.name || 'star'}</span>`;
      case 'divider': return `<hr style="${styleStr}" />`;
      case 'spacer': return `<div style="${styleStr}"></div>`;
      case 'card': return `<div style="${styleStr}"><h3>${comp.props.title || ''}</h3><p>${comp.props.text || ''}</p>${childrenHtml}</div>`;
      case 'testimonial': return `<blockquote style="${styleStr}"><p>"${comp.props.quote || ''}"</p><footer><strong>${comp.props.author || ''}</strong> ${comp.props.role || ''}</footer></blockquote>`;
      case 'faq': return `<details style="${styleStr}"><summary>${comp.props.question || ''}</summary><p>${comp.props.answer || ''}</p>${childrenHtml}</details>`;
      case 'pricing': return `<div style="${styleStr}"><h3>${comp.props.plan || ''}</h3><div style="font-size:36px;font-weight:700">${comp.props.price || ''}<span style="font-size:14px;opacity:0.6">${comp.props.period || ''}</span></div><ul>${(comp.props.features || '').split(',').map((f: string) => `<li>${f.trim()}</li>`).join('')}</ul><a href="#" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none">${comp.props.cta || 'Get Started'}</a>${childrenHtml}</div>`;
      case 'feature-grid': return `<div style="${styleStr}">${childrenHtml}</div>`;
      case 'hero': return `<section style="${styleStr}"><h1>${comp.props.title || ''}</h1><p>${comp.props.subtitle || ''}</p><a href="#" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none">${comp.props.cta || 'Get Started'}</a>${childrenHtml}</section>`;
      case 'navbar': return `<nav style="${styleStr}"><div style="font-weight:700;font-size:18px">${comp.props.brand || ''}</div><div style="display:flex;gap:16px">${(comp.props.links || '').split(',').map((l: string) => `<span>${l.trim()}</span>`).join('')}</div>${childrenHtml}</nav>`;
      case 'footer': return `<footer style="${styleStr}"><p>${comp.props.text || ''}</p>${childrenHtml}</footer>`;
      case 'contact-form': return `<form style="${styleStr}"><input placeholder="Name" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><input type="email" placeholder="Email" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><textarea placeholder="Message" rows={4} style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff"></textarea><button type="submit" style="padding:12px 24px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer">Send</button></form>`;
      case 'newsletter-form': return `<div style="${styleStr}"><h3>Subscribe</h3><div style="display:flex;gap:8px"><input placeholder="${comp.props.placeholder || 'Email'}" style="flex:1;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#fff" /><button style="padding:12px 24px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer">${comp.props.cta || 'Subscribe'}</button></div></div>`;
      case 'gallery': return `<div style="${styleStr}">${(comp.props.images || '').split(',').map((url: string) => `<img src="${url.trim()}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px" loading="lazy" />`).join('')}</div>`;
      case 'slider': return `<div style="${styleStr}"><div style="display:flex;transition:transform 0.3s">${(comp.props.slides || '').split(',').map((s: string) => `<div style="min-width:100%;padding:20px">${s.trim()}</div>`).join('')}</div>${childrenHtml}</div>`;
      case 'carousel': return `<div style="${styleStr};display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:8px">${(comp.props.images || '').split(',').map((url: string) => `<img src="${url.trim()}" style="scroll-snap-align:start;width:80%;flex-shrink:0;aspect-ratio:16/10;object-fit:cover;border-radius:8px" loading="lazy" />`).join('')}</div>`;
      case 'map': return `<iframe style="${styleStr}" src="https://maps.google.com/maps?q=${encodeURIComponent(comp.props.address || 'New York')}&z=${comp.props.zoom || '12'}&output=embed" loading="lazy"></iframe>`;
      case 'code-block': return `<pre style="${styleStr}"><code>${comp.props.code || ''}</code></pre>`;
      case 'html-embed': return comp.props.html || '';
      default: return `<div style="${styleStr}">${childrenHtml}</div>`;
    }
  };

  const body = components.filter(c => !c.hidden).map(renderOne).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script></head><body style="margin:0;background:#030712;color:#f1f5f9;font-family:system-ui,-apple-system,sans-serif">${body}</body></html>`;
}
