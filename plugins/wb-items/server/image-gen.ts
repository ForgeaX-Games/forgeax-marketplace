import { evaluateRawQuality, GOLD_RAW_SIZE } from '../shared/pipeline-quality';
import type { IconDelivery } from '../shared/types';
import { validateRawIconBuffer } from './icon-audit';

const MAX_GENERATION_ATTEMPTS = 5;
const EDITS_IMAGE_MODEL = 'gpt-image-2';

function cleanB64(s: string): string {
  return s.replace(/^data:[^;]+;base64,/, '');
}

export function litellmImageConfigured(): boolean {
  return !!(process.env.LITELLM_PROXY_BASE_URL && process.env.LITELLM_PROXY_KEY);
}

function buildGenerationBrief(
  prompt: string,
  attempt: number,
  hasRefs: boolean,
  delivery: IconDelivery = 'png-pixel',
): string {
  const pixel = delivery === 'png-pixel';

  const retryLines = attempt > 1
    ? (pixel
      ? [
        `[Regeneration ${attempt}/${MAX_GENERATION_ATTEMPTS}] Previous image was REJECTED.`,
        'You MUST fix: square 1024×1024 canvas, object fills 75–85% of frame, TRUE pixel art (hard edges, flat color blocks, NO anti-aliasing).',
        'Previous image looked like smooth illustration — reject blur and soft gradients.',
      ]
      : [
        `[Regeneration ${attempt}/${MAX_GENERATION_ATTEMPTS}] Previous painted icon was REJECTED.`,
        'Fix: square 1024×1024, single centered item, 70–85% frame fill, clean silhouette on #FFFFFF.',
        'Keep the PAINTED / illustrated style — do NOT switch to pixel art.',
      ])
    : [];

  const refLines = hasRefs
    ? (pixel
      ? [
        '',
        '=== REFERENCE IMAGES ===',
        'Use the attached reference image(s) for style, palette, and silhouette guidance.',
        'Match the reference art style while drawing the requested item subject.',
        'Do NOT copy unrelated objects from the reference — only style and rendering.',
      ]
      : [
        '',
        '=== REFERENCE IMAGES (palette / subject only) ===',
        'References are for SUBJECT shape and color mood ONLY.',
        'IGNORE pixel-art / retro-sprite rendering in references if present.',
        'You MUST render in the PAINTED / illustrated style described in the prompt — smooth edges, cel or soft shading.',
        'Do NOT copy unrelated objects from the reference.',
      ])
    : [];

  const outputLines = pixel
    ? [
      '=== MANDATORY OUTPUT (pixel master → downscale to inventory size later) ===',
      `- Resolution: EXACTLY ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE} pixels, 1:1 square PNG`,
      '- TRUE retro RPG pixel art at 1024px — solid color squares, zero blur, zero anti-aliasing',
      '- Hard pixel edges, clean silhouette, limited palette, no photographic blur',
    ]
    : [
      '=== MANDATORY OUTPUT (painted master → downscale to inventory size later) ===',
      `- Resolution: EXACTLY ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE} pixels, 1:1 square PNG`,
      '- Painted / illustrated game icon — smooth shading, gradients, and clean outlines ARE required',
      '- Rich colors, clean silhouette, no photographic noise, no UI chrome',
      '- CRITICAL: NOT pixel art — no square pixel blocks, no retro 8-bit/16-bit sprite, no chunky mosaic pixels',
      '- Anti-aliased edges and continuous tones; think mobile RPG / anime inventory art, not NES sprite',
    ];

  return [
    prompt,
    ...refLines,
    '',
    ...outputLines,
    '- Single inventory item, centered, object height/width ≈75–85% of canvas',
    '- Solid #FFFFFF background only (for cutout); no frame, no badge, no text',
    ...retryLines,
  ].join('\n');
}

export interface GenerateIconOptions {
  referenceImagesB64?: string[];
  delivery?: IconDelivery;
}

async function requestIconViaChat(
  prompt: string,
  attempt: number,
  referenceImagesB64: string[] | undefined,
  delivery: IconDelivery,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const baseUrl = (process.env.LITELLM_PROXY_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.LITELLM_PROXY_KEY ?? '';
  const model = process.env.LITELLM_PROXY_IMAGE_MODEL ?? 'gemini-3-pro-image';
  if (!baseUrl || !apiKey) {
    return { ok: false, error: '生图服务未连接' };
  }

  const refs = (referenceImagesB64 ?? []).map(cleanB64).filter(Boolean);
  const brief = buildGenerationBrief(prompt, attempt, refs.length > 0, delivery);
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  for (const b64 of refs) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }
  content.push({ type: 'text', text: brief });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 90_000);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
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

async function requestIconViaEdits(
  prompt: string,
  referenceImagesB64: string[],
  delivery: IconDelivery,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const baseUrl = (process.env.LITELLM_PROXY_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.LITELLM_PROXY_KEY ?? '';
  if (!baseUrl || !apiKey) {
    return { ok: false, error: '生图服务未连接' };
  }

  const refs = referenceImagesB64.map(cleanB64).filter(Boolean);
  if (refs.length === 0) {
    return { ok: false, error: '参考图为空' };
  }

  const fd = new FormData();
  fd.append('model', EDITS_IMAGE_MODEL);
  fd.append('prompt', buildGenerationBrief(prompt, 1, true, delivery));
  fd.append('n', '1');
  fd.append('size', '1024x1024');
  fd.append('response_format', 'b64_json');
  refs.forEach((b64, i) => {
    const bytes = Buffer.from(b64, 'base64');
    const blob = new Blob([bytes], { type: 'image/png' });
    fd.append('image[]', blob, `ref_${i}.png`);
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 90_000);
  try {
    const resp = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal: ctrl.signal,
    });
    const raw = await resp.text();
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      data?: Array<{ b64_json?: string }>;
    };
    if (!resp.ok) {
      return { ok: false, error: parsed.error?.message ?? `HTTP ${resp.status}` };
    }
    const b64 = parsed.data?.[0]?.b64_json;
    if (!b64) return { ok: false, error: 'edits API 未返回图片' };
    return { ok: true, buffer: Buffer.from(b64, 'base64') };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function requestIconImage(
  prompt: string,
  attempt: number,
  options?: GenerateIconOptions,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const delivery = options?.delivery ?? 'png-pixel';
  const refs = (options?.referenceImagesB64 ?? []).map(cleanB64).filter(Boolean);

  // edits API 容易把参考图里的像素风锁死；彩绘类走 multimodal chat + 完整 brief
  if (refs.length > 0 && attempt === 1 && delivery === 'png-pixel') {
    const edits = await requestIconViaEdits(prompt, refs, delivery);
    if (edits.ok) return edits;
  }

  return requestIconViaChat(prompt, attempt, refs, delivery);
}

/** 生图 → 质检 → 保存 HD raw；不合格则重试 */
export async function generateIconImage(
  prompt: string,
  options?: GenerateIconOptions,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const delivery = options?.delivery ?? 'png-pixel';
  let lastError = '生图失败';
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const result = await requestIconImage(prompt, attempt, options);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    const qa = await validateRawIconBuffer(result.buffer, { strict: true, delivery });
    if (qa.ok) return { ok: true, buffer: result.buffer };
    lastError = qa.error;
  }
  return { ok: false, error: `生图 ${MAX_GENERATION_ATTEMPTS} 次均未达质量线：${lastError}` };
}

export async function saveRawIcon(batchDir: string, slug: string, buffer: Buffer): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const out = resolve(batchDir, `${slug}-raw.png`);
  await writeFile(out, buffer);
  return out;
}

export { validateRawIconBuffer } from './icon-audit';
