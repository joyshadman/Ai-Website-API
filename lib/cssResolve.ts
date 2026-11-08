import type { StyleProperties } from './htmlToSchema.js';
import type { Device } from './siteStyles.js';

/**
 * Plain CSS import for the visual editor (spec 0003, import steps 2 to 8).
 * Stylesheets are read with a small parser that keeps the original value text,
 * because jsdom's CSSOM drops values it does not understand (`clamp()`,
 * `!important`) and rewrites others. jsdom is only used to match selectors.
 */

const TAILWIND_RE = /cdn\.tailwindcss\.com|@tailwindcss\/browser/i;

export function usesTailwind(html: string): boolean {
  return TAILWIND_RE.test(html);
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface Decl { prop: string; value: string; important: boolean }
interface StyleRule { kind: 'rule'; selector: string; decls: Decl[]; raw: string; nested: boolean }
interface AtRule { kind: 'at'; name: string; prelude: string; raw: string; children?: CssNode[] }
type CssNode = StyleRule | AtRule;

function skipString(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === quote) return j;
  }
  return text.length;
}

function skipComment(text: string, i: number): number {
  const end = text.indexOf('*/', i + 2);
  return end === -1 ? text.length : end + 1;
}

/** First `stops` character outside strings, comments, parens and brackets, or -1. */
function findTop(text: string, from: number, stops: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") { i = skipString(text, i); continue; }
    if (ch === '/' && text[i + 1] === '*') { i = skipComment(text, i); continue; }
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && stops.includes(ch)) return i;
  }
  return -1;
}

/** Index of the bracket closing the one at `open` (or the end of the text). */
function closeOf(text: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") { i = skipString(text, i); continue; }
    if (ch === '/' && text[i + 1] === '*') { i = skipComment(text, i); continue; }
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return text.length;
}

const removeComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

function parseDecls(body: string): Decl[] {
  const decls: Decl[] = [];
  let i = 0;
  while (i < body.length) {
    let end = findTop(body, i, ';');
    if (end === -1) end = body.length;
    const part = removeComments(body.slice(i, end)).trim();
    i = end + 1;
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim();
    const prop = name.startsWith('--') ? name : name.toLowerCase();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.exec(value);
    if (important) value = value.slice(0, important.index).trim();
    if (!prop || !value || /[{}\s]/.test(prop)) continue;
    decls.push({ prop, value, important: !!important });
  }
  return decls;
}

function parseSheet(text: string): CssNode[] {
  const nodes: CssNode[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = skipComment(text, i) + 1; continue; }
    if (text.startsWith('<!--', i)) { i += 4; continue; }
    if (text.startsWith('-->', i)) { i += 3; continue; }
    const stop = findTop(text, i, ';{}');
    if (stop === -1) break;
    if (text[stop] === '}') { i = stop + 1; continue; }
    const head = removeComments(text.slice(i, stop)).trim();
    if (text[stop] === ';') {
      if (head.startsWith('@')) nodes.push({ kind: 'at', name: atName(head), prelude: atPrelude(head), raw: `${head};` });
      i = stop + 1;
      continue;
    }
    const end = closeOf(text, stop, '{', '}');
    const body = text.slice(stop + 1, end);
    const raw = `${head} {${body}}`;
    if (head.startsWith('@')) {
      const name = atName(head);
      nodes.push(name === 'media'
        ? { kind: 'at', name, prelude: atPrelude(head), raw, children: parseSheet(body) }
        : { kind: 'at', name, prelude: atPrelude(head), raw });
    } else {
      nodes.push({ kind: 'rule', selector: head, decls: parseDecls(body), raw, nested: findTop(body, 0, '{') !== -1 });
    }
    i = end + 1;
  }
  return nodes;
}

const atName = (head: string) => /^@([\w-]+)/.exec(head)?.[1]?.toLowerCase() ?? '';
const atPrelude = (head: string) => head.replace(/^@[\w-]+/, '').trim();

const declText = (d: Decl) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`;
const ruleText = (selectors: string[], decls: Decl[]) => `${selectors.join(', ')} { ${decls.map(declText).join('; ')}; }`;

// ─── Selectors ───────────────────────────────────────────────────────────────

type Specificity = [number, number, number];

function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const comma = findTop(list, i, ',');
    const part = list.slice(i, comma === -1 ? undefined : comma).trim();
    if (part) out.push(part);
    if (comma === -1) return out;
    i = comma + 1;
  }
}

function readIdent(s: string, i: number): number {
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\') { i += 2; continue; }
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) { i++; continue; }
    break;
  }
  return i;
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

function maxSpecificity(selectors: string[]): Specificity {
  let best: Specificity = [0, 0, 0];
  for (const s of selectors) { const sp = specificity(s); if (compare(sp, best) > 0) best = sp; }
  return best;
}

/** Ids, then classes/attributes/pseudo classes, then types; `:where()` counts zero. */
function specificity(sel: string): Specificity {
  let a = 0, b = 0, c = 0;
  let i = 0;
  while (i < sel.length) {
    const ch = sel[i]!;
    if (ch === '#') { a++; i = readIdent(sel, i + 1); continue; }
    if (ch === '.') { b++; i = readIdent(sel, i + 1); continue; }
    if (ch === '[') { b++; i = closeOf(sel, i, '[', ']') + 1; continue; }
    if (ch === ':') {
      const element = sel[i + 1] === ':';
      const start = i + (element ? 2 : 1);
      const nameEnd = readIdent(sel, start);
      const name = sel.slice(start, nameEnd).toLowerCase();
      let next = nameEnd;
      let args = '';
      if (sel[nameEnd] === '(') { const close = closeOf(sel, nameEnd, '(', ')'); args = sel.slice(nameEnd + 1, close); next = close + 1; }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) c++;
      else if (name === 'where') { /* zero */ }
      else if (['is', 'not', 'has', 'matches'].includes(name)) { const m = maxSpecificity(splitSelectors(args)); a += m[0]; b += m[1]; c += m[2]; }
      else b++;
      i = next;
      continue;
    }
    if (ch === '"' || ch === "'") { i = skipString(sel, i) + 1; continue; }
    if (/[A-Za-z_\\]/.test(ch) || ch.charCodeAt(0) > 127) { c++; i = readIdent(sel, i); continue; }
    i++;
  }
  return [a, b, c];
}

function compare(x: Specificity, y: Specificity): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** State and pseudo element selectors never resolve onto a component; they stay residual. */
const STATEFUL_RE = /::|:(hover|focus|focus-visible|focus-within|active|visited|target|checked|before|after|first-line|first-letter)(?![\w-])/i;

// ─── Values ──────────────────────────────────────────────────────────────────

/** `StyleProperties` keys a declaration may move into (`flex` stays residual, spec 0003 step 5). */
const STYLE_KEYS = new Set([
  'margin', 'padding', 'width', 'height', 'maxWidth', 'minWidth', 'minHeight',
  'border', 'borderRadius', 'boxShadow', 'opacity', 'backgroundColor', 'backgroundSize', 'backgroundPosition',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign',
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap', 'gridTemplateColumns', 'gridGap',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'overflow', 'overflowX', 'overflowY',
  'textDecoration', 'textTransform', 'backdropFilter', 'cursor', 'objectFit',
  'borderTop', 'borderBottom', 'borderLeft', 'borderRight',
]);

const kebabToCamel = (s: string) => s.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

/** The `StyleProperties` key a declaration moves into, or null when it stays residual. */
function styleKey(prop: string, value: string): string | null {
  if (prop.startsWith('--')) return null;
  if (prop === 'background' || prop === 'background-image') {
    // Only a single gradient, url, or plain color moves; layered shorthands stay residual.
    if (findTop(value.trim(), 0, ' ,') !== -1) return null;
    if (/gradient\(/i.test(value)) return 'backgroundGradient';
    if (/^url\(/i.test(value.trim())) return 'backgroundImage';
    return prop === 'background' ? 'backgroundColor' : null;
  }
  const key = kebabToCamel(prop);
  return STYLE_KEYS.has(key) ? key : null;
}

function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 10 || !value.includes('var(')) return value;
  let out = '';
  let i = 0;
  for (;;) {
    const at = value.indexOf('var(', i);
    if (at === -1) return out + value.slice(i);
    out += value.slice(i, at);
    const close = closeOf(value, at + 3, '(', ')');
    const inner = value.slice(at + 4, close);
    const comma = findTop(inner, 0, ',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const found = vars.get(name) ?? (comma === -1 ? null : inner.slice(comma + 1).trim());
    out += found === null ? value.slice(at, close + 1) : resolveVars(found, vars, depth + 1);
    i = close + 1;
  }
}

function typed(key: string, value: string): string | number {
  if ((key === 'opacity' || key === 'zIndex') && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

// ─── Media ───────────────────────────────────────────────────────────────────

const APPLIES: Record<Device, Device[]> = {
  desktop: ['desktop', 'tablet', 'mobile'],
  tablet: ['tablet', 'mobile'],
  mobile: ['mobile'],
};

/** The device a `@media` maps to, or null when it stays residual whole (spec 0003 step 6). */
function mediaDevice(prelude: string): Device | null {
  const m = /^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*max-width\s*:\s*([\d.]+)(px|em|rem)\s*\)$/i.exec(prelude.trim());
  if (!m) return null;
  const px = parseFloat(m[1]!) * (m[2]!.toLowerCase() === 'px' ? 1 : 16);
  if (px <= 640) return 'mobile';
  if (px <= 1024) return 'tablet';
  return null;
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

export type DeviceStyles = Record<Device, StyleProperties>;

export interface ResolveResult {
  /** Resolved styles per target element: desktop full, tablet and mobile as deltas. */
  styles: Map<Element, DeviceStyles>;
  /** The residual sheet. */
  css: string;
  /** URLs of `@import` rules, for the caller's font link list. */
  imports: string[];
}

interface Candidate { key: string; value: string; important: boolean; spec: Specificity; order: number; device: Device }

interface Unit { rule: StyleRule; device: Device }

/**
 * Works out each target element's styles from `sheets` (in document order) and
 * returns what is left as the residual sheet. `targets` are the elements that
 * became components, plus `<body>`. Selectors match the original document.
 */
export function resolveStylesheets(doc: Document, sheets: string[], targets: Set<Element>): ResolveResult {
  const nodes = sheets.flatMap(parseSheet);

  // Units: every style rule that can resolve, with the device it applies from.
  const units: Unit[] = [];
  for (const node of nodes) {
    if (node.kind === 'rule') units.push({ rule: node, device: 'desktop' });
    else if (node.name === 'media' && node.children) {
      const device = mediaDevice(node.prelude);
      if (device) for (const child of node.children) if (child.kind === 'rule') units.push({ rule: child, device });
    }
  }

  // Custom properties from `:root`/`html` rules, per device.
  const vars: Record<Device, Map<string, string>> = { desktop: new Map(), tablet: new Map(), mobile: new Map() };
  for (const { rule, device } of units) {
    if (rule.nested || !splitSelectors(rule.selector).every(s => /^(:root|html)$/i.test(s))) continue;
    for (const d of rule.decls) if (d.prop.startsWith('--')) for (const dev of APPLIES[device]) vars[dev].set(d.prop, d.value);
  }

  // Match each selector; decide per selector whether its declarations move or the rule stays whole.
  const candidates = new Map<Element, Candidate[]>();
  const plan = new Map<StyleRule, { whole: string[]; reduced: string[] }>();
  let order = 0;
  for (const { rule, device } of units) {
    const whole: string[] = [];
    const reduced: string[] = [];
    plan.set(rule, { whole, reduced });
    if (rule.nested) { whole.push(rule.selector); continue; }
    for (const selector of splitSelectors(rule.selector)) {
      if (STATEFUL_RE.test(selector)) { whole.push(selector); continue; }
      let matched: Element[];
      try { matched = Array.from(doc.querySelectorAll(selector)); } catch { whole.push(selector); continue; }
      // A rule matching nothing (a class a script adds later) or any non component stays whole.
      if (matched.length === 0 || matched.some(el => !targets.has(el))) whole.push(selector);
      else reduced.push(selector);
      const spec = specificity(selector);
      for (const el of matched) {
        if (!targets.has(el)) continue;
        const list = candidates.get(el) ?? [];
        for (const d of rule.decls) {
          const key = styleKey(d.prop, d.value);
          if (key) list.push({ key, value: d.value, important: d.important, spec, order: order++, device });
        }
        candidates.set(el, list);
      }
    }
  }

  // Inline `style` attributes beat every rule (unless the rule is `!important`).
  for (const el of targets) {
    const inline = el.getAttribute('style');
    if (!inline) continue;
    const list = candidates.get(el) ?? [];
    for (const d of parseDecls(inline)) {
      const key = styleKey(d.prop, d.value);
      if (key) list.push({ key, value: d.value, important: d.important, spec: [1000, 0, 0], order: order++, device: 'desktop' });
    }
    candidates.set(el, list);
  }

  // Cascade per device, then store tablet and mobile as deltas.
  const styles = new Map<Element, DeviceStyles>();
  for (const [el, list] of candidates) {
    const full = {} as Record<Device, Record<string, string | number>>;
    for (const device of ['desktop', 'tablet', 'mobile'] as Device[]) {
      const winners = new Map<string, Candidate>();
      for (const c of list) {
        if (!APPLIES[c.device].includes(device)) continue;
        const prev = winners.get(c.key);
        if (!prev || beats(c, prev)) winners.set(c.key, c);
      }
      const resolved: Record<string, string | number> = {};
      for (const [key, c] of winners) resolved[key] = typed(key, resolveVars(c.value, vars[device]));
      full[device] = resolved;
    }
    styles.set(el, {
      desktop: full.desktop as StyleProperties,
      tablet: delta(full.tablet, full.desktop) as StyleProperties,
      mobile: delta(full.mobile, full.tablet) as StyleProperties,
    });
  }

  // Residual: whole rules, reduced copies of moved rules, and everything else in order.
  const imports: string[] = [];
  const head: string[] = [];
  const out: string[] = [];
  const residualRule = (rule: StyleRule): string => {
    const p = plan.get(rule);
    if (!p) return rule.raw;
    if (rule.nested) return rule.raw;
    const parts: string[] = [];
    if (p.whole.length) parts.push(ruleText(p.whole, rule.decls));
    const kept = rule.decls.filter(d => !styleKey(d.prop, d.value));
    if (p.reduced.length && kept.length) parts.push(ruleText(p.reduced, kept));
    return parts.join('\n');
  };
  for (const node of nodes) {
    if (node.kind === 'rule') { const t = residualRule(node); if (t) out.push(t); continue; }
    if (node.name === 'import') {
      head.push(node.raw);
      const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)|^['"]([^'"]+)['"]/i.exec(node.prelude);
      if (url) imports.push((url[1] ?? url[2])!);
      continue;
    }
    if (node.name === 'charset') continue;
    if (node.name === 'media' && node.children && mediaDevice(node.prelude)) {
      const inner = node.children.map(c => (c.kind === 'rule' ? residualRule(c) : c.raw)).filter(Boolean);
      if (inner.length) out.push(`@media ${node.prelude} {\n${inner.join('\n')}\n}`);
      continue;
    }
    out.push(node.raw);
  }

  return { styles, css: [...head, ...out].join('\n'), imports };
}

function beats(c: Candidate, prev: Candidate): boolean {
  if (c.important !== prev.important) return c.important;
  const s = compare(c.spec, prev.spec);
  return s !== 0 ? s > 0 : c.order > prev.order;
}

function delta(next: Record<string, string | number>, below: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(next)) if (below[k] !== v) out[k] = v;
  return out;
}
