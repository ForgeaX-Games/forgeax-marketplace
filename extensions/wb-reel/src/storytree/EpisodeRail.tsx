import { useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { appendEpisodePass } from '../llm/forge/appendEpisodePass'
import { createTextProvider } from '../llm/providers/ClaudeAzureProvider'
import { makeBlankScene } from '../editor/storygraph/sceneFactory'
import { DEFAULT_EPISODE_ID } from '../scenario/schemaMigrate'
import { GenerationQueueIndicator } from '../forge/GenerationQueueIndicator'
import type { Episode } from '../scenario/types'
import { useT, tf } from '../i18n'

const EMPTY_EPISODES: Episode[] = []

/**
 * EpisodeRail —— 剧情树「左侧边栏」顶部的剧集栏 (2026-06-17 找回).
 *
 * 背景: 早期 StoryTreeTab 顶部有一条 EpisodeTabs(剧集切换), 在
 *   beddb60「剧情树详情 dock 归右列」重构里被一起拿掉了 —— 剧情树搬到左栏
 *   SceneMiniMap 后, 剧集 tab 没跟过来, 单集时干脆不显示, 也没有「新开一集」入口。
 *
 * 这条栏把剧集能力补回左栏, 且只读地依赖现有 store/LLM pass, 不重复造轮子:
 *   - 列出所有剧集 (单击切换 activeEpisodeId, 双击内联重命名)
 *   - 「＋ 新一集」展开续写面板:
 *       · AI 续写本集 → 复用 appendEpisodePass(锁定角色/场所/道具 + 注入前情)
 *         产出新一集的场景与分支, adoptForgedEpisode 落库, 自动切到新集并聚焦入口
 *       · 建空集 → 纯手动开一集(只放一个开场空节点), 作者自己拆
 *
 * 一致性保证: appendEpisodePass 把现有 characters/locations/props 作为
 *   LOCKED ANCHORS 注入 prompt, 既有角色/世界观/美术风格不会变, AI 只负责
 *   在前情基础上继续拆出新一集的剧情树。
 */
export interface EpisodeRailProps {
  /**
   * 是否在剧集栏右侧显示常驻「生成进度入口」(GenerationQueueIndicator)。
   * 默认 true(左侧边栏用)。剧情树详情(中间内容区)传 false —— 作者反馈
   * 队列在左栏已有一份, 中间这份重复且窄栏被截断, 故只留左栏那份。
   */
  showQueue?: boolean
}

export function EpisodeRail({ showQueue = true }: EpisodeRailProps = {}) {
  const t = useT()
  const episodes = useScenarioStore((s) => s.scenario.episodes ?? EMPTY_EPISODES)
  const updateEpisode = useScenarioStore((s) => s.updateEpisode)
  const addEpisode = useScenarioStore((s) => s.addEpisode)
  const ensureDefaultEpisode = useScenarioStore((s) => s.ensureDefaultEpisode)
  const sceneCount = useScenarioStore((s) => Object.keys(s.scenario.scenes).length)
  const addScene = useScenarioStore((s) => s.addScene)
  const selectScene = useScenarioStore((s) => s.selectScene)
  const adoptForgedEpisode = useScenarioStore((s) => s.adoptForgedEpisode)
  const activeEpisodeId = useShellStore((s) => s.activeEpisodeId)
  const setActiveEpisodeId = useShellStore((s) => s.setActiveEpisodeId)
  const focusSceneInStage = useShellStore((s) => s.focusSceneInStage)

  const llm = useMemo(() => createTextProvider(), [])

  const sorted = useMemo(
    () => [...episodes].sort((a, b) => a.order - b.order),
    [episodes],
  )
  const effectiveEpisodeId = useMemo(() => {
    if (sorted.length === 0) return undefined
    const valid = new Set(sorted.map((e) => e.id))
    if (activeEpisodeId && valid.has(activeEpisodeId)) return activeEpisodeId
    return sorted[0]?.id
  }, [sorted, activeEpisodeId])

  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [hint, setHint] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function establishFirstEpisode() {
    ensureDefaultEpisode()
    setActiveEpisodeId(DEFAULT_EPISODE_ID)
  }

  function jumpToEpisodeRoot(rootSceneId: string | undefined) {
    if (!rootSceneId) return
    selectScene(rootSceneId)
    focusSceneInStage(rootSceneId)
  }

  function resetComposer() {
    setComposing(false)
    setTitle('')
    setHint('')
    setPhase('idle')
    setErrorMsg('')
  }

  async function runAppend() {
    const trimmedHint = hint.trim()
    if (!trimmedHint) {
      setErrorMsg(t('episode.hintRequired'))
      setPhase('error')
      return
    }
    setPhase('running')
    setErrorMsg('')
    try {
      const scenario = useScenarioStore.getState().scenario
      const result = await appendEpisodePass(llm, {
        scenario,
        hint: trimmedHint,
        episodeTitle: title.trim() || undefined,
      })
      adoptForgedEpisode(result)
      setActiveEpisodeId(result.episode.id)
      jumpToEpisodeRoot(result.episode.rootSceneId)
      resetComposer()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  function createBlankEpisode() {
    const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    const epTitle = title.trim() || tf('episode.defaultTitle', { n: sorted.length + 1 })
    const starter = makeBlankScene({ title: `${epTitle} · ${t('episode.opening')}` })
    starter.episodeId = id
    addScene(starter)
    addEpisode({ id, title: epTitle, rootSceneId: starter.id })
    setActiveEpisodeId(id)
    jumpToEpisodeRoot(starter.id)
    resetComposer()
  }

  function confirmRename(id: string) {
    const next = renameValue.trim()
    if (next) updateEpisode(id, { title: next })
    setRenamingId(null)
    setRenameValue('')
  }

  const running = phase === 'running'

  return (
    <div className="ks-eprail" aria-label={t('episode.aria')}>
      <div className="ks-eprail-tabs" role="tablist" aria-label={t('episode.tabsAria')}>
        {sorted.length === 0 && (
          <button
            type="button"
            className="ks-eprail-establish"
            onClick={establishFirstEpisode}
            title={t('episode.establishTitle')}
          >
            ▸ {t('episode.establish')}
            {sceneCount > 0 ? tf('episode.establishScenes', { count: sceneCount }) : ''}
          </button>
        )}
        {sorted.map((ep) => (
          <div key={ep.id} className="ks-eprail-tabwrap">
            {renamingId === ep.id ? (
              <input
                className="ks-eprail-rename"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => confirmRename(ep.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename(ep.id)
                  if (e.key === 'Escape') {
                    setRenamingId(null)
                    setRenameValue('')
                  }
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveEpisodeId === ep.id}
                className={`ks-eprail-tab${effectiveEpisodeId === ep.id ? ' is-active' : ''}`}
                onClick={() => setActiveEpisodeId(ep.id)}
                onDoubleClick={() => {
                  setRenamingId(ep.id)
                  setRenameValue(ep.title)
                }}
                title={`${ep.title}${ep.synopsis ? ` · ${ep.synopsis}` : ''}\n${t('episode.renameHint')}`}
              >
                {ep.title}
              </button>
            )}
          </div>
        ))}

        {/* 常驻生成进度入口（图片 / 视频 / 音频），margin-left:auto 把它和
            「新一集」一起推到剧集栏右侧。点开看逐条进度 + 历史。
            仅左侧边栏显示一份；剧情树详情(中间)传 showQueue=false 不重复。 */}
        {showQueue && <GenerationQueueIndicator />}

        <button
          type="button"
          className={`ks-eprail-new${composing ? ' is-open' : ''}`}
          // 队列指示器(margin-left:auto)被隐藏时, 由「新一集」接管右推, 否则它会贴着 tab。
          style={!showQueue ? { marginLeft: 'auto' } : undefined}
          onClick={() => (composing ? resetComposer() : setComposing(true))}
          title={t('episode.newTitle')}
        >
          {composing ? t('episode.collapse') : t('episode.new')}
        </button>
      </div>

      {composing && (
        <div className="ks-eprail-composer">
          <input
            className="ks-eprail-title"
            value={title}
            disabled={running}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tf('episode.titlePlaceholder', { n: sorted.length + 1 })}
          />
          <textarea
            className="ks-eprail-hint-input"
            value={hint}
            disabled={running}
            onChange={(e) => setHint(e.target.value)}
            rows={3}
            placeholder={t('episode.hintPlaceholder')}
          />

          {phase === 'error' && errorMsg && (
            <div className="ks-eprail-err" role="alert">
              {errorMsg}
            </div>
          )}

          <div className="ks-eprail-actions">
            <button
              type="button"
              className="ks-eprail-go"
              onClick={runAppend}
              disabled={running}
            >
              {running ? t('episode.aiRunning') : t('episode.aiContinue')}
            </button>
            <button
              type="button"
              className="ks-eprail-blank"
              onClick={createBlankEpisode}
              disabled={running}
              title={t('episode.blankTitle')}
            >
              {t('episode.blankEpisode')}
            </button>
          </div>

          <div className="ks-eprail-note">{t('episode.note')}</div>
        </div>
      )}
    </div>
  )
}

injectStyleOnce('episode-rail', css())

function css(): string {
  return `
.ks-eprail {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-default, #404040);
  background: var(--color-background-base, #191919);
}

.ks-eprail-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.ks-eprail-tabs::-webkit-scrollbar { display: none; }

.ks-eprail-tabwrap { flex-shrink: 0; }

.ks-eprail-establish {
  all: unset;
  flex-shrink: 0;
  padding: 3px 11px;
  font-size: 10.5px;
  font-weight: 700;
  color: #0a0a0a;
  background: var(--color-brand-primary, #d4ff48);
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  white-space: nowrap;
  transition: filter .12s ease;
}
.ks-eprail-establish:hover { filter: brightness(1.08); }

.ks-eprail-tab {
  all: unset;
  flex-shrink: 0;
  padding: 2px 10px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  border-radius: var(--radius-pill, 999px);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.ks-eprail-tab:hover:not(.is-active) {
  color: var(--color-text-primary, #fff);
  background: var(--color-interaction-hover, rgba(255,255,255,0.06));
}
.ks-eprail-tab.is-active {
  color: var(--color-brand-primary, #d4ff48);
  background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 16%, transparent);
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 40%, transparent);
}

.ks-eprail-rename {
  width: 92px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary, #fff);
  background: var(--color-background-elevated, #242424);
  border: 1px solid var(--color-brand-primary, #d4ff48);
  border-radius: var(--radius-pill, 999px);
  outline: none;
}

.ks-eprail-new {
  all: unset;
  flex-shrink: 0;
  padding: 2px 10px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  border-radius: var(--radius-pill, 999px);
  border: 1px dashed var(--color-border-strong, #737373);
  cursor: pointer;
  white-space: nowrap;
  transition: color .12s ease, border-color .12s ease, background .12s ease;
}
.ks-eprail-new:hover,
.ks-eprail-new.is-open {
  color: var(--color-brand-primary, #d4ff48);
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 55%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 10%, transparent);
}

/* ── 续写面板 ─────────────────────────────────── */
.ks-eprail-composer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 10px 10px;
}

.ks-eprail-title,
.ks-eprail-hint-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  font-size: 11.5px;
  font-family: inherit;
  color: var(--color-text-primary, #fff);
  background: var(--color-background-elevated, #242424);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: 8px;
  outline: none;
  transition: border-color .12s ease;
}
.ks-eprail-title:focus,
.ks-eprail-hint-input:focus {
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 55%, transparent);
}
.ks-eprail-hint-input {
  resize: vertical;
  min-height: 52px;
  line-height: 1.5;
}
.ks-eprail-title::placeholder,
.ks-eprail-hint-input::placeholder { color: var(--color-text-tertiary, rgba(255,255,255,0.3)); }
.ks-eprail-title:disabled,
.ks-eprail-hint-input:disabled { opacity: 0.55; cursor: not-allowed; }

.ks-eprail-err {
  font-size: 11px;
  line-height: 1.45;
  color: #ffb0c0;
  background: color-mix(in srgb, #ff5d7a 12%, transparent);
  border: 1px solid color-mix(in srgb, #ff5d7a 32%, transparent);
  border-radius: 7px;
  padding: 6px 9px;
}

.ks-eprail-actions {
  display: flex;
  gap: 6px;
}
.ks-eprail-go {
  all: unset;
  flex: 1;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #0a0a0a;
  background: var(--color-brand-primary, #d4ff48);
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  transition: filter .12s ease, transform .12s ease;
}
.ks-eprail-go:hover:not(:disabled) { filter: brightness(1.08); }
.ks-eprail-go:active:not(:disabled) { transform: translateY(1px); }
.ks-eprail-go:disabled { opacity: 0.6; cursor: progress; }

.ks-eprail-blank {
  all: unset;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  background: var(--color-background-elevated, #242424);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  transition: color .12s ease, border-color .12s ease;
}
.ks-eprail-blank:hover:not(:disabled) {
  color: var(--color-text-primary, #fff);
  border-color: var(--color-border-strong, #737373);
}
.ks-eprail-blank:disabled { opacity: 0.5; cursor: not-allowed; }

.ks-eprail-note {
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-text-tertiary, rgba(255,255,255,0.35));
}
`
}
