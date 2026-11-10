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

/** What the server fills in for each direction (spec 0012). These mirror `DESIGN_RULES` below. */
export const DIRECTION_DEFAULTS: Record<Direction, { preset: string; speed: string; heading: string; body: string; space: string; radius: string }> = {
  minimal: { preset: 'fade', speed: 'normal', heading: 'Inter, sans-serif', body: 'Inter, sans-serif', space: '24px', radius: '8px' },
  bold: { preset: 'slide-up', speed: 'fast', heading: '"Space Grotesk", sans-serif', body: 'Inter, sans-serif', space: '20px', radius: '16px' },
  editorial: { preset: 'fade', speed: 'normal', heading: '"Playfair Display", serif', body: '"Source Sans 3", sans-serif', space: '24px', radius: '4px' },
};

const DELAYS = DELAY_VALUES.join(', ');

const paletteLines = (direction: Direction) => PALETTES[direction]
  .map(([name, ...colors]) => `  ${name}: ${colors.join(' ')}`)
  .join('\n');

/** Replaces "Use modern, beautiful design with great UX" in the create prompt. */
export const DESIGN_RULES = `DIRECTION: pick ONE from the request, write <meta name="apexium-direction" content="DIRECTION"> in <head>, and follow it.
- minimal (consultants, studios, personal, calm products): Inter or DM Sans for both fonts. Wide margins, thin borders; --space 24px, --radius 8px. Motion: fade; speed normal or slow.
- bold (startups, events, fitness, campaigns): Space Grotesk or Syne headings, Inter body. Headline clamp up to 4.5rem, tight sections, color blocks; --space 20px, --radius 16px. Motion: slide-up, zoom-in, or fade; speed fast or normal.
- editorial (restaurants, blogs, portfolios, culture): Playfair Display headings with Source Sans 3 body, or Fraunces headings with Inter body. Magazine grid, asymmetric image and text pairs; --space 24px, --radius 4px. Motion: fade or slide-up; speed normal or slow.

TOKENS: :root defines ${REQUIRED_TOKENS.join(', ')}. The first six are the six colors of ONE palette of your direction, copied EXACTLY in this order as hex values, never var(). Extra tokens are for decoration only. Use tokens everywhere through var(), never a hard coded color. Buttons: background var(--color-primary), color var(--color-on-primary).
minimal:
${paletteLines('minimal')}
bold:
${paletteLines('bold')}
editorial:
${paletteLines('editorial')}

LAYOUT:
- Hero, 3 to 6 content sections, footer. One primary call to action above the fold. Content width near 1200px, centered.
- Card and feature groups are <article> elements in a grid, never <ul>/<li>.
- h1 3rem to 4.5rem, h2 2rem to 2.75rem, body 1rem to 1.125rem, line height 1.5 to 1.7. Spacing in multiples of --space.
- Buttons, links, and cards get a 150ms to 250ms transition, with the same look on :focus-visible.
- One @media (prefers-reduced-motion: reduce) block sets transition: none and animation: none.

MOTION (the only entrance animations, on exactly these targets):
- minimal (at most 8): the hero content block and each section's <h2>.
- editorial (at most 10): those, plus the first three <article> cards of the first card group.
- bold (at most 12): those, plus the first five such cards.
- data-apx-anim and data-apx-speed from your direction's list; data-apx-delay only on cards, staggered, one of: ${DELAYS}.
- The hero content block is a <div> inside the hero section. Never put data-apx-anim on <section>, <ul>, <li>, <figure>, <dt>, <dd>, <p>, anything inside a <form>, <header>, <nav>, <footer>, <a>, <span>, <em>, buttons, or the logo.
- Never write data-apx-hover, entrance @keyframes, an IntersectionObserver reveal script, or a data-apexium-anim block.

LOGO:
- Header: <a class="brand" href="#"><span data-apexium-logo="ai"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg></span><span>Site Name</span></a>
- The mark: one geometric shape hinting at the site, at most 6 path, circle, rect, ellipse, line, polyline, or polygon elements, optionally in g, plus at most one gradient in defs. No text, <image>, <use>, <style>, <script>, filters, masks, or style, class, width, or height attributes.
- Every fill, stroke, and stop-color is a var(--color-...) token, currentColor, none, or url(#id) of its gradient. Never a hex, rgb, or named color.
- Footer: an empty <span data-apexium-logo></span> before the site name; the platform fills it.`;

/** Added to the plain CSS chat edit prompt, so edits keep the site's look (AC-8). */
export const EDIT_DESIGN_RULE = '- Keep the site\'s design system: reuse the :root tokens and the fonts already in <head>, keep any <meta name="apexium-direction"> unchanged, and style new parts to match that direction (its spacing, radius, and motion level). Never redefine the existing tokens unless the user asks to change colors or fonts.';
