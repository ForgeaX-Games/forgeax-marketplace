/**
 * SceneBgmPanel —— 剧情树节点详情里"给这场戏配 BGM"的小面板。
 *
 * 设计意图 (2026-05 作者反馈):
 *   - 用户痛点 1: BGM 不能突兀, 必须按"背景音乐纪律"约束 (soft entry / no chorus / vocal pocket / ...)
 *   - 用户痛点 2: 也要让用户能自己输入想要的感觉, 而不是完全自动化
 *   → 上方 "让 AI 配", 下方 "我自己写", 两条路径并存, 都喂同一个 MiniMax Music 接口.
 *
 * 数据流:
 *   1. "让 AI 配"  → composeSceneBgm(skill) 拿到 SceneBgmBrief (LLM 校验过的纪律 brief)
 *   2. "我自己写"  → 直接拿用户 prompt, brief 由 fallback 包装, userHintMode='C'
 *   3. → MiniMax Music generate(prompt) (instrumental, 无人声)
 *   4. → ingestDataUrl 落 mediaStore
 *   5. → setSceneBgm({ mediaId, prompt, ... }) 锚定到 scene
 *
 * 进度 / 取消:
 *   MinimaxMusicProvider.generate(req, { signal, onProgress }) 已支持心跳事件.
 *   我们订 'tick' 把 elapsedMs 渲染成 "已等待 N s · 取消", 失败 / 取消都有显式态.
 *
 * 不写入 mediaStore 的另存语义:
 *   生成成功才写; 失败 / 取消不污染 mediaStore.
 *   重新生成会"另起一条"新 mediaId, 旧锚点 mediaId 直接被覆盖 (用户主观决定).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { composeSceneBgm, type SceneBgmBrief } from '../llm/sceneBgmComposer'
import {
  getMinimaxMusicClient,
  type MusicProgressEvent,
} from '../llm/MinimaxMusicProvider'
import { createTextProvider } from '../llm/ClaudeAzureProvider'
import type { SceneBgmAnchor } from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'

interface Props {
  sceneId: string
}

/**
 * 把 elapsedMs 格化为 "12s" / "1m32s" —— UI 中文显示用.
 * 心跳事件 tick 每 5s 来一次, 这里只做纯格式化, 不掺业务.
 */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m${r}s`
}

/**
 * 把 SceneBgmBrief 拼成最终 SceneBgmAnchor.
 * 单独抽函数, 让 "AI 路径" 和 "用户写 prompt 路径" 共用同一份字段映射.
 */
function briefToAnchor(
  brief: SceneBgmBrief,
  mediaId: string,
  durationMs: number | undefined,
  userHint: string | undefined,
): SceneBgmAnchor {
  return {
    mediaId,
    prompt: brief.brief,
    chineseSummary: brief.chineseSummary,
    bpm: brief.bpm,
    genre: brief.genre,
    moodTags: brief.moodTags,
    keyInstruments: brief.keyInstruments,
    estDurationSec: brief.estDurationSec,
    userHint: userHint?.trim() || undefined,
    userHintMode: brief.userHintMode,
    durationMs,
    savedAt: Date.now(),
  }
}

export function SceneBgmPanel({ sceneId }: Props): React.ReactElement | null {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const scenario = useScenarioStore((s) => s.scenario)
  const setSceneBgm = useScenarioStore((s) => s.setSceneBgm)
  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const mediaEntries = useMediaStore((s) => s.entries)

  // —— 输入态 ————————————————————————————————————————————————
  const [aiHint, setAiHint] = useState('')
  const [userPrompt, setUserPrompt] = useState('')

  // —— 流转态 ——————————————————————————————————————————————————
  // status 单一状态机:
  //   'idle'        什么都没跑
  //   'composing'   LLM 在跑 sceneBgmComposer (~2-5s)
  //   'generating'  MiniMax 在跑 (~60-150s, 有心跳)
  //   'success'     全部完成 (UI 退回 idle 由 anchor 已存在反映)
  //   'failed'      LLM / 网络错; 显示 error 文案 + 再试一次
  //   'cancelled'   用户主动取消; 不显示 error, 只标"已取消"
  const [status, setStatus] = useState<
    'idle' | 'composing' | 'generating' | 'failed' | 'cancelled' | 'success'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const llm = useMemo(() => createTextProvider(), [])

  // 卸载时取消正在跑的请求, 避免内存泄漏 + UI 关闭后还在打 MiniMax
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // —— 当前已锚定的 BGM (展示卡片用) ——————————————————————————————
  const anchored = scene?.sceneBgm
  const anchoredEntry = anchored?.mediaId
    ? mediaEntries[anchored.mediaId]
    : undefined

  /**
   * 公共生成 pipeline —— AI 路径与用户 prompt 路径都走这.
   *
   * 步骤:
   *   1. (可选) 跑 sceneBgmComposer 把 hint/prompt → 合规 SceneBgmBrief
   *   2. 用 brief.brief 调 MiniMax (instrumental=true)
   *   3. ingestDataUrl 落库 → 拿 mediaId
   *   4. setSceneBgm 写入锚点
   *
   * brief 由调用方提供 (AI 路径 = LLM 输出; 用户路径 = userPrompt 包成 brief).
   * 这样组件内只有一处 MiniMax 调用 + 一处取消逻辑, 不会两份不一致.
   */
  const runGenerate = useCallback(
    async (brief: SceneBgmBrief, userHint?: string): Promise<void> => {
      const ctrl = new AbortController()
      abortRef.current?.abort()
      abortRef.current = ctrl
      setStatus('generating')
      setError(null)
      setElapsedMs(0)

      try {
        const client = getMinimaxMusicClient()
        const result = await client.generate(
          {
            prompt: brief.brief,
            isInstrumental: true,
            audioSetting: { format: 'mp3', sampleRate: 44100, bitrate: 256000 },
          },
          {
            signal: ctrl.signal,
            tickIntervalMs: 1000,
            onProgress: (e: MusicProgressEvent) => {
              if (
                e.kind === 'request_sent' ||
                e.kind === 'tick' ||
                e.kind === 'response_received' ||
                e.kind === 'decoded'
              ) {
                setElapsedMs(e.elapsedMs)
              }
            },
          },
        )
        if (ctrl.signal.aborted) return
        const mediaId = ingestDataUrl(result.dataUrl, {
          mimeType: result.mimeType,
          name: `bgm-${sceneId}-${Date.now()}.mp3`,
          sceneId,
        })
        const anchor = briefToAnchor(brief, mediaId, result.durationMs, userHint)
        setSceneBgm(sceneId, anchor)
        setStatus('success')
      } catch (err) {
        if (ctrl.signal.aborted) {
          setStatus('cancelled')
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setStatus('failed')
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null
      }
    },
    [sceneId, setSceneBgm, ingestDataUrl],
  )

  /**
   * "让 AI 配" —— 跑 composeSceneBgm 拿 brief, 再喂 MiniMax.
   *
   * directorPersona / visualStyle 从 scenario 提取, scenes 只送当前一场.
   * 后续可以扩到"前后两场"提供叙事连贯, MVP 先单场.
   */
  const runAiCompose = useCallback(async (): Promise<void> => {
    if (!scene) return
    setStatus('composing')
    setError(null)
    try {
      const brief = await composeSceneBgm(llm, {
        scenes: [scene],
        scenario,
        directorPersona:
          scenario.directorCustomPersona || scenario.directorStyle,
        visualStyle: scenario.visualStyle,
        userHint: aiHint.trim() || undefined,
      })
      await runGenerate(brief, aiHint)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStatus('failed')
    }
  }, [scene, scenario, llm, aiHint, runGenerate])

  /**
   * "我自己写" —— 用户已经给了完整 prompt (中文/英文都行),
   * 包成 SceneBgmBrief 直接喂 MiniMax. 这里不再走 LLM, 给"完全人控"的口子.
   *
   * 字段填默认值的依据:
   *   - moodTags / genre / keyInstruments 留 ['custom'] 占位, anchor 字段必填
   *   - userHintMode 标 'C', 与 skill 文档一致
   *   - chineseSummary 用 prompt 头 40 字, UI 卡片标题用
   */
  const runUserPrompt = useCallback(async (): Promise<void> => {
    const text = userPrompt.trim()
    if (!text) return
    const brief: SceneBgmBrief = {
      brief: text,
      moodTags: ['custom'],
      bpm: 90,
      genre: 'custom',
      keyInstruments: ['custom'],
      estDurationSec: 90,
      chineseSummary: text.slice(0, 40),
      userHintMode: 'C',
      fallback: false,
    }
    await runGenerate(brief, text)
  }, [userPrompt, runGenerate])

  const onCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const onClear = useCallback(() => {
    setSceneBgm(sceneId, undefined)
    setStatus('idle')
    setError(null)
  }, [sceneId, setSceneBgm])

  const busy = status === 'composing' || status === 'generating'

  if (!scene) return null

  return (
    <div className="ks-bgm-panel">
      <div className="ks-bgm-panel-head">
        <span className="ks-mono ks-bgm-kicker">SCENE BGM</span>
        <span className="ks-bgm-sub ks-cn">
          影视级背景音乐 · 不突兀 · MiniMax Music 2.6
        </span>
      </div>

      {/* 已锚定卡片 —— 有 anchor 时常驻顶部, 给"试听 + 清除"快捷入口 */}
      {anchored && (
        <SceneBgmAnchoredCard
          anchor={anchored}
          previewUrl={anchoredEntry?.url}
          onClear={onClear}
        />
      )}

      {/* 双栏: 左 "让 AI 配", 右 "我自己写" —— 作者明确要求两栏并存 */}
      <div className="ks-bgm-cols">
        <SceneBgmAiColumn
          hint={aiHint}
          onHintChange={setAiHint}
          onRun={runAiCompose}
          busy={busy}
        />
        <SceneBgmUserColumn
          prompt={userPrompt}
          onPromptChange={setUserPrompt}
          onRun={runUserPrompt}
          busy={busy}
        />
      </div>

      {/* 流转态: 进度 / 错误 / 取消 —— 三个互斥, 始终只显示一个 */}
      <SceneBgmStatusLine
        status={status}
        elapsedMs={elapsedMs}
        error={error}
        onCancel={onCancel}
      />
    </div>
  )
}

/* ———— 子组件 ———————————————————————————————————————————————— */

/**
 * 已锚定 BGM 卡片 —— 顶部常驻条, 给作者一个"目前这场戏配的就是它"的明确锚点.
 *
 * 不显示完整 brief (太长), 只展示 chineseSummary + bpm/genre/moodTags 作为速读.
 * 试听走原生 <audio controls>, 浏览器自带 UI 已经够好, 不再自造控件.
 * 清除按钮触发上层 setSceneBgm(undefined), 不真去 mediaStore 删 entry
 * (留作版本回溯空间, 未来可以加"BGM 历史"面板).
 */
function SceneBgmAnchoredCard(props: {
  anchor: SceneBgmAnchor
  previewUrl?: string
  onClear: () => void
}): React.ReactElement {
  const { anchor, previewUrl, onClear } = props
  const tags = (anchor.moodTags ?? []).slice(0, 4)
  return (
    <div className="ks-bgm-anchor">
      <div className="ks-bgm-anchor-head">
        <div className="ks-bgm-anchor-title ks-cn">
          {anchor.chineseSummary || anchor.genre || '已锚定 BGM'}
        </div>
        <button
          type="button"
          className="ks-bgm-anchor-clear"
          onClick={onClear}
          title="清除当前 BGM 锚点 (mediaStore 中音频保留)"
        >
          清除
        </button>
      </div>
      <div className="ks-bgm-anchor-meta ks-mono">
        {anchor.bpm} BPM · {anchor.genre}
        {anchor.userHintMode ? ` · mode=${anchor.userHintMode}` : ''}
      </div>
      {tags.length > 0 && (
        <div className="ks-bgm-anchor-tags">
          {tags.map((t) => (
            <span key={t} className="ks-bgm-tag ks-mono">
              {t}
            </span>
          ))}
        </div>
      )}
      {previewUrl ? (
        <audio
          className="ks-bgm-anchor-audio"
          src={previewUrl}
          controls
          preload="metadata"
        />
      ) : (
        <div className="ks-bgm-anchor-noaudio ks-mono">
          (mediaStore 中音频已被回收, 重新生成可恢复)
        </div>
      )}
    </div>
  )
}

/**
 * "让 AI 配" 列 —— hint 输入框 + 发起按钮.
 *
 * hint 可空, 空着就是"你 (LLM) 全权决定"; 填了就是 mode A/B/C 之一,
 * 由 sceneBgmComposer 自决. UI 这里不预判档位, 全部交给 skill.
 *
 * busy 时按钮禁用 + 文案换成"生成中…", 输入仍可改 (取消后不丢已输入的 hint).
 */
function SceneBgmAiColumn(props: {
  hint: string
  onHintChange: (v: string) => void
  onRun: () => void
  busy: boolean
}): React.ReactElement {
  const { hint, onHintChange, onRun, busy } = props
  return (
    <div className="ks-bgm-col">
      <div className="ks-bgm-col-title ks-cn">让 AI 配</div>
      <div className="ks-bgm-col-hint ks-mono">
        中文粗描述 / 参考曲风 / 英文 prompt 都行 · 留空则全自动
      </div>
      <textarea
        className="ks-bgm-textarea"
        rows={3}
        value={hint}
        onChange={(e) => onHintChange(e.target.value)}
        placeholder="例: 钢琴主导, 雨夜独行, 不要鼓; 或 like 90s Hong Kong neo-noir"
        disabled={busy}
      />
      <button
        type="button"
        className="ks-bgm-btn ks-bgm-btn-primary"
        onClick={onRun}
        disabled={busy}
      >
        {busy ? '生成中…' : '让 AI 配 BGM'}
      </button>
    </div>
  )
}

/**
 * "我自己写" 列 —— 用户直接灌完整 prompt, 不经 LLM 加工.
 *
 * 故意不接 sceneBgmComposer: 作者发飙过 "别全自动", 这条路径就是给他完全人控的.
 * 风险: 用户写了"突兀的歌曲式"prompt, MiniMax 真会照做. UI 这里只在 hint 文案
 * 提醒一下, 不强拦截 (mode C 的纪律软化已经在 sceneBgmComposer 那条路径里).
 */
function SceneBgmUserColumn(props: {
  prompt: string
  onPromptChange: (v: string) => void
  onRun: () => void
  busy: boolean
}): React.ReactElement {
  const { prompt, onPromptChange, onRun, busy } = props
  const empty = prompt.trim().length === 0
  return (
    <div className="ks-bgm-col">
      <div className="ks-bgm-col-title ks-cn">我自己写</div>
      <div className="ks-bgm-col-hint ks-mono">
        直接灌 MiniMax prompt · 不经 LLM 加工 · 自己保证不突兀
      </div>
      <textarea
        className="ks-bgm-textarea"
        rows={3}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="例: cinematic neo-noir underscore, 72 bpm, muted trumpet, upright bass, sustained, loopable"
        disabled={busy}
      />
      <button
        type="button"
        className="ks-bgm-btn"
        onClick={onRun}
        disabled={busy || empty}
      >
        {busy ? '生成中…' : '直接生成'}
      </button>
    </div>
  )
}

/**
 * 状态行 —— 把"composing / generating / failed / cancelled / success" 映射到一个文案条.
 *
 * 互斥呈现, 不堆叠:
 *   - composing  → "AI 在写 brief…"
 *   - generating → "MiniMax 在跑 · 12s · 取消"
 *   - failed     → 红字 error + "再试一次" (再试由用户重新点按钮, 这里不留)
 *   - cancelled  → 浅字"已取消"
 *   - success / idle → 完全不渲染 (避免成功后还有干扰条)
 *
 * elapsedMs 在 generating 才有意义. composing 不显示 elapsed (LLM 通常 <5s, 不值得).
 */
function SceneBgmStatusLine(props: {
  status: 'idle' | 'composing' | 'generating' | 'failed' | 'cancelled' | 'success'
  elapsedMs: number
  error: string | null
  onCancel: () => void
}): React.ReactElement | null {
  const { status, elapsedMs, error, onCancel } = props
  if (status === 'idle' || status === 'success') return null
  if (status === 'composing') {
    return (
      <div className="ks-bgm-status">
        <span className="ks-bgm-spinner" aria-hidden />
        <span className="ks-cn">AI 在写 brief…</span>
      </div>
    )
  }
  if (status === 'generating') {
    return (
      <div className="ks-bgm-status">
        <span className="ks-bgm-spinner" aria-hidden />
        <span className="ks-cn">MiniMax 在跑</span>
        <span className="ks-mono">· {formatElapsed(elapsedMs)}</span>
        <button
          type="button"
          className="ks-bgm-status-cancel"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="ks-bgm-status is-error">
        <span className="ks-cn">生成失败:</span>
        <span className="ks-mono">{error ?? 'unknown error'}</span>
      </div>
    )
  }
  // cancelled
  return (
    <div className="ks-bgm-status is-muted">
      <span className="ks-cn">已取消</span>
    </div>
  )
}

/* ———— 样式 ———————————————————————————————————————————————— */

const css = `
.ks-bgm-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
  min-width: 0;
}
.ks-bgm-panel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.ks-bgm-kicker {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-bgm-sub {
  font-size: 11px;
  color: var(--ks-text-dim);
}
.ks-bgm-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ks-bgm-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-bgm-col-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ks-text);
}
.ks-bgm-col-hint {
  font-size: 10.5px;
  color: var(--ks-text-dim);
  letter-spacing: 0.02em;
}
.ks-bgm-textarea {
  width: 100%;
  resize: vertical;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 12px;
  color: var(--ks-text);
  background: var(--ks-surface);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  padding: 6px 8px;
  outline: none;
  transition: border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-bgm-textarea:focus-visible {
  border-color: var(--ks-amber);
}
.ks-bgm-textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ks-bgm-btn {
  align-self: flex-start;
  cursor: pointer;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11.5px;
  padding: 5px 12px;
  color: var(--ks-text);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: 999px;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-bgm-btn:hover:not(:disabled) {
  border-color: var(--ks-border-strong);
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-bgm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ks-bgm-btn-primary {
  background: rgba(255, 123, 61, 0.78);
  border-color: rgba(255, 123, 61, 0.88);
  color: var(--color-text-on-bright-primary);
}
.ks-bgm-btn-primary:hover:not(:disabled) {
  background: rgba(255, 123, 61, 0.95);
  color: var(--color-text-on-bright-primary);
}
.ks-bgm-anchor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255, 123, 61, 0.05);
  border: 1px solid rgba(255, 123, 61, 0.32);
  border-radius: var(--ks-radius-sm);
}
.ks-bgm-anchor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ks-bgm-anchor-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ks-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-bgm-anchor-clear {
  all: unset;
  cursor: pointer;
  font-size: 10.5px;
  color: var(--ks-text-dim);
  padding: 2px 8px;
  border: 1px solid var(--ks-border);
  border-radius: 999px;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-bgm-anchor-clear:hover {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
}
.ks-bgm-anchor-meta {
  font-size: 10.5px;
  color: var(--ks-text-dim);
  letter-spacing: 0.04em;
}
.ks-bgm-anchor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ks-bgm-tag {
  font-size: 10px;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  color: var(--ks-amber);
  background: rgba(255, 123, 61, 0.1);
  border: 1px solid rgba(255, 123, 61, 0.32);
  border-radius: 999px;
}
.ks-bgm-anchor-audio {
  width: 100%;
  height: 32px;
}
.ks-bgm-anchor-noaudio {
  font-size: 10.5px;
  color: var(--ks-text-dim);
  font-style: italic;
}
.ks-bgm-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text);
}
.ks-bgm-status.is-error {
  background: rgba(255, 80, 80, 0.08);
  border-color: rgba(255, 80, 80, 0.4);
  color: rgba(255, 200, 200, 0.95);
}
.ks-bgm-status.is-muted {
  color: var(--ks-text-dim);
}
.ks-bgm-status-cancel {
  margin-left: auto;
  cursor: pointer;
  font-size: 10.5px;
  color: var(--ks-text-dim);
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--ks-border);
  border-radius: 999px;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-bgm-status-cancel:hover {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
}
.ks-bgm-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: var(--ks-amber);
  animation: ks-bgm-spin 800ms linear infinite;
}
@keyframes ks-bgm-spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 720px) {
  .ks-bgm-cols { grid-template-columns: 1fr; }
}
`

injectStyleOnce('scene-bgm-panel', css)
