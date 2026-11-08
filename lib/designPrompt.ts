import { DELAY_VALUES } from './animations.js';

/**
 * Design rules for generated sites (spec 0007): three curated directions, ten required tokens,
 * shared layout and type rules, and motion through the editor's presets (spec 0004).
 * `designChecks.ts` checks the same names and limits, so change both together.
 */

export const DIRECTIONS = ['minimal', 'bold', 'editorial'] as const;
export type Direction = typeof DIRECTIONS[number];

/** Most elements with data-apx-anim a new site of each direction may have. */
export const MOTION_CAPS: Record<Direction, number> = { minimal: 8, bold: 12, editorial: 10 };
export const EDIT_MOTION_CAP = 12;

export const REQUIRED_TOKENS = [
  '--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-primary', '--color-on-primary',
  '--font-heading', '--font-body', '--radius', '--space',
] as const;

/**
 * Curated palettes per direction: bg, surface, text, muted, primary, on-primary. Each one was checked
 * with `contrastRatio` (text and on-primary at least 4.5:1, muted at least 3:1, on bg and on surface),
 * because the model cannot judge contrast reliably on its own.
 */
export const PALETTES: Record<Direction, [string, string, string, string, string, string, string][]> = {
  minimal: [
    ['paper', '#fafafa', '#ffffff', '#18181b', '#52525b', '#18181b', '#ffffff'],
    ['slate', '#f8fafc', '#ffffff', '#0f172a', '#475569', '#2563eb', '#ffffff'],
    ['sage', '#f6f7f4', '#ffffff', '#1c2b22', '#55645a', '#2f6b4f', '#ffffff'],
    ['night', '#0b0b0f', '#16161d', '#f4f4f5', '#a1a1aa', '#e4e4e7', '#111111'],
  ],
  bold: [
    ['volt', '#0a0a0a', '#171717', '#fafafa', '#a3a3a3', '#d9f99d', '#111111'],
    ['flame', '#fff7ed', '#ffffff', '#1c1917', '#57534e', '#c2410c', '#ffffff'],
    ['electric', '#0b1020', '#141b33', '#f8fafc', '#94a3b8', '#60a5fa', '#111111'],
    ['punch', '#fdf2f8', '#ffffff', '#1f1020', '#5b4b5c', '#be185d', '#ffffff'],
  ],
  editorial: [
    ['linen', '#faf7f2', '#ffffff', '#1f1b16', '#5c544a', '#7c2d12', '#ffffff'],
    ['ink', '#111418', '#1b2027', '#f3f1ec', '#a8a39b', '#d6b37a', '#111111'],
    ['olive', '#f7f6ef', '#ffffff', '#1d2116', '#555a4a', '#4d5b2a', '#ffffff'],
    ['rosewood', '#fbf5f3', '#ffffff', '#2a1715', '#6b5551', '#8f2d3b', '#ffffff'],
  ],
};

const DELAYS = DELAY_VALUES.join(', ');

const paletteLines = (direction: Direction) => PALETTES[direction]
  .map(([name, bg, surface, text, muted, primary, onPrimary]) =>
    `  ${name}: --color-bg ${bg}; --color-surface ${surface}; --color-text ${text}; --color-muted ${muted}; --color-primary ${primary}; --color-on-primary ${onPrimary}`)
  .join('\n');

/** Replaces "Use modern, beautiful design with great UX" in the create prompt. */
export const DESIGN_RULES = `DESIGN DIRECTION:
Pick ONE direction yourself from the request, write <meta name="apexium-direction" content="DIRECTION"> in <head> (DIRECTION is minimal, bold, or editorial), and follow it for fonts, palette, spacing, and motion.
- minimal: for consultants, studios, personal sites, calm products. Fonts: Inter for both, or DM Sans for both. Layout: wide margins, lots of white space, thin borders; --space 24px, --radius 8px. Motion: fade only, speed normal or slow.
- bold: for startups, events, fitness, campaigns. Fonts: Space Grotesk headings with Inter body, or Syne headings with Inter body. Layout: a big headline (clamp up to about 4.5rem), tight sections, solid color blocks; --space 20px, --radius 16px. Motion: slide-up, zoom-in, or fade, speed fast or normal.
- editorial: for restaurants, blogs, portfolios, culture. Fonts: Playfair Display headings with Source Sans 3 body, or Fraunces headings with Inter body. Layout: a magazine grid with asymmetric image and text pairs; --space 24px, --radius 4px. Motion: fade or slide-up, speed normal or slow.

PALETTE (pick ONE palette of your direction and copy its six colors EXACTLY; these pairs already meet contrast, so never change --color-on-primary):
minimal:
${paletteLines('minimal')}
bold:
${paletteLines('bold')}
editorial:
${paletteLines('editorial')}
You may add extra color tokens (like --color-accent) for decoration, but text and buttons use only the six above.

DESIGN TOKENS:
- In :root define exactly these custom properties (plus any extras you need): ${REQUIRED_TOKENS.join(', ')}.
- Colors are the palette's hex values, never var() of another property. --font-heading and --font-body hold the font family stacks from the direction.
- Use the tokens everywhere through var(); never hard code a color elsewhere. Buttons use background var(--color-primary) with color var(--color-on-primary).

LAYOUT AND TYPE:
- Structure: a hero, then 3 to 6 content sections, then a footer. One clear primary call to action above the fold. Cap content width near 1200px and center it.
- Build card and feature groups from <article> elements in a grid, never from <ul>/<li> lists.
- Type scale from the two font tokens: h1 about 3rem to 4.5rem, h2 about 2rem to 2.75rem, body 1rem to 1.125rem with line height 1.5 to 1.7.
- Keep spacing on a rhythm built from --space (multiples like calc(var(--space) * 2)).
- Hover and focus: buttons, links, and cards get a transition of 150ms to 250ms on transform, box-shadow, background-color, or color, with the same look on :focus-visible.
- Add one @media (prefers-reduced-motion: reduce) block that sets transition: none and animation: none on everything your own CSS animates.

MOTION RULES (editor presets, the only entrance animations). Follow this recipe exactly; it keeps every page within its limit:
- minimal (at most 8): the hero content block, and each section's <h2>. Nothing else.
- editorial (at most 10): the hero content block, each section's <h2>, and the first three <article> cards of the first card group.
- bold (at most 12): the hero content block, each section's <h2>, and the first five <article> cards of the first card group.
- Attributes: data-apx-anim (fade, slide-up, slide-down, slide-left, slide-right, or zoom-in, limited to your direction's list), data-apx-speed (fast, normal, or slow, limited to your direction's list), and data-apx-delay only on the cards, staggered 0.1, 0.2, 0.3 and so on, using exactly one of: ${DELAYS}.
- The hero content block is a <div> inside the hero section. Never put data-apx-anim on <section>, <ul>, <li>, <figure>, <dt>, <dd>, <p>, anything inside a <form>, <header>, <nav>, <footer>, <a>, <span>, <em>, or buttons.
- Never write data-apx-hover, never write your own entrance @keyframes or reveal script, and never write <style data-apexium-anim> or <script data-apexium-anim> blocks: the platform adds them.

LOGO (spec 0008):
- In the header brand, before the site name, draw ONE simple geometric mark as inline SVG, then the name as real text in its own <span>: <a class="brand" href="#"><span data-apexium-logo="ai"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg></span><span>Site Name</span></a>
- The mark: at most 6 shapes (path, circle, rect, ellipse, line, polyline, polygon, grouped with g if needed, plus at most one linearGradient or radialGradient inside defs) in a 24 by 24 viewBox. It should hint at what the site is about. No text or letters inside the SVG, no <text>, <image>, <use>, <style>, <script>, filters, or masks, no style, class, width, or height attributes.
- Colors only through the tokens: every fill, stroke, and stop-color is var(--color-primary), var(--color-on-primary), var(--color-text), another var(--color-...) token of yours, currentColor, none, or url(#id) of a gradient inside the same SVG. Never a hex, rgb, or named color.
- In the footer brand put an empty <span data-apexium-logo></span> before the site name; the platform fills it with the same mark.
- Never put data-apx-anim on the logo or its brand link.`;

/** Added to the plain CSS chat edit prompt, so edits keep the site's look (AC-8). */
export const EDIT_DESIGN_RULE = '- Keep the site\'s design system: reuse the :root tokens and the fonts already in <head>, keep any <meta name="apexium-direction"> unchanged, and style new parts to match that direction (its spacing, radius, and motion level). Never redefine the existing tokens unless the user asks to change colors or fonts.';
