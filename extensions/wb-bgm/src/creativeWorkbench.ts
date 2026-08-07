export type CreativeMode = 'voice' | 'generate';
export type GeneratedAudioKind = 'voice' | 'bgm' | 'sfx';
export type CreativeSourceMode = 'new' | 'customize';

export interface CreativeReference {
  assetId: string;
  name: string;
  kind: 'bgm' | 'sfx';
  version: string;
  resUrl: string;
}

export interface CreativeRequest {
  mode: CreativeMode;
  kind: GeneratedAudioKind;
  sourceMode: CreativeSourceMode;
  prompt: string;
  direction: string;
  durationSeconds: number;
  loop: boolean;
  instrumental: boolean;
  variationCount: number;
  projectId: string;
  reference?: CreativeReference;
  voice?: {
    script: string;
    roleId: string;
    role: string;
    emotion: string;
    language: string;
    speed: string;
  };
  modificationStrength?: 1 | 2 | 3;
}

export interface CreativeVersion {
  id: string;
  label: string;
  title: string;
  summary: string;
  tags: string[];
  durationSeconds: number;
  kind: GeneratedAudioKind;
  derivedFrom?: string;
  /** Real API audio. Optional only for legacy/offline fixtures. */
  base64?: string;
  mimeType?: string;
  dataUrl?: string;
  provider?: string;
  model?: string;
  traceId?: string;
  fileSizeBytes?: number;
  latencyMs?: number;
  /** Player wording retained for reproducibility. */
  originalRequest?: string;
  /** Compact prompt actually sent to the generation provider. */
  compiledPrompt?: string;
  /** Whether the text model compiled the prompt or the local safe template did. */
  promptSource?: 'skill' | 'fallback';
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateCreativeRequest(request: CreativeRequest): string | null {
  if (request.kind === 'voice' && !compact(request.voice?.script ?? '')) {
    return '请先输入要说的台词';
  }
  if (request.kind !== 'voice' && !compact(request.prompt)) {
    return '请先描述想生成的声音';
  }
  if (request.sourceMode === 'customize' && !request.reference) {
    return '请先从资产库选择一个参考声音';
  }
  return null;
}

export function creativeRequestSummary(request: CreativeRequest): string {
  if (request.kind === 'voice') {
    const voice = request.voice;
    return [
      voice?.script ? `“${compact(voice.script)}”` : '',
      voice?.role,
      voice?.emotion,
      compact(request.direction),
    ].filter(Boolean).join(' · ');
  }
  return [
    compact(request.prompt),
    compact(request.direction),
    request.sourceMode === 'customize' && request.reference
      ? `基于 ${request.reference.name}`
      : '',
    request.loop ? '可循环' : '自然结束',
    request.kind === 'bgm' && request.instrumental ? '纯音乐' : '',
  ].filter(Boolean).join(' · ');
}

export function formatCreativeDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
