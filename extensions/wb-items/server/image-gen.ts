import { evaluateRawQuality, GOLD_RAW_SIZE } from '../shared/pipeline-quality';
import { validateRawIconBuffer } from './icon-audit';

const MAX_GENERATION_ATTEMPTS = 5;

function cleanB64(s: string): string {
  return s.replace(/^data:[^;]+;base64,/, '');
}

export function litellmImageConfigured(): boolean {
  return !!(process.env.LITELLM_PROXY_BASE_URL && process.env.LITELLM_PROXY_KEY);
}

function buildGenerationBrief(prompt: string, attempt: number): string {
  const retryLines = attempt > 1
    ? [
      `[Regeneration ${attempt}/${MAX_GENERATION_ATTEMPTS}] Previous image was REJECTED.`,
      'You MUST fix: square 1024×1024 canvas, object fills 75–85% of frame, TRUE pixel art (hard edges, flat color blocks, NO anti-aliasing).',
      'Previous image looked like smooth illustration — reject blur and soft gradients.',
    ]
    : [];

  return [
    prompt,
    '',
    '=== MANDATORY OUTPUT (source master, NOT the final 48px icon) ===',
    `- Resolution: EXACTLY ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE} pixels, 1:1 square PNG`,
    '- Master asset quality: true retro RPG pixel art at 1024px — solid color squares, zero blur, zero anti-aliasing',
    '- Single inventory item, centered, object height/width ≈75–85% of canvas',
    '- Hard pixel edges, clean silhouette, limited palette, no photographic blur',
    '- Solid #FFFFFF background only (for cutout); no frame, no badge, no text',
    '- This is the HD source; a separate pipeline will downscale to 48×48 later',
    ...retryLines,
  ].join('\n');
}

async function requestIconImage(prompt: string, attempt: number): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const baseUrl = (process.env.LITELLM_PROXY_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.LITELLM_PROXY_KEY ?? '';
  const model = process.env.LITELLM_PROXY_IMAGE_MODEL ?? 'gemini-3-pro-image';
  if (!baseUrl || !apiKey) {
    return { ok: false, error: '生图服务未连接' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 90_000);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: buildGenerationBrief(prompt, attempt) }],
        }],
        modalities: ['image'],
      }),
      signal: ctrl.signal,
    });
    const raw = await resp.text();
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    if (!resp.ok) {
      return { ok: false, error: parsed.error?.message ?? `HTTP ${resp.status}` };
    }
    const imgUrl = parsed.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl) return { ok: false, error: '生图 API 未返回图片' };
    const m = imgUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return { ok: false, error: '生图返回格式异常' };
    return { ok: true, buffer: Buffer.from(cleanB64(m[2]!), 'base64') };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** 生图 → 严格质检 → 原样保存 HD raw；不合格则重试，不做后处理「修复」 */
export async function generateIconImage(prompt: string): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  let lastError = '生图失败';
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const result = await requestIconImage(prompt, attempt);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    const qa = await validateRawIconBuffer(result.buffer, { strict: true });
    if (qa.ok) return { ok: true, buffer: result.buffer };
    lastError = qa.error;
  }
  return { ok: false, error: `生图 ${MAX_GENERATION_ATTEMPTS} 次均未达金标：${lastError}` };
}

export async function saveRawIcon(batchDir: string, slug: string, buffer: Buffer): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const out = resolve(batchDir, `${slug}-raw.png`);
  await writeFile(out, buffer);
  return out;
}

export { validateRawIconBuffer } from './icon-audit';
