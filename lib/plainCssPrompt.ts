/**
 * Output rules shared by the plain CSS create and edit prompts (spec 0003 AC-1).
 * The editor's importer (`cssResolve.ts`) relies on this shape, so change both together.
 */
export const PLAIN_CSS_RULES = `HTML AND CSS RULES:
- Semantic HTML: <header>, <nav>, <main>, <section>, <footer>, <article>.
- ALL styling in exactly ONE <style> in <head>. No inline style="". No Tailwind or other CSS framework.
- Start the stylesheet with :root custom properties and reuse them with var(--name).
- Class selectors named by role (.hero, .card, .btn-primary, .site-footer), never utility names (flex, p-4). id only as a link target, never for styling.
- Responsive rules ONLY in @media (max-width: 1024px) and @media (max-width: 640px), desktop first. The only other media block is @media (prefers-reduced-motion: reduce).
- Hover and focus: transition with :hover/:focus-visible rules. Entrances: only the data-apx-* presets this prompt describes, never your own @keyframes or scripts.
- Keep the stylesheet compact (about 300 lines): reuse classes and custom properties instead of repeating declarations. No @layer, CSS nesting, or @container.
- Fonts: a Google Fonts <link rel="stylesheet"> in <head> (https://fonts.googleapis.com only).
- At most ONE inline <script> right before </body>, only for what CSS cannot do (like a mobile menu), never for reveals. No external libraries. Select by class or data-*, never id. A class it toggles is styled together with the element's own class (.site-nav.is-open), never alone.`;
