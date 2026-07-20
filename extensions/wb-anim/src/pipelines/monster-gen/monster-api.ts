const BASE = '/__ce-api__/monster'

/* ── Types ──────────────────────────────────────────────────────── */

export interface MonsterConfig {
  name: string
  desc: string
  color1: string
  color2: string
  color3: string
  body: string
  cat1: string
  cat2: string
  cat3: string
  style: string
  morph: string
  angle: string
  model: string
  api_key: string
  api_base: string
}

export interface StartResult {
  pid: string
  monster_name: string
  pipeline_id?: string
}

export interface SSEEvent {
  type: string
  direction?: string
  anim?: string
  pair_key?: string
  progress?: number
  total?: number
  message?: string
  url?: string
  hero_url?: string
  error?: string
  download_url?: string
}

export interface PipelineState {
  directions: Record<string, DirectionState>
}

export interface DirectionState {
  status: string
  pairs: Record<string, PairState>
}

export interface PairState {
  raw?: string | null
  nobg?: string | null
  frames?: string[]
}

export interface HistoryEntry {
  id: string
  name: string
  desc: string
  timestamp: string
  hero_url?: string
  thumbnail?: string
}

/* ── API Calls ──────────────────────────────────────────────────── */

export async function startPipeline(config: MonsterConfig): Promise<StartResult> {
  const resp = await fetch(`${BASE}/pipeline/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!resp.ok) throw new Error(`启动失败 (${resp.status})`)
  const data = await resp.json()
  return {
    pid: data.pipeline_id || data.pid,
    monster_name: data.monster_name || config.name,
    ...data,
  }
}

export async function generatePrompts(config: MonsterConfig): Promise<Record<string, string>> {
  const resp = await fetch(`${BASE}/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!resp.ok) throw new Error(`生成提示词失败 (${resp.status})`)
  return resp.json()
}

export async function getState(pid: string): Promise<PipelineState> {
  const resp = await fetch(`${BASE}/pipeline/state/${pid}`)
  if (!resp.ok) throw new Error(`获取状态失败 (${resp.status})`)
  return resp.json()
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const resp = await fetch(`${BASE}/history`)
  if (!resp.ok) return []
  const data = await resp.json()
  return data.entries || data || []
}

export async function deleteHistory(entryId: string): Promise<void> {
  await fetch(`${BASE}/history/${entryId}`, { method: 'DELETE' })
}

export async function listMonsters(): Promise<string[]> {
  const resp = await fetch(`${BASE}/monsters`)
  if (!resp.ok) return []
  const data = await resp.json()
  return data.monsters || []
}

/* ── SSE ────────────────────────────────────────────────────────── */

export function connectSSE(pid: string, onEvent: (data: SSEEvent) => void): EventSource {
  const es = new EventSource(`${BASE}/pipeline/status/${pid}`)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      onEvent(data)
    } catch { /* ignore parse errors */ }
  }
  es.onerror = () => {
    onEvent({ type: 'error', error: 'SSE 连接断开' })
  }
  return es
}

/* ── Hero-only generation ────────────────────────────────────────── */

export interface HeroResult {
  ok: boolean
  monster_name: string
  hero_url: string
  error?: string
}

export async function generateHero(config: Record<string, unknown>): Promise<HeroResult> {
  const resp = await fetch(`${BASE}/generate-hero`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const data = await resp.json()
  if (!resp.ok || data.error) throw new Error(data.error || `立绘生成失败 (${resp.status})`)
  return data
}

/* ── URL Helpers ─────────────────────────────────────────────────── */

export function heroUrl(monster: string): string {
  return `${BASE}/hero/${monster}`
}

export function previewUrl(monster: string, dir: string, anim: string): string {
  return `${BASE}/preview/${monster}/${dir}/${anim}`
}

export function downloadUrl(monster: string): string {
  return `${BASE}/download/${monster}`
}

export function spriteStripUrl(monster: string, dir: string, anim: string): string {
  return `${BASE}/preview/${monster}/${dir}/${anim}.png`
}

export function gifUrl(monster: string, dir: string, anim: string): string {
  return `${BASE}/preview/${monster}/${dir}/${anim}.gif`
}
