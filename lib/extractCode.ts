/**
 * Extract a complete, renderable HTML document from an LLM response.
 *
 * LLMs frequently wrap generated output in markdown code fences or prepend /
 * append explanatory prose. This helper strips those and returns the first
 * full HTML document found. It returns `null` when the response contains no
 * usable HTML so callers can abort the operation instead of persisting empty
 * or broken code that would blank the preview and destroy existing data.
 */
export function extractHtmlCode(content: string | null | undefined): string | null {
    if (!content || !content.trim()) return null;

    let candidate = content.trim();

    // Strip surrounding markdown code fences (``` or ~~~) when present.
    candidate = candidate.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/```\s*$/, '');
    candidate = candidate.replace(/^~~~[a-zA-Z]*\s*\n?/, '').replace(/~~~\s*$/, '');

    // Prefer the first complete HTML document over any stray prose.
    const doc =
        candidate.match(/<!DOCTYPE\s+html>[\s\S]*?<\/html>/i) ??
        candidate.match(/<html[\s>][\s\S]*?<\/html>/i);
    if (doc) candidate = doc[0];

    candidate = candidate.trim();
    if (!candidate) return null;

    // Require a real document so partial or empty model output is never saved.
    if (!/<!doctype\s+html|<html[\s>]/i.test(candidate)) return null;

    return candidate;
}
