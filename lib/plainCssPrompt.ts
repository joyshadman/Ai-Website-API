/**
 * Output rules shared by the plain CSS create and edit prompts (spec 0003 AC-1).
 * The editor's importer (`cssResolve.ts`) relies on this shape, so change both together.
 */
export const PLAIN_CSS_RULES = `HTML AND CSS RULES:
- Write semantic HTML: <header>, <nav>, <main>, <section>, <footer>, <article> where they fit.
- Put ALL styling in exactly ONE <style> element inside <head>. Never use inline style="" attributes. Never use Tailwind or any CSS framework, and never load one.
- Start the stylesheet with :root custom properties for the palette, fonts, radii, and spacing, and reuse them everywhere with var(--name).
- Style with class selectors named by role (for example .hero, .card, .btn-primary, .site-footer). Never use utility style class names (like flex, p-4, text-center). Use id only as a link target, never for styling.
- Responsive rules go ONLY in @media (max-width: 1024px) and @media (max-width: 640px). Write desktop styles first. The one other media block allowed is @media (prefers-reduced-motion: reduce).
- Hover and focus motion uses transition and :hover/:focus-visible rules in the same stylesheet. Entrances use only the data-apx-* animation presets this prompt describes, never your own @keyframes or scripts for reveals.
- Keep the stylesheet compact (about 300 lines): reuse classes and custom properties instead of repeating declarations.
- Do not use @layer, CSS nesting, or @container.
- Load fonts with a Google Fonts <link rel="stylesheet"> in <head> (https://fonts.googleapis.com only).
- JavaScript is optional: at most ONE inline <script> right before </body>, for things CSS cannot do (like a mobile menu toggle), never for scroll reveals. No external script libraries. Select elements by class or data-* attribute, never by id. A class the script toggles must be styled together with the element's own class (for example .site-nav.is-open), never on its own.`;
