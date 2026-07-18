import { buildStylePrompt, toAsciiSlug } from '../shared/catalog';
import type { StylePreset } from '../shared/types';
import type { ProposedItem } from '../shared/types';

const NUMBER_PREFIX = /^(?:\d+[\.\)、]|第[一二三四五六七八九十百千]+[个项、.]|[•\-*]\s*)/u;

function stripPrefix(line: string): string {
  let s = line.trim();
  for (let i = 0; i < 3 && NUMBER_PREFIX.test(s); i += 1) {
    s = s.replace(NUMBER_PREFIX, '').trim();
  }
  return s.replace(/[：:]\s*$/, '').trim();
}

function splitRequirementLines(text: string): string[] {
  return text
    .split(/[\n\r;；]+/)
    .flatMap((line) => line.split(/[,，、]/))
    .map(stripPrefix)
    .filter((s) => s.length >= 2);
}

function toSlug(label: string, index: number): string {
  return toAsciiSlug(label, index);
}

function guessEnglish(zh: string): string {
  if (/[a-zA-Z]/.test(zh)) return zh;
  return zh
    .replace(/图标|道具|物品/g, '')
    .trim() || zh;
}

export function parseRequirementsHeuristic(text: string, style: StylePreset): ProposedItem[] {
  const lines = splitRequirementLines(text);
  const seen = new Set<string>();
  const items: ProposedItem[] = [];

  for (const [index, line] of lines.entries()) {
    const depicts = line;
    let slug = toSlug(line, index);
    let n = 2;
    while (seen.has(slug)) {
      slug = `${toSlug(line, index)}-${n}`;
      n += 1;
    }
    seen.add(slug);

    const en = guessEnglish(line);
    items.push({
      slug,
      name: { zh: line, en },
      depicts,
      prompt: buildStylePrompt(depicts, style),
    });
  }

  return items;
}

export async function summarizeRequirementsText(
  text: string,
  style: StylePreset,
): Promise<{ items: ProposedItem[]; source: 'llm' | 'heuristic' }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw Object.assign(new Error('requirements text is required'), { code: 'missing_requirements' });
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
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'You parse game inventory icon requirements into JSON. Return ONLY a JSON array: '
                + '[{"slug":"kebab-case","name":{"zh":"中文名","en":"English"},"depicts":"what to draw"}]. '
                + 'One object per distinct item. Slugs must be unique kebab-case ASCII.',
            },
            { role: 'user', content: trimmed },
          ],
        }),
      });
      const raw = await resp.text();
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const rows = JSON.parse(jsonMatch[0]) as Array<{
          slug?: string;
          name?: { zh?: string; en?: string };
          depicts?: string;
        }>;
        const items: ProposedItem[] = rows
          .filter((r) => r.depicts || r.name?.zh || r.name?.en)
          .map((r, index) => {
            const zh = r.name?.zh ?? r.depicts ?? `item-${index + 1}`;
            const en = r.name?.en ?? guessEnglish(zh);
            const depicts = r.depicts ?? zh;
            const slug = (r.slug && /^[a-z0-9-]+$/.test(r.slug)) ? r.slug : toSlug(zh, index);
            return {
              slug,
              name: { zh, en },
              depicts,
              prompt: buildStylePrompt(depicts, style),
            };
          });
        if (items.length > 0) return { items, source: 'llm' };
      }
    } catch {
      /* fall through to heuristic */
    }
  }

  return { items: parseRequirementsHeuristic(trimmed, style), source: 'heuristic' };
}
