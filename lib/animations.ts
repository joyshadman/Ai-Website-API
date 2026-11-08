/**
 * Animation presets on editor elements (spec 0004). Mirrors
 * `Ai-Website/src/lib/animations.ts`; keep the allowed values, the sanitizer,
 * the preset sheet, and the scripts in step.
 */

export const ENTRANCE_PRESETS = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in'] as const;
export const HOVER_PRESETS = ['lift', 'grow', 'glow', 'dim'] as const;
export const SPEEDS = ['fast', 'normal', 'slow'] as const;

export type EntrancePreset = typeof ENTRANCE_PRESETS[number];
export type HoverPreset = typeof HOVER_PRESETS[number];
export type AnimationSpeed = typeof SPEEDS[number];

export interface ElementAnimation {
  entrance?: { preset: EntrancePreset; speed: AnimationSpeed; delay: number };
  hover?: { preset: HoverPreset };
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** 0 to 2 seconds, one decimal; anything that is not a finite number is 0. */
function cleanDelay(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(2, Math.max(0, n)) * 10) / 10;
}

/**
 * Keeps only allowed values (AC-11): an unknown entrance or hover preset drops it,
 * an unknown speed becomes `normal`. HTML embeds never animate.
 */
export function sanitizeAnimation(input: unknown, type?: string): ElementAnimation | undefined {
  if (type === 'html-embed' || !input || typeof input !== 'object') return undefined;
  const raw = input as { entrance?: any; hover?: any };
  const out: ElementAnimation = {};
  if (raw.entrance && isOneOf(ENTRANCE_PRESETS, raw.entrance.preset)) {
    out.entrance = {
      preset: raw.entrance.preset,
      speed: isOneOf(SPEEDS, raw.entrance.speed) ? raw.entrance.speed : 'normal',
      delay: cleanDelay(raw.entrance.delay),
    };
  }
  if (raw.hover && isOneOf(HOVER_PRESETS, raw.hover.preset)) out.hover = { preset: raw.hover.preset };
  return out.entrance || out.hover ? out : undefined;
}

/** The `data-apx-*` attributes for a component's outer element; `''` when it does not animate. */
export function animationAttrs(animation: unknown, type: string): string {
  const a = sanitizeAnimation(animation, type);
  if (!a) return '';
  let attrs = '';
  if (a.entrance) {
    attrs += ` data-apx-anim="${a.entrance.preset}" data-apx-speed="${a.entrance.speed}"`;
    if (a.entrance.delay > 0) attrs += ` data-apx-delay="${String(a.entrance.delay)}"`;
  }
  if (a.hover) attrs += ` data-apx-hover="${a.hover.preset}"`;
  return attrs;
}

/** Reads the published attributes back (import, AC-9). */
export function animationFromElement(el: Element, type: string): ElementAnimation | undefined {
  const anim = el.getAttribute('data-apx-anim');
  const hover = el.getAttribute('data-apx-hover');
  if (!anim && !hover) return undefined;
  return sanitizeAnimation({
    entrance: anim ? { preset: anim, speed: el.getAttribute('data-apx-speed'), delay: el.getAttribute('data-apx-delay') } : undefined,
    hover: hover ? { preset: hover } : undefined,
  }, type);
}

/** The exact `data-apx-delay` strings the preset sheet has rules for: "0.1" … "1", "1.1" … "2". */
export const DELAY_VALUES: readonly string[] = Array.from({ length: 20 }, (_, i) => String((i + 1) / 10));

/**
 * Chat edits keep existing presets unchanged and may add entrances only to block elements they
 * create (spec 0007, which updates spec 0004 AC-10); used by both edit prompts.
 */
export const ANIMATION_PROMPT_RULE = `- The document may use animation presets: data-apx-anim, data-apx-speed, data-apx-delay, and data-apx-hover attributes, plus <style data-apexium-anim> and <script data-apexium-anim> blocks. Keep every data-apx-* attribute on elements you keep, exactly as written, and keep those blocks unchanged. You may add data-apx-anim (one of ${ENTRANCE_PRESETS.join(', ')}) with data-apx-speed (${SPEEDS.join(', ')}) and, to stagger a group, data-apx-delay (exactly one of ${DELAY_VALUES.join(', ')}) only to elements you create that are section, div, article, h1, h2, h3, or p (never ul, li, figure, dt, dd, anything inside a form, header, nav, footer, a, span, or em), and keep the page at 12 or fewer elements with data-apx-anim. Never write data-apexium-anim blocks yourself.`;

/** Old preset blocks, whoever wrote them (spec 0007). */
const ANIMATION_BLOCK_RE = /<(style|script)\b[^>]*\bdata-apexium-anim\b[^>]*>[\s\S]*?<\/\1>/gi;
/** A preset attribute inside a start tag, so CSS text, comments, or scripts that mention it never count. */
const PRESET_ATTR_RE = /<[a-z][^>]*\sdata-apx-(anim|hover)\s*=/i;

/**
 * Generated HTML gets exactly one copy of the preset sheet and scripts when an element uses a
 * preset, and none otherwise (spec 0007 AC-6). Runs at finalize and on builder "Save code".
 */
export function withAnimationBlocks(html: string): string {
  const stripped = html.replace(ANIMATION_BLOCK_RE, '');
  // Detection ignores comments, scripts, and stylesheets, so text that mentions an attribute never counts.
  const markup = stripped
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  if (!PRESET_ATTR_RE.test(markup)) return stripped;
  const head = `<style data-apexium-anim>${ANIMATION_SHEET}</style>${ANIMATION_HEAD_SCRIPT}`;
  let out: string;
  const headClose = stripped.search(/<\/head\s*>/i);
  const headOpen = /<head\b[^>]*>/i.exec(stripped);
  const htmlOpen = /<html\b[^>]*>/i.exec(stripped);
  if (headClose !== -1) out = stripped.slice(0, headClose) + head + stripped.slice(headClose);
  else if (headOpen) out = stripped.slice(0, headOpen.index + headOpen[0].length) + head + stripped.slice(headOpen.index + headOpen[0].length);
  else if (htmlOpen) out = stripped.slice(0, htmlOpen.index + htmlOpen[0].length) + head + stripped.slice(htmlOpen.index + htmlOpen[0].length);
  else out = head + stripped;
  // The body script goes before the last </body>, else at the end.
  const bodyCloses = [...out.matchAll(/<\/body\s*>/gi)];
  const last = bodyCloses[bodyCloses.length - 1];
  return last?.index !== undefined
    ? out.slice(0, last.index) + ANIMATION_BODY_SCRIPT + out.slice(last.index)
    : out + ANIMATION_BODY_SCRIPT;
}

// ─── Published sheet and scripts ─────────────────────────────────────────────

/** Entrance start states; keyframes define only `from`, so elements end as styled (AC-3). */
const ENTRANCE_FROM: Record<EntrancePreset, string> = {
  'fade': 'opacity:0',
  'slide-up': 'opacity:0;transform:translateY(24px)',
  'slide-down': 'opacity:0;transform:translateY(-24px)',
  'slide-left': 'opacity:0;transform:translateX(24px)',
  'slide-right': 'opacity:0;transform:translateX(-24px)',
  'zoom-in': 'opacity:0;transform:scale(0.92)',
};

const HOVER_TO: Record<HoverPreset, string> = {
  'lift': 'transform:translateY(-4px);box-shadow:0 12px 24px rgba(0,0,0,.18)',
  'grow': 'transform:scale(1.05)',
  // The plain shadow comes first for browsers without color-mix.
  'glow': 'box-shadow:0 0 0 3px rgba(124,58,237,.35),0 0 24px rgba(124,58,237,.25);box-shadow:0 0 0 3px color-mix(in srgb,currentColor 35%,transparent),0 0 24px color-mix(in srgb,currentColor 25%,transparent)',
  'dim': 'opacity:0.8',
};

const EASE = 'cubic-bezier(.22,1,.36,1)';

export const ANIMATION_SHEET = [
  ':where(a,span):where([data-apx-anim],[data-apx-hover]){display:inline-block}',
  'html.apx-ready [data-apx-anim]:not(.apx-in){opacity:0}',
  ...ENTRANCE_PRESETS.map(p => `@keyframes apx-${p}{from{${ENTRANCE_FROM[p]}}}`),
  '[data-apx-anim]{--apx-dur:.7s;--apx-delay:0s}',
  '[data-apx-speed="fast"]{--apx-dur:.4s}',
  '[data-apx-speed="slow"]{--apx-dur:1s}',
  ...Array.from({ length: 20 }, (_, i) => { const d = String((i + 1) / 10); return `[data-apx-delay="${d}"]{--apx-delay:${d}s}`; }),
  ...ENTRANCE_PRESETS.map(p => `[data-apx-anim="${p}"].apx-in{animation:apx-${p} var(--apx-dur) ${EASE} var(--apx-delay) backwards}`),
  '[data-apx-hover]{transition:transform .25s ease,box-shadow .25s ease,opacity .25s ease}',
  ...HOVER_PRESETS.map(p => `[data-apx-hover="${p}"]:hover{${HOVER_TO[p]}}`),
  '@media (prefers-reduced-motion: reduce){[data-apx-anim].apx-in{animation-name:apx-fade;animation-duration:.3s}[data-apx-hover="lift"]:hover,[data-apx-hover="grow"]:hover{transform:none}}',
].join('\n');

/** Runs before first paint: hides entrances, and reveals everything after 2.5s if the observer never checks in (AC-6). */
export const ANIMATION_HEAD_SCRIPT = `<script data-apexium-anim>document.documentElement.classList.add("apx-ready");window.__apxReveal=setTimeout(function(){var a=document.querySelectorAll("[data-apx-anim]");for(var i=0;i<a.length;i++)a[i].classList.add("apx-in")},2500);</script>`;

/** Plays each entrance once, when 15% of it (or 15% of the viewport, for tall elements) is in view (AC-2). */
export const ANIMATION_BODY_SCRIPT = `<script data-apexium-anim>(function(){clearTimeout(window.__apxReveal);var a=document.querySelectorAll("[data-apx-anim]"),i;
if(!("IntersectionObserver" in window)){for(i=0;i<a.length;i++)a[i].classList.add("apx-in");return}
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting&&(e.intersectionRatio>=0.15||e.intersectionRect.height>=window.innerHeight*0.15)){e.target.classList.add("apx-in");io.unobserve(e.target)}})},{threshold:[0,0.05,0.1,0.15]});
for(i=0;i<a.length;i++)io.observe(a[i])})();</script>`;
