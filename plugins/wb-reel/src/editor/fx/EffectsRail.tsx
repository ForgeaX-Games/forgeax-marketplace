import { useState } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useShellStore } from '../../shell/shellStore'
import { useClipSelection } from '../timeline/clipSelection'
import { useFxPresetStore } from '../../fx/fxPresetStore'
import {
  FX_CLIP_ANIM,
  FX_EFFECTS,
  FX_FILTERS,
  FX_STICKER_ANIM_IN,
  FX_STICKER_ANIM_OUT,
  FX_STICKERS,
  FX_TRANSITIONS,
  getTransitionPreset,
} from '../../fx/fxPresets'
import {
  makeInsertAdjustClip,
  makeInsertEffectClip,
  makeInsertFilterClip,
  makeInsertStickerClip,
} from '../timeline/insertFactories'
import { DOCK_MIME, serializeDockPayload, type DockDropPayload } from '../timeline/dndTypes'
import type { AdjustParams, ClipAnimSpec, Scene, Shot } from '../../scenario/types'

/** 取带合法时间码的 shots（升序）；多镜节点判定与渲染共用。 */
function timedShotsOf(scene: Scene | undefined): Shot[] {
  return (scene?.shots ?? [])
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && (s.endMs as number) > (s.startMs as number))
    .slice()
    .sort((a, b) => (a.startMs as number) - (b.startMs as number))
}

/** ms 落点命中的当前镜。 */
function shotAtMs(scene: Scene | undefined, ms: number): Shot | undefined {
  const shots = timedShotsOf(scene)
  return shots.find((s) => ms >= (s.startMs as number) && ms <= (s.endMs as number)) ?? shots[0]
}

/**
 * EffectsRail —— StagePane 右侧的「剪映式后期效果」检视栏。
 *
 * 六个内容 tab（转场 / 特效 / 贴纸 / 滤镜 / 调节 / 首尾动画）+「我的/收藏」。
 * 每个 tab 是预设卡片网格：
 *   - 卡片可拖到时间轴落点，或点「应用到当前位置」（hoverMs）。
 *   - 转场 / 首尾动画是节点级，直接写 scene.transition / scene.clipAnim。
 * 当时间轴选中某个 fx clip（filter/adjust/effect/sticker）时，下方显示该 clip
 * 的参数编辑器（强度 / 位置 / 旋转 / 时长……，调节给全套色彩滑块）。
 */

type RailTab = 'transition' | 'effect' | 'sticker' | 'filter' | 'adjust' | 'clipAnim' | 'speed' | 'mine'

const TABS: { id: RailTab; label: string }[] = [
  { id: 'transition', label: '转场' },
  { id: 'effect', label: '特效' },
  { id: 'sticker', label: '贴纸' },
  { id: 'filter', label: '滤镜' },
  { id: 'adjust', label: '调节' },
  { id: 'clipAnim', label: '首尾动画' },
  { id: 'speed', label: '变速' },
  { id: 'mine', label: '我的' },
]

const FX_DUR = 3000

export interface EffectsRailProps {
  sceneId: string
  hoverMs: number
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function EffectsRail({ sceneId, hoverMs, collapsed, onToggleCollapsed }: EffectsRailProps) {
  const [tab, setTab] = useState<RailTab>('transition')
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const fxSel = useClipSelection((s) => s.fxSelection)

  if (collapsed) {
    return (
      <div className="ks-fxrail is-collapsed">
        <button
          type="button"
          className="ks-fxrail-expand"
          onClick={onToggleCollapsed}
          title="展开后期效果栏"
        >
          <span className="ks-fxrail-expand-ico" aria-hidden>✦</span>
          <span className="ks-fxrail-expand-txt">效果</span>
        </button>
      </div>
    )
  }

  if (!scene) return <div className="ks-fxrail" />

  const total = scene.durationMs

  return (
    <div className="ks-fxrail">
      <div className="ks-fxrail-head">
        <span className="ks-fxrail-title ks-mono">后期效果</span>
        <button
          type="button"
          className="ks-fxrail-collapse"
          onClick={onToggleCollapsed}
          title="收起效果栏"
          aria-label="收起"
        >
          ›
        </button>
      </div>

      <div className="ks-fxrail-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ks-fxrail-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ks-fxrail-body">
        {tab === 'transition' && <TransitionTab sceneId={sceneId} hoverMs={hoverMs} />}
        {tab === 'effect' && <EffectTab sceneId={sceneId} hoverMs={hoverMs} total={total} />}
        {tab === 'sticker' && <StickerTab sceneId={sceneId} hoverMs={hoverMs} total={total} />}
        {tab === 'filter' && <FilterTab sceneId={sceneId} hoverMs={hoverMs} total={total} />}
        {tab === 'adjust' && <AdjustTab sceneId={sceneId} hoverMs={hoverMs} total={total} />}
        {tab === 'clipAnim' && <ClipAnimTab sceneId={sceneId} hoverMs={hoverMs} />}
        {tab === 'speed' && <SpeedTab sceneId={sceneId} hoverMs={hoverMs} />}
        {tab === 'mine' && <MineTab sceneId={sceneId} hoverMs={hoverMs} total={total} />}
      </div>

      {/* 选中 clip 的参数编辑器（contextual，跨 tab 常驻底部） */}
      {fxSel && <FxInspector sceneId={sceneId} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 通用：可拖拽 / 可点击应用的预设卡
// ─────────────────────────────────────────────────────────────────────

function PresetCard({
  glyph,
  label,
  active,
  onApply,
  payload,
  onFav,
  faved,
}: {
  glyph: string
  label: string
  active?: boolean
  onApply: () => void
  payload?: DockDropPayload
  onFav?: () => void
  faved?: boolean
}) {
  return (
    <div
      className={`ks-fx-card ${active ? 'is-active' : ''}`}
      draggable={!!payload}
      onDragStart={(e) => {
        if (!payload) return
        e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onApply}
      title={`${label} · 点击应用到当前位置，或拖到时间轴`}
    >
      <span className="ks-fx-card-glyph" aria-hidden>{glyph}</span>
      <span className="ks-fx-card-label">{label}</span>
      {onFav && (
        <button
          type="button"
          className={`ks-fx-card-fav ${faved ? 'is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onFav()
          }}
          title={faved ? '取消收藏' : '收藏'}
        >
          {faved ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 转场（剪映式两段视频衔接 · 落在 shot.transitionIn）
// ─────────────────────────────────────────────────────────────────────

function TransitionTab({ sceneId, hoverMs }: { sceneId: string; hoverMs: number }) {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const updateShot = useScenarioStore((s) => s.updateShot)
  const fxSel = useClipSelection((s) => s.fxSelection)
  const shots = timedShotsOf(scene)

  // 目标衔接镜：优先「已选中的转场」对应镜；否则取游标处的镜（须有前一镜，即非首镜）。
  const selShotId = fxSel?.kind === 'transition' ? fxSel.id : undefined
  const hoverShot = shotAtMs(scene, hoverMs)
  const targetShot =
    (selShotId ? shots.find((s) => s.id === selShotId) : undefined) ??
    (hoverShot && shots.findIndex((s) => s.id === hoverShot.id) >= 1 ? hoverShot : undefined)

  const cur = targetShot?.transitionIn

  if (shots.length < 2) {
    return (
      <div className="ks-fx-tabpane">
        <p className="ks-fx-hint">
          转场用于「两段视频之间」。本节点只有单段画面，暂无衔接点。
          需要切镜过场时，请先拆分多段镜头。前后渐显渐隐请用「首尾动画」。
        </p>
      </div>
    )
  }

  if (!targetShot) {
    return (
      <div className="ks-fx-tabpane">
        <p className="ks-fx-hint">
          剪映式做法：在下方 <b>VIDEO 轨两段视频的衔接处</b>点一下 <b>＋</b> 就能加转场。
          或把游标移到两段交界处，再在这里选类型。当前游标不在衔接点。
        </p>
      </div>
    )
  }

  const set = (presetId: string): void =>
    updateShot(sceneId, targetShot.id, {
      transitionIn: { presetId, durationMs: cur?.durationMs ?? getTransitionPreset(presetId)?.defaultDurationMs ?? 500 },
    })

  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">
        转场加在「镜{shots.findIndex((s) => s.id === targetShot.id)}→镜{shots.findIndex((s) => s.id === targetShot.id) + 1}」衔接处，
        闪黑/闪白在衔接点达到峰值。
      </p>
      <div className="ks-fx-grid">
        <PresetCard glyph="∅" label="无" active={!cur} onApply={() => updateShot(sceneId, targetShot.id, { transitionIn: undefined })} />
        {FX_TRANSITIONS.map((p) => (
          <PresetCard key={p.id} glyph="⇄" label={p.label} active={cur?.presetId === p.id} onApply={() => set(p.id)} />
        ))}
      </div>
      {cur && (
        <div className="ks-fx-param">
          <label className="ks-fx-row">
            <span>时长</span>
            <input
              type="range" min={150} max={2000} step={50}
              value={cur.durationMs}
              onChange={(e) => updateShot(sceneId, targetShot.id, { transitionIn: { ...cur, durationMs: Number(e.target.value) } })}
            />
            <span className="ks-mono">{(cur.durationMs / 1000).toFixed(2)}s</span>
          </label>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 特效
// ─────────────────────────────────────────────────────────────────────

function EffectTab({ sceneId, hoverMs, total }: { sceneId: string; hoverMs: number; total: number }) {
  const addEffectClip = useScenarioStore((s) => s.addEffectClip)
  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">叠层动效。点击在当前位置加一段，或拖到时间轴。</p>
      <div className="ks-fx-grid">
        {FX_EFFECTS.map((p) => (
          <PresetCard
            key={p.id}
            glyph="✦"
            label={p.label}
            payload={{ kind: 'effect', presetId: p.id, defaultDurationMs: FX_DUR }}
            onApply={() =>
              addEffectClip(sceneId, makeInsertEffectClip({ ms: hoverMs, sceneDurationMs: total, presetId: p.id }))
            }
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 贴纸
// ─────────────────────────────────────────────────────────────────────

function StickerTab({ sceneId, hoverMs, total }: { sceneId: string; hoverMs: number; total: number }) {
  const addStickerClip = useScenarioStore((s) => s.addStickerClip)
  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">点击在当前位置加贴纸，再到画面里拖动调位置。</p>
      <div className="ks-fx-grid">
        {FX_STICKERS.map((p) => {
          const isNumeric = !!p.numericTemplate
          const payload: DockDropPayload = isNumeric
            ? { kind: 'sticker', stickerKind: 'numeric', text: p.numericTemplate, defaultDurationMs: FX_DUR }
            : { kind: 'sticker', stickerKind: 'builtin', presetId: p.id, defaultDurationMs: FX_DUR }
          return (
            <PresetCard
              key={p.id}
              glyph={p.glyph}
              label={p.label}
              payload={payload}
              onApply={() =>
                addStickerClip(
                  sceneId,
                  makeInsertStickerClip({
                    ms: hoverMs,
                    sceneDurationMs: total,
                    stickerKind: isNumeric ? 'numeric' : 'builtin',
                    text: isNumeric ? p.numericTemplate : undefined,
                    presetId: isNumeric ? undefined : p.id,
                  }),
                )
              }
            />
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 滤镜
// ─────────────────────────────────────────────────────────────────────

function FilterTab({ sceneId, hoverMs, total }: { sceneId: string; hoverMs: number; total: number }) {
  const addFilterClip = useScenarioStore((s) => s.addFilterClip)
  const toggleFavorite = useFxPresetStore((s) => s.toggleFavorite)
  const favorites = useFxPresetStore((s) => s.favorites)
  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">点击在当前位置加一段滤镜，或拖到时间轴；★ 收藏到「我的」。</p>
      <div className="ks-fx-grid">
        {FX_FILTERS.map((p) => (
          <PresetCard
            key={p.id}
            glyph="◐"
            label={p.label}
            payload={{ kind: 'filter', presetId: p.id, defaultDurationMs: FX_DUR }}
            faved={favorites.includes(p.id)}
            onFav={() => toggleFavorite(p.id)}
            onApply={() =>
              addFilterClip(sceneId, makeInsertFilterClip({ ms: hoverMs, sceneDurationMs: total, presetId: p.id }))
            }
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 调节（手动色彩）
// ─────────────────────────────────────────────────────────────────────

function AdjustTab({ sceneId, hoverMs, total }: { sceneId: string; hoverMs: number; total: number }) {
  const addAdjustClip = useScenarioStore((s) => s.addAdjustClip)
  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">添加一段「调节」后，在下方参数区拖动各色彩滑块；可「存为我的预设」。</p>
      <button
        type="button"
        className="ks-fx-bigbtn"
        onClick={() => addAdjustClip(sceneId, makeInsertAdjustClip({ ms: hoverMs, sceneDurationMs: total }))}
      >
        ＋ 在当前位置添加调节段
      </button>
      <div
        className="ks-fx-dragchip"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DOCK_MIME, serializeDockPayload({ kind: 'adjust', defaultDurationMs: FX_DUR }))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        title="拖到时间轴的指定位置"
      >
        ⤢ 拖拽到时间轴
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 首尾动画（逐镜隔离 · 落在 shot.clipAnim；单视频节点回退 scene.clipAnim）
// ─────────────────────────────────────────────────────────────────────

function ClipAnimTab({ sceneId, hoverMs }: { sceneId: string; hoverMs: number }) {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const setClipAnim = useScenarioStore((s) => s.setClipAnim)
  const updateShot = useScenarioStore((s) => s.updateShot)
  const selectedShotId = useShellStore((s) => s.selectedShotId)

  const shots = timedShotsOf(scene)
  const multishot = shots.length >= 2
  // 多镜：作用于「选中的镜」，无选中则取游标处的镜；单视频：作用于整段（scene.clipAnim）。
  const targetShot = multishot
    ? (shots.find((s) => s.id === selectedShotId) ?? shotAtMs(scene, hoverMs))
    : undefined
  const a: ClipAnimSpec | undefined = targetShot ? targetShot.clipAnim : scene?.clipAnim

  function write(next: ClipAnimSpec | undefined): void {
    if (targetShot) updateShot(sceneId, targetShot.id, { clipAnim: next })
    else setClipAnim(sceneId, next)
  }
  function setEnd(end: 'in' | 'out', preset: string | null): void {
    const next: ClipAnimSpec = { ...(a ?? {}) }
    if (preset === null) {
      delete next[end]
    } else {
      next[end] = { preset, durationMs: next[end]?.durationMs ?? 600 }
    }
    const empty = !next.in && !next.out
    write(empty ? undefined : next)
  }
  function setDur(end: 'in' | 'out', durationMs: number): void {
    if (!a?.[end]) return
    write({ ...a, [end]: { ...a[end]!, durationMs } })
  }

  const shotIdx = targetShot ? shots.findIndex((s) => s.id === targetShot.id) + 1 : 0

  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">
        {multishot
          ? targetShot
            ? `作用于【镜 ${shotIdx}】这一段（在时间轴点选其他镜可切换；各镜首尾动画相互独立）。渐显渐隐默认黑底。`
            : '本节点是多段视频，请先在时间轴点选一段视频。'
          : '本节点画面的入场 / 出场动画。渐显渐隐默认黑底。'}
      </p>
      {(multishot && !targetShot ? [] : (['in', 'out'] as const)).map((end) => {
        const cur = a?.[end]
        const presets = FX_CLIP_ANIM.filter((p) => p.end === 'both' || p.end === end)
        return (
          <div key={end} className="ks-fx-animsec">
            <div className="ks-fx-animsec-title">{end === 'in' ? '入场' : '出场'}</div>
            <div className="ks-fx-grid">
              <PresetCard glyph="∅" label="无" active={!cur} onApply={() => setEnd(end, null)} />
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  glyph={end === 'in' ? '⤓' : '⤒'}
                  label={p.label}
                  active={cur?.preset === p.id}
                  onApply={() => setEnd(end, p.id)}
                />
              ))}
            </div>
            {cur && (
              <label className="ks-fx-row">
                <span>时长</span>
                <input
                  type="range"
                  min={150}
                  max={2500}
                  step={50}
                  value={cur.durationMs}
                  onChange={(e) => setDur(end, Number(e.target.value))}
                />
                <span className="ks-mono">{(cur.durationMs / 1000).toFixed(2)}s</span>
              </label>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 变速 / 定格（剪映式 · 落在 shot.speed）
// ─────────────────────────────────────────────────────────────────────

const SPEED_OPTS: { v: number; label: string }[] = [
  { v: 0, label: '定格' },
  { v: 0.5, label: '0.5×' },
  { v: 0.75, label: '0.75×' },
  { v: 1, label: '1×' },
  { v: 1.5, label: '1.5×' },
  { v: 2, label: '2×' },
]

function SpeedTab({ sceneId, hoverMs }: { sceneId: string; hoverMs: number }) {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const updateShot = useScenarioStore((s) => s.updateShot)
  const selectedShotId = useShellStore((s) => s.selectedShotId)

  const shots = timedShotsOf(scene)
  // 作用于「选中的镜」，无选中则取游标处的镜；都没有则回退首镜。
  const targetShot =
    shots.find((s) => s.id === selectedShotId) ?? shotAtMs(scene, hoverMs) ?? shots[0]

  if (!targetShot) {
    return (
      <div className="ks-fx-tabpane">
        <p className="ks-fx-hint">
          变速作用于「镜头视频段」。本节点暂无分镜镜头，先在时间轴拆出镜头再来调速。
        </p>
      </div>
    )
  }

  const cur = targetShot.speed ?? 1
  const shotIdx = shots.findIndex((s) => s.id === targetShot.id) + 1

  return (
    <div className="ks-fx-tabpane">
      <p className="ks-fx-hint">
        作用于【镜 {shotIdx}】这一段（在时间轴点选其他镜可切换）。
        <b>定格</b>＝画面停在当前帧（播放时暂停推进）；0.5×–2× 改视频播放倍速。
      </p>
      <div className="ks-fx-grid ks-fx-grid-3">
        {SPEED_OPTS.map((o) => (
          <PresetCard
            key={o.v}
            glyph={o.v === 0 ? '❙❙' : o.v < 1 ? '🐢' : o.v > 1 ? '🐇' : '▶'}
            label={o.label}
            active={Math.abs(cur - o.v) < 0.01}
            onApply={() => updateShot(sceneId, targetShot.id, { speed: o.v })}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 我的 / 收藏
// ─────────────────────────────────────────────────────────────────────

function MineTab({ sceneId, hoverMs, total }: { sceneId: string; hoverMs: number; total: number }) {
  const custom = useFxPresetStore((s) => s.custom)
  const removeCustom = useFxPresetStore((s) => s.removeCustom)
  const favorites = useFxPresetStore((s) => s.favorites)
  const addAdjustClip = useScenarioStore((s) => s.addAdjustClip)
  const addFilterClip = useScenarioStore((s) => s.addFilterClip)

  const favFilters = FX_FILTERS.filter((p) => favorites.includes(p.id))

  return (
    <div className="ks-fx-tabpane">
      <div className="ks-fx-animsec-title">收藏的滤镜</div>
      {favFilters.length === 0 ? (
        <p className="ks-fx-empty">还没有收藏 · 去「滤镜」tab 点 ☆</p>
      ) : (
        <div className="ks-fx-grid">
          {favFilters.map((p) => (
            <PresetCard
              key={p.id}
              glyph="◐"
              label={p.label}
              payload={{ kind: 'filter', presetId: p.id, defaultDurationMs: FX_DUR }}
              onApply={() =>
                addFilterClip(sceneId, makeInsertFilterClip({ ms: hoverMs, sceneDurationMs: total, presetId: p.id }))
              }
            />
          ))}
        </div>
      )}

      <div className="ks-fx-animsec-title" style={{ marginTop: 10 }}>我的调节预设</div>
      {custom.length === 0 ? (
        <p className="ks-fx-empty">在「调节」里调好参数后可「存为我的预设」</p>
      ) : (
        <div className="ks-fx-grid">
          {custom.map((p) => (
            <div key={p.id} className="ks-fx-card has-del">
              <span
                className="ks-fx-card-glyph"
                aria-hidden
                draggable
                onClick={() =>
                  addAdjustClip(
                    sceneId,
                    makeInsertAdjustClip({ ms: hoverMs, sceneDurationMs: total, params: p.params }),
                  )
                }
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    DOCK_MIME,
                    serializeDockPayload({ kind: 'adjust', params: p.params, defaultDurationMs: FX_DUR }),
                  )
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                title="点击应用 / 拖到时间轴"
              >
                ⚙
              </span>
              <span className="ks-fx-card-label">{p.label}</span>
              <button
                type="button"
                className="ks-fx-card-fav"
                onClick={() => removeCustom(p.id)}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 选中 clip 的参数编辑器
// ─────────────────────────────────────────────────────────────────────

const ADJUST_FIELDS: { key: keyof AdjustParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: '亮度', min: -1, max: 1 },
  { key: 'contrast', label: '对比度', min: -1, max: 1 },
  { key: 'saturation', label: '饱和度', min: -1, max: 1 },
  { key: 'temperature', label: '色温', min: -1, max: 1 },
  { key: 'hue', label: '色相', min: -180, max: 180 },
  { key: 'blur', label: '模糊', min: 0, max: 1 },
  { key: 'sepia', label: '怀旧', min: 0, max: 1 },
  { key: 'vignette', label: '暗角', min: 0, max: 1 },
  { key: 'grain', label: '颗粒', min: 0, max: 1 },
]

function FxInspector({ sceneId }: { sceneId: string }) {
  const fxSel = useClipSelection((s) => s.fxSelection)
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const updateFilterClip = useScenarioStore((s) => s.updateFilterClip)
  const updateAdjustClip = useScenarioStore((s) => s.updateAdjustClip)
  const updateEffectClip = useScenarioStore((s) => s.updateEffectClip)
  const updateStickerClip = useScenarioStore((s) => s.updateStickerClip)
  const updateShot = useScenarioStore((s) => s.updateShot)
  const addCustom = useFxPresetStore((s) => s.addCustom)

  if (!fxSel || !scene) return null

  if (fxSel.kind === 'transition') {
    // 转场存在镜上（fxSel.id = shotId, 即「进入该镜」的衔接转场）。
    const sh = scene.shots?.find((x) => x.id === fxSel.id)
    const cur = sh?.transitionIn
    if (!sh || !cur) return null
    return (
      <div className="ks-fx-inspector">
        <div className="ks-fx-inspector-head">转场 · {getTransitionPreset(cur.presetId)?.label ?? cur.presetId}</div>
        <div className="ks-fx-grid" style={{ marginBottom: 6 }}>
          {FX_TRANSITIONS.map((p) => (
            <PresetCard
              key={p.id}
              glyph="⇄"
              label={p.label}
              active={cur.presetId === p.id}
              onApply={() => updateShot(sceneId, sh.id, { transitionIn: { ...cur, presetId: p.id } })}
            />
          ))}
        </div>
        <label className="ks-fx-row">
          <span>时长</span>
          <input
            type="range" min={150} max={2000} step={50}
            value={cur.durationMs}
            onChange={(e) => updateShot(sceneId, sh.id, { transitionIn: { ...cur, durationMs: Number(e.target.value) } })}
          />
          <span className="ks-mono">{(cur.durationMs / 1000).toFixed(2)}s</span>
        </label>
        <button type="button" className="ks-fx-clear" onClick={() => updateShot(sceneId, sh.id, { transitionIn: undefined })}>
          删除转场
        </button>
      </div>
    )
  }

  if (fxSel.kind === 'filter') {
    const c = scene.filterClips?.find((x) => x.id === fxSel.id)
    if (!c) return null
    return (
      <div className="ks-fx-inspector">
        <div className="ks-fx-inspector-head">滤镜参数</div>
        <label className="ks-fx-row">
          <span>强度</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={c.intensity ?? 1}
            onChange={(e) => updateFilterClip(sceneId, c.id, { intensity: Number(e.target.value) })}
          />
          <span className="ks-mono">{Math.round((c.intensity ?? 1) * 100)}%</span>
        </label>
      </div>
    )
  }

  if (fxSel.kind === 'effect') {
    const c = scene.effectClips?.find((x) => x.id === fxSel.id)
    if (!c) return null
    return (
      <div className="ks-fx-inspector">
        <div className="ks-fx-inspector-head">特效参数</div>
        <label className="ks-fx-row">
          <span>强度</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={c.intensity ?? 1}
            onChange={(e) => updateEffectClip(sceneId, c.id, { intensity: Number(e.target.value) })}
          />
          <span className="ks-mono">{Math.round((c.intensity ?? 1) * 100)}%</span>
        </label>
      </div>
    )
  }

  if (fxSel.kind === 'adjust') {
    const c = scene.adjustClips?.find((x) => x.id === fxSel.id)
    if (!c) return null
    const set = (key: keyof AdjustParams, v: number): void =>
      updateAdjustClip(sceneId, c.id, { params: { ...c.params, [key]: v } })
    return (
      <div className="ks-fx-inspector">
        <div className="ks-fx-inspector-head">画面调节</div>
        {ADJUST_FIELDS.map((f) => (
          <label key={f.key} className="ks-fx-row">
            <span>{f.label}</span>
            <input
              type="range" min={f.min} max={f.max} step={f.max <= 1 ? 0.02 : 1}
              value={c.params[f.key] ?? 0}
              onChange={(e) => set(f.key, Number(e.target.value))}
            />
            <span className="ks-mono">{(c.params[f.key] ?? 0).toFixed(f.max <= 1 ? 2 : 0)}</span>
          </label>
        ))}
        <button
          type="button"
          className="ks-fx-clear"
          onClick={() => {
            const name = window.prompt('给这个预设起个名字', '我的调色')
            if (name) addCustom(name, c.params)
          }}
        >
          ★ 存为我的预设
        </button>
      </div>
    )
  }

  // sticker
  const c = scene.stickerClips?.find((x) => x.id === fxSel.id)
  if (!c) return null
  const upd = (patch: Parameters<typeof updateStickerClip>[2]): void => updateStickerClip(sceneId, c.id, patch)
  return (
    <div className="ks-fx-inspector">
      <div className="ks-fx-inspector-head">贴纸参数</div>
      {(c.kind === 'numeric' || c.kind === 'emoji') && (
        <label className="ks-fx-row ks-fx-row-text">
          <span>文字</span>
          <input
            type="text"
            value={c.text ?? ''}
            onChange={(e) => upd({ text: e.target.value })}
          />
        </label>
      )}
      <label className="ks-fx-row">
        <span>大小</span>
        <input type="range" min={4} max={40} step={1} value={c.sizePct ?? 12} onChange={(e) => upd({ sizePct: Number(e.target.value) })} />
        <span className="ks-mono">{c.sizePct ?? 12}</span>
      </label>
      <label className="ks-fx-row">
        <span>缩放</span>
        <input type="range" min={0.2} max={3} step={0.05} value={c.scale ?? 1} onChange={(e) => upd({ scale: Number(e.target.value) })} />
        <span className="ks-mono">{(c.scale ?? 1).toFixed(2)}</span>
      </label>
      <label className="ks-fx-row">
        <span>旋转</span>
        <input type="range" min={-180} max={180} step={1} value={c.rotation ?? 0} onChange={(e) => upd({ rotation: Number(e.target.value) })} />
        <span className="ks-mono">{c.rotation ?? 0}°</span>
      </label>
      <label className="ks-fx-row">
        <span>透明</span>
        <input type="range" min={0} max={1} step={0.05} value={c.opacity ?? 1} onChange={(e) => upd({ opacity: Number(e.target.value) })} />
        <span className="ks-mono">{Math.round((c.opacity ?? 1) * 100)}%</span>
      </label>
      {(c.kind === 'numeric' || c.kind === 'builtin') && (
        <label className="ks-fx-row ks-fx-row-text">
          <span>颜色</span>
          <input type="color" value={c.color ?? '#ffd24a'} onChange={(e) => upd({ color: e.target.value })} />
        </label>
      )}
      <label className="ks-fx-row ks-fx-row-text">
        <span>入场</span>
        <select
          className="ks-fx-select"
          value={c.enter ?? ''}
          onChange={(e) => upd({ enter: e.target.value || undefined })}
        >
          <option value="">无</option>
          {FX_STICKER_ANIM_IN.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="ks-fx-row ks-fx-row-text">
        <span>出场</span>
        <select
          className="ks-fx-select"
          value={c.exit ?? ''}
          onChange={(e) => upd({ exit: e.target.value || undefined })}
        >
          <option value="">无</option>
          {FX_STICKER_ANIM_OUT.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <p className="ks-fx-hint">提示：在画面预览里直接拖动贴纸可改位置；入/出场动画在播放经过贴纸首尾时显现。</p>
    </div>
  )
}

const css = `
/* 宽度与下方 TimelineDock 列 (.ks-scene-detail-dock-col) 对齐, 右边缘上下成一条线 */
.ks-fxrail {
  flex: 0 0 300px;
  min-width: 260px;
  max-width: 340px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
  overflow: hidden;
}
@media (max-width: 1040px) {
  .ks-fxrail {
    flex-basis: 250px;
    min-width: 220px;
  }
}
.ks-fxrail.is-collapsed {
  flex-basis: 34px;
  min-width: 34px;
  align-items: center;
}
.ks-fxrail-expand {
  all: unset;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  width: 100%;
  color: var(--ks-text-soft);
  writing-mode: vertical-rl;
}
.ks-fxrail-expand:hover { color: var(--ks-amber); }
.ks-fxrail-expand-ico { font-size: 14px; writing-mode: horizontal-tb; }
.ks-fxrail-expand-txt { letter-spacing: 0.2em; font-size: 11px; }

.ks-fxrail-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-fxrail-title {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ks-amber);
}
.ks-fxrail-collapse {
  all: unset;
  cursor: pointer;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text-soft);
  border: 1px solid var(--ks-border-soft);
  font-size: 14px;
}
.ks-fxrail-collapse:hover { color: var(--ks-text); border-color: var(--ks-border-strong); }

.ks-fxrail-tabs {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  padding: 6px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-fxrail-tab {
  all: unset;
  cursor: pointer;
  text-align: center;
  padding: 5px 2px;
  font-size: 11px;
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text-dim);
  border: 1px solid transparent;
}
.ks-fxrail-tab:hover { color: var(--ks-text); background: var(--ks-panel-solid); }
.ks-fxrail-tab.is-active {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
  background: var(--ks-amber-soft);
}

.ks-fxrail-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.ks-fx-hint {
  margin: 0 0 8px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--ks-text-faint);
}
.ks-fx-empty {
  font-size: 11px;
  color: var(--ks-text-faint);
  padding: 6px 0;
}
.ks-fx-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.ks-fx-grid-3 { grid-template-columns: repeat(3, 1fr); }
.ks-fx-card {
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px 8px;
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
  user-select: none;
}
.ks-fx-card:hover {
  border-color: var(--ks-border-strong);
  background: var(--ks-panel-elev);
  transform: translateY(-1px);
}
.ks-fx-card.is-active {
  border-color: var(--ks-amber);
  background: var(--ks-amber-soft);
}
.ks-fx-card-glyph { font-size: 20px; line-height: 1; }
.ks-fx-card-label {
  font-size: 10.5px;
  color: var(--ks-text-soft);
  text-align: center;
}
.ks-fx-card-fav {
  all: unset;
  cursor: pointer;
  position: absolute;
  top: 2px; right: 4px;
  font-size: 11px;
  color: var(--ks-text-faint);
}
.ks-fx-card-fav.is-on { color: var(--ks-amber); }
.ks-fx-card-fav:hover { color: var(--ks-amber); }

.ks-fx-bigbtn {
  all: unset;
  cursor: pointer;
  display: block;
  text-align: center;
  padding: 9px;
  margin-bottom: 8px;
  border-radius: var(--ks-radius-sm);
  background: var(--ks-amber-soft);
  border: 1px solid var(--ks-amber);
  color: var(--ks-amber);
  font-size: 12px;
}
.ks-fx-bigbtn:hover { filter: brightness(1.1); }
.ks-fx-dragchip {
  cursor: grab;
  text-align: center;
  padding: 7px;
  border-radius: var(--ks-radius-sm);
  border: 1px dashed var(--ks-border-strong);
  color: var(--ks-text-dim);
  font-size: 11px;
}

.ks-fx-param, .ks-fx-inspector {
  margin-top: 10px;
  padding: 8px;
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
}
.ks-fx-inspector {
  flex: 0 0 auto;
  margin: 0;
  border-radius: 0;
  border: none;
  border-top: 1px solid var(--ks-border);
  background: var(--ks-panel-solid);
  max-height: 44%;
  overflow-y: auto;
}
.ks-fx-inspector-head {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ks-text-dim);
  margin-bottom: 6px;
}
.ks-fx-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  font-size: 11px;
  color: var(--ks-text-soft);
}
.ks-fx-row > span:first-child { flex: 0 0 42px; }
.ks-fx-row input[type='range'] { flex: 1; accent-color: var(--ks-amber); cursor: pointer; min-width: 0; }
.ks-fx-row > .ks-mono { flex: 0 0 40px; text-align: right; font-size: 10px; color: var(--ks-text-faint); }
.ks-fx-row-text input[type='text'] {
  flex: 1; min-width: 0;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text);
  padding: 3px 6px;
  font-size: 11px;
}
.ks-fx-select {
  flex: 1; min-width: 0;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text);
  padding: 3px 6px;
  font-size: 11px;
  cursor: pointer;
}
.ks-fx-select:focus-visible { border-color: var(--ks-amber); outline: none; }
.ks-fx-clear {
  all: unset;
  cursor: pointer;
  display: block;
  text-align: center;
  margin-top: 6px;
  padding: 6px;
  border-radius: var(--ks-radius-sm);
  border: 1px solid var(--ks-border-soft);
  color: var(--ks-text-soft);
  font-size: 11px;
}
.ks-fx-clear:hover { border-color: var(--ks-amber); color: var(--ks-amber); }
.ks-fx-animsec { margin-bottom: 10px; }
.ks-fx-animsec-title {
  font-size: 11px;
  color: var(--ks-text-soft);
  margin-bottom: 5px;
  font-weight: 600;
}
`
injectStyleOnce('effects-rail', css)
