import { buildStylePrompt } from '../shared/catalog';
import type { StylePreset } from '../shared/types';

export async function optimizeItemPrompt(
  depicts: string,
  style: StylePreset,
  hint?: string,
): Promise<{ prompt: string; source: 'llm' | 'heuristic' }> {
  const trimmed = depicts.trim();
  if (!trimmed) {
    throw Object.assign(new Error('depicts is required'), { code: 'missing_depicts' });
  }

  const baseUrl = (process.env.LITELLM_PROXY_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.LITELLM_PROXY_KEY ?? '';
  const model = process.env.LITELLM_PROXY_TEXT_MODEL ?? 'gpt-4o-mini';

  if (baseUrl && apiKey) {
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content:
                'You write concise English prompts for game inventory icon image generation. '
                + 'Return ONLY the optimized prompt text (no JSON, no quotes). '
                + 'Focus on: subject silhouette, material, color, pose, readability at 48px. '
                + 'Keep under 120 words.',
            },
            {
              role: 'user',
              content: [
                `Item to depict: ${trimmed}`,
                `Target art style: ${style.promptSuffix}`,
                hint?.trim() ? `User notes: ${hint.trim()}` : '',
              ].filter(Boolean).join('\n'),
            },
          ],
        }),
      });
      const raw = await resp.text();
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content?.trim();
      if (content && content.length >= 8) {
        return { prompt: content, source: 'llm' };
      }
    } catch {
      /* fall through */
    }
  }

  const extra = hint?.trim() ? ` ${hint.trim()}` : '';
  return {
    prompt: buildStylePrompt(`${trimmed}${extra}`, style),
    source: 'heuristic',
  };
}
