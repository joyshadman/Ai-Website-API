/**
 * The free AI models generation may use (spec 0010). Set `AI_MODELS` to change the list
 * without a deploy. Only `:free` ids are accepted, so a paid model can never be sent.
 */

const FREE_SUFFIX = ':free';

/** At most this many different models are tried for one generation. */
export const MAX_ATTEMPTS = 3;

export const DEFAULT_AI_MODELS = [
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'recursive/flint-v1.0:free',
] as const;

export function parseAiModels(raw: string | undefined): string[] {
    const ids = [...new Set((raw ?? '').split(',').map(id => id.trim()).filter(Boolean))];
    const free = ids.filter(id => id.endsWith(FREE_SUFFIX));
    const ignored = ids.filter(id => !id.endsWith(FREE_SUFFIX));
    if (ignored.length > 0) console.warn(`[ai-models] ignored non free ids in AI_MODELS: ${ignored.join(', ')}`);
    return free.length > 0 ? free : [...DEFAULT_AI_MODELS];
}

export const AI_MODELS: readonly string[] = parseAiModels(process.env.AI_MODELS);

export const PRIMARY_AI_MODEL: string = AI_MODELS[0] ?? DEFAULT_AI_MODELS[0];
