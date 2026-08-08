import {
  creativeRequestSummary,
  type CreativeRequest,
  type CreativeVersion,
  type GeneratedAudioKind,
} from './creativeWorkbench.ts';
import {
  compileCreativePrompt,
  promptForAudioVersion,
  type CompiledAudioPrompt,
} from './audioPromptSkill.ts';

interface HostAudioResponse {
  success?: boolean;
  error?: string;
  base64?: string;
  mimeType?: string;
  provider?: string;
  model?: string;
  traceId?: string;
  durationMs?: number;
  fileSizeBytes?: number;
}

export interface AudioGenerationCapability {
  configured: boolean;
  providers: string[];
}

export interface AudioGenerationStatus {
  tts: AudioGenerationCapability;
  music: AudioGenerationCapability;
  sfx: AudioGenerationCapability;
}

const ROLE_VOICES: Record<string, string[]> = {
  guard: [
    'zh_male_qingshuangnanda_mars_bigtts',
    'zh_male_wennuanahu_moon_bigtts',
    'zh_male_jingqiangkanye_moon_bigtts',
  ],
  hero: [
    'zh_male_yangguangqingnian_moon_bigtts',
    'zh_male_qingshuangnanda_mars_bigtts',
    'zh_male_wennuanahu_moon_bigtts',
  ],
  merchant: [
    'zh_female_zhixingnvsheng_mars_bigtts',
    'zh_female_cancan_mars_bigtts',
    'zh_male_qingshuangnanda_mars_bigtts',
  ],
  villain: [
    'zh_male_jingqiangkanye_moon_bigtts',
    'zh_female_gaolengyujie_moon_bigtts',
    'zh_male_wennuanahu_moon_bigtts',
  ],
  narrator: [
    'zh_female_zhixingnvsheng_mars_bigtts',
    'zh_male_jingqiangkanye_moon_bigtts',
    'zh_female_gaolengyujie_moon_bigtts',
  ],
  creature: [
    'zh_male_jingqiangkanye_moon_bigtts',
    'zh_female_popo_mars_bigtts',
    'zh_male_naiqimengwa_mars_bigtts',
  ],
};

function speedRatio(speed: string | undefined): number {
  if (speed === 'slow') return 0.82;
  if (speed === 'fast') return 1.18;
  return 1;
}

function endpointFor(kind: GeneratedAudioKind): string {
  if (kind === 'voice') return '/__ce-api__/reel-tts';
  if (kind === 'bgm') return '/__ce-api__/reel-music';
  return '/__ce-api__/reel-sfx';
}

function requestBody(
  request: CreativeRequest,
  compiled: CompiledAudioPrompt,
  versionIndex: number,
): Record<string, unknown> {
  const prompt = promptForAudioVersion(request, compiled, versionIndex);
  if (request.kind === 'voice') {
    const roleId = request.voice?.roleId || 'narrator';
    const voices = ROLE_VOICES[roleId] ?? ROLE_VOICES.narrator;
    return {
      text: request.voice?.script,
      voice: voices[versionIndex % voices.length],
      speed: speedRatio(request.voice?.speed),
      instructions: prompt,
    };
  }
  if (request.kind === 'bgm') {
    return {
      prompt,
      isInstrumental: request.instrumental,
      durationSeconds: request.durationSeconds,
      loop: request.loop,
    };
  }
  return {
    text: prompt,
    durationSeconds: Math.min(30, Math.max(0.5, request.durationSeconds)),
    loop: request.loop,
    promptInfluence: request.modificationStrength === 1
      ? 0.25
      : request.modificationStrength === 3 ? 0.7 : 0.45,
  };
}

function versionTitle(kind: GeneratedAudioKind, index: number): string {
  const titles = kind === 'voice'
    ? ['自然演绎', '备选音色', '情绪备选', '角色化版本']
    : kind === 'bgm'
      ? ['主方案', '氛围备选', '节奏备选', '结构备选']
      : ['主方案', '质感备选', '力度备选', '时序备选'];
  return titles[index] ?? `版本 ${index + 1}`;
}

function durationOf(request: CreativeRequest, response: HostAudioResponse): number {
  if (typeof response.durationMs === 'number' && response.durationMs > 0) {
    return response.durationMs / 1000;
  }
  if (request.kind === 'voice') {
    return Math.max(1, Math.ceil((request.voice?.script.length ?? 4) / 4));
  }
  return request.kind === 'sfx'
    ? Math.min(30, request.durationSeconds)
    : request.durationSeconds;
}

async function generateOne(
  request: CreativeRequest,
  compiled: CompiledAudioPrompt,
  requestId: string,
  index: number,
  signal?: AbortSignal,
): Promise<CreativeVersion> {
  const providerPrompt = promptForAudioVersion(request, compiled, index);
  const startedAt = Date.now();
  const response = await fetch(endpointFor(request.kind), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(request, compiled, index)),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as HostAudioResponse;
  if (!response.ok || !payload.success || !payload.base64) {
    throw new Error(payload.error || `音频生成失败（HTTP ${response.status}）`);
  }
  const mimeType = payload.mimeType || 'audio/mpeg';
  const label = String.fromCharCode(65 + Math.min(index, 25));
  return {
    id: `${requestId}:${index + 1}`,
    label,
    title: versionTitle(request.kind, index),
    summary: creativeRequestSummary(request),
    tags: [
      request.kind === 'voice' ? '角色语音' : request.kind === 'bgm' ? 'BGM' : '音效',
      request.sourceMode === 'customize' ? '参考导向生成' : '从零生成',
      request.loop ? '循环' : '',
      request.kind === 'bgm' && request.instrumental ? '纯音乐' : '',
      request.voice?.emotion ?? '',
      payload.provider ?? '',
    ].filter(Boolean),
    durationSeconds: durationOf(request, payload),
    kind: request.kind,
    derivedFrom: request.reference?.name,
    base64: payload.base64,
    mimeType,
    dataUrl: `data:${mimeType};base64,${payload.base64}`,
    provider: payload.provider || 'host',
    model: payload.model,
    traceId: payload.traceId,
    fileSizeBytes: payload.fileSizeBytes,
    latencyMs: Date.now() - startedAt,
    originalRequest: compiled.originalRequest,
    compiledPrompt: providerPrompt,
    promptSource: compiled.source,
  };
}

export async function fetchAudioGenerationStatus(): Promise<AudioGenerationStatus> {
  const response = await fetch('/__ce-api__/audio-generation-status');
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    capabilities?: AudioGenerationStatus;
  };
  if (!response.ok || !payload.success || !payload.capabilities) {
    throw new Error('无法读取音频生成服务状态');
  }
  return payload.capabilities;
}

export async function generateCreativeVersions(
  request: CreativeRequest,
  requestId: string,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CreativeVersion[]> {
  const total = Math.max(1, Math.min(4, Math.round(request.variationCount || 1)));
  const compiled = await compileCreativePrompt(request, fetch, signal);
  const versions: CreativeVersion[] = [];
  const errors: string[] = [];
  // Deliberately sequential: music/SFX APIs are expensive and commonly enforce
  // low account concurrency. A failed alternative never discards completed ones.
  for (let index = 0; index < total; index += 1) {
    if (signal?.aborted) throw new DOMException('音频生成已取消', 'AbortError');
    try {
      versions.push(await generateOne(request, compiled, requestId, index, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`版本 ${String.fromCharCode(65 + index)}：${error instanceof Error ? error.message : String(error)}`);
    }
    onProgress?.(index + 1, total);
  }
  if (!versions.length) throw new Error(errors.join('；') || '音频生成失败');
  return versions;
}

function extensionFor(mimeType: string | undefined): string {
  if (mimeType?.includes('wav')) return 'wav';
  if (mimeType?.includes('ogg')) return 'ogg';
  if (mimeType?.includes('flac')) return 'flac';
  return 'mp3';
}

function filenameFor(version: CreativeVersion): string {
  const stem = `${version.kind}-${version.title}-${version.id.slice(-12)}`
    .replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'generated-audio';
  return `${stem}.${extensionFor(version.mimeType)}`;
}

export function downloadCreativeVersion(version: CreativeVersion): void {
  if (!version.dataUrl) throw new Error('当前版本没有真实音频');
  const anchor = document.createElement('a');
  anchor.href = version.dataUrl;
  anchor.download = filenameFor(version);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function saveCreativeVersionToGame(
  version: CreativeVersion,
  slug: string,
): Promise<{ slug?: string; path?: string }> {
  if (!version.base64) throw new Error('当前版本没有真实音频');
  const kind = version.kind;
  const response = await fetch('/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolId: 'save-generated-audio',
      args: {
        slug,
        assetId: `generated:${version.id}`,
        name: `${version.kind === 'voice' ? '语音' : version.kind === 'bgm' ? 'BGM' : '音效'} · ${version.title}`,
        kind,
        base64: version.base64,
        mimeType: version.mimeType,
        filename: filenameFor(version),
        provider: version.provider,
        model: version.model,
      },
      caller: { kind: 'user' },
    }),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    result?: { slug?: string; path?: string };
  };
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.error || `保存失败（HTTP ${response.status}）`);
  }
  return envelope.result ?? {};
}
