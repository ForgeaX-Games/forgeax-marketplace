/**
 * TimelineDock · v3.1
 * ─────────────────────────────────────────────────────────────────────────
 * 时间轴右侧「常驻素材面板」—— 模仿剪映素材库：
 *
 *   ┌─ 字幕 ─┐┌─ QTE ─┐┌─ 分支 ─┐┌─ 音频 ─┐
 *   │ 填文本 ││ 选形状││ 选目标 ││ 拖文件 │
 *   │ 拖 →  ││ 拖 → ││ 拖 → ││ 拖 →  │
 *   └───────┘└──────┘└───────┘└───────┘
 *
 * 每个 Tab 里作者先填好"模板信息"，然后把该模板块拖到左侧 Timeline。
 * Drop 侧（Timeline）按 payload.kind 分派 addDialogue / addQTECue /
 * addBranch / addAudioClip，从而生成一条 clip。
 *
 * 设计约束：
 *   - 无副作用：Dock 不直接写 scenarioStore，只 emit DnD payload
 *   - mediaStore 依赖只在音频 Tab 用（ingest 文件 → mediaId → payload）
 *   - 受 props.scenario.scenes 驱动：分支 Tab 列出候选 targetSceneId
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AudioRole,
  Branch,
  BranchKind,
  ConditionClause,
  DialogueLine,
  GameVariable,
  GameVariableKind,
  QTECueShape,
  Scenario,
  VarEffect,
} from '../../scenario/types'
import { useMediaStore, type MediaEntry } from '../../media/mediaStore'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useShellStore } from '../../shell/shellStore'
import { MINIGAMES } from '../../minigames/registry'
import { filterEnabledMinigames } from '../../minigames/filterEnabledMinigames'
import { injectStyleOnce } from '../../styles/injectStyle'
import { SceneBgmPanel } from '../../storytree/SceneBgmPanel'
import { SceneAssetGallery } from '../SceneAssetGallery'
import {
  DOCK_MIME,
  serializeDockPayload,
  type DockDropPayload,
} from './dndTypes'
import { useDialogueSelection } from './dialogueSelection'

interface Props {
  scenario: Scenario
  currentSceneId: string
}

type Tab = 'assets' | 'dialogue' | 'cue' | 'branch' | 'audio' | 'image' | 'video' | 'minigame' | 'vars'

const EMPTY_IDS: string[] = []

export function TimelineDock({ scenario, currentSceneId }: Props) {
  // 默认进「素材库」tab —— 作者反馈: 节点详情里最先要看/用的就是本节点成品素材。
  const [tab, setTab] = useState<Tab>('assets')
  const selectedDialogueId = useDialogueSelection((s) => s.selectedId)
  // 当用户在时间轴上点击一条字幕 clip 时，自动把右侧 Dock 切到「字幕」tab，
  // 让下方详情面板立即可见。其它 kind（audio/cue/branch）暂不联动——它们
  // 没有"详情面板靠 Dock 呈现"的需求，作者切 tab 的成本可接受。
  // 防止把"主动切到其他 tab"的意图覆盖：仅在 selectedDialogueId 由 null → 非空
  // 这一帧切；用户如果切走，selectedId 不变，自然不会反复抢回来。
  const prevSelDiaRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSelDiaRef.current
    prevSelDiaRef.current = selectedDialogueId
    if (selectedDialogueId && selectedDialogueId !== prev) {
      setTab('dialogue')
    }
  }, [selectedDialogueId])
  // 2026-04-30：去掉 Dock 里的"图像 / 视频"两个 tab —— 功能与右侧
  // "资产生成 · 素材库"（SceneAssetGallery）完全重叠，作者反馈多余。
  // 保留 MediaDock 组件定义以便必要时恢复；这里只是把入口摘掉。
  return (
    <aside className="ks-dock" aria-label="时间轴素材面板">
      <div className="ks-dock-tabs" role="tablist">
        <DockTab cur={tab} me="assets" onSel={setTab} icon="🎬" label="素材库" />
        <DockTab cur={tab} me="dialogue" onSel={setTab} icon="💬" label="字幕" />
        <DockTab cur={tab} me="cue" onSel={setTab} icon="⚡" label="QTE" />
        <DockTab cur={tab} me="branch" onSel={setTab} icon="⎇" label="分支" />
        <DockTab cur={tab} me="audio" onSel={setTab} icon="♪" label="音频" />
        <DockTab cur={tab} me="minigame" onSel={setTab} icon="🎮" label="小游戏" />
        <DockTab cur={tab} me="vars" onSel={setTab} icon="#" label="数值" />
      </div>
      <div className="ks-dock-body">
        {tab === 'assets' && <AssetsDock sceneId={currentSceneId} />}
        {tab === 'dialogue' && <DialogueDock />}
        {tab === 'cue' && <CueDock />}
        {tab === 'branch' && (
          <BranchDock scenario={scenario} currentSceneId={currentSceneId} />
        )}
        {tab === 'audio' && <AudioDock currentSceneId={currentSceneId} />}
        {tab === 'minigame' && <MinigameDock />}
        {tab === 'vars' && (
          <VarsDock scenario={scenario} currentSceneId={currentSceneId} />
        )}
      </div>
      <div className="ks-dock-hint ks-mono">
        · 填好信息 · 按住拖到左侧时间轴 ·
      </div>
    </aside>
  )
}

function DockTab({
  cur,
  me,
  onSel,
  icon,
  label,
}: {
  cur: Tab
  me: Tab
  onSel: (t: Tab) => void
  icon: string
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={cur === me}
      aria-label={label}
      title={label}
      className={`ks-dock-tab ${cur === me ? 'is-active' : ''}`}
      onClick={() => onSel(me)}
    >
      <span className="ks-dock-tab-icon" aria-hidden>
        {icon}
      </span>
      <span className="ks-dock-tab-label">{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 素材库（dock 第一页 · 默认）
// ─────────────────────────────────────────────────────────────────────
//
// 2026-06-16 作者反馈：原本在「画面下方时间轴上方」的『素材库成品』条移进
// 这里，作为 dock 第一个、默认选中的 tab —— 顶部醒目「打开素材库」入口
// （→ forgeView='assets' 为本节点智能生成/管理素材）+ 本节点成品图廊
// （SceneAssetGallery，可上传 / 拖文件入库 / 拖进时间轴）。素材库跟随当前节点。
function AssetsDock({ sceneId }: { sceneId: string }) {
  const selectScene = useScenarioStore((s) => s.selectScene)
  const setForgeView = useShellStore((s) => s.setForgeView)
  const sceneImages = useScenarioStore(
    (s) => s.scenario.scenes[sceneId]?.sceneImages ?? EMPTY_IDS,
  )
  return (
    <div className="ks-dock-card ks-assets-dock">
      <button
        type="button"
        className="ks-assets-dock-btn"
        onClick={() => {
          selectScene(sceneId)
          setForgeView('assets')
        }}
        title="打开素材库 · 为本节点智能生成/管理图像与视频素材"
      >
        <span aria-hidden>🎨</span>
        打开素材库
        <span aria-hidden>→</span>
      </button>
      <SceneAssetGallery sceneId={sceneId} kind="image" ids={sceneImages} compact />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 字幕 ── v3.10 重构（2026-05-14）
// ─────────────────────────────────────────────────────────────────────
//
// 旧实现：上方一个"先填好 role/speaker/text/dur 再拖"的表单，拖出去落地。
//        改文字必须双击 clip 打开 inline editor。
//
// 新实现：参考剪映"素材库 + 属性面板"的双层模式。
//   ┌─────────────────────────────────┐
//   │ 拖拽源（顶部固定）                │
//   │   [⋮⋮ 旁白]   [⋮⋮ 对白]          │ ← 直接拖到时间轴落地，role 和 text 由模板决定
//   ├─────────────────────────────────┤
//   │ 详情（中部，跟随时间轴选中变化）    │
//   │   类型：◉ 旁白  ◯ 对白            │
//   │   署名：[Input + datalist]       │ ← 仅对白显示
//   │   台词：[Textarea]               │
//   │                                 │
//   │   未选中时：空态提示              │
//   └─────────────────────────────────┘
//
// 时长：拖入默认 2s（onTrackDrop 用 payload.defaultDurationMs ?? 2000）；
// 改时长靠时间轴上拖左/右 handle，不在这个面板里出现数字字段——避免数字打字让作者迷惑。
//
// 选中→面板：通过 dialogueSelection store。Timeline 单击 clip 写入；
// Dock 这边读取并渲染当前选中 dialogue 的实时数据（直接读 scenarioStore，
// 不复制一份本地 state，所以其他面板改字段，这里也跟着变）。
//
// 拖入→自动选中：Timeline.onTrackDrop 在 addDialogue 后立刻 setToolbarSel，
// dialogueSelection.selectedId 也跟着同步，作者拖完即可在下面改文字。
function DialogueDock() {
  const scene = useScenarioStore((s) => s.scenario.scenes[s.selectedSceneId])
  const selectedId = useDialogueSelection((s) => s.selectedId)

  // 当前选中的那条 dialogue（实时绑定，非本地拷贝）
  const selectedDialogue = scene?.dialogue.find((d) => d.id === selectedId)

  return (
    <div className="ks-dock-card ks-dialogue-dock">
      <div className="ks-dialogue-templates">
        <div className="ks-dialogue-template-label ks-mono">拖入时间轴 · 添加</div>
        <div className="ks-dialogue-template-row">
          <DialogueTemplateChip
            label="旁白"
            payload={{
              kind: 'dialogue',
              role: 'narration',
              text: '旁白',
              defaultDurationMs: 2000,
            }}
          />
          <DialogueTemplateChip
            label="对白"
            payload={{
              kind: 'dialogue',
              role: 'character',
              text: '',
              defaultDurationMs: 2000,
            }}
          />
        </div>
      </div>

      <div className="ks-dialogue-detail-divider" />

      <div className="ks-dialogue-detail">
        <div className="ks-dialogue-template-label ks-mono">详情 · 编辑</div>
        {!selectedDialogue ? (
          <div className="ks-dialogue-empty ks-mono">
            在时间轴上点击一条字幕来编辑
          </div>
        ) : (
          // key 让选中条切换时丢弃旧的本地 buffer state，并在 unmount 时
          // useEffect cleanup 把未提交的本地修改 flush 到 store（见组件内说明）。
          <DialogueDetailEditor key={selectedDialogue.id} line={selectedDialogue} />
        )}
      </div>
    </div>
  )
}

/**
 * DialogueDetailEditor —— 选中字幕条的属性编辑器。
 *
 * 为什么要单独拆出来 + 用本地 buffered state？
 *
 *   原本 textarea/input 的 onChange 直接 updateDialogue（写 scenarioStore）。
 *   scenarioStore 套了 zundo temporal middleware，每次 store 变化 push 一条
 *   undo 历史；中文输入法逐字符触发 onChange → 一段台词产生几十条历史 →
 *   limit:50 的栈瞬间塞满，老的真正的"语义化操作"被挤出去。
 *
 *   修法是「本地缓冲 → blur/Enter 才提交」：
 *     - speaker / text 各持一份 useState，作者打字时只更新本地 state，
 *       浏览器 IME 不触发 store 写
 *     - blur / Enter 时才 updateDialogue，整段编辑只占 1 条 zundo 历史
 *     - Esc 取消，恢复成 store 当前值
 *     - role（旁白/对白 SegBtn）保留即时落地，单击不会刷历史
 *
 *   边界：作者在本地有未提交编辑、然后切换选中条 / 切场景 / 关闭面板，
 *   外层用 `key={selectedDialogue.id}` 让组件 unmount 重建 ——
 *   useEffect cleanup 阶段 flush 一次未提交值，避免编辑丢失（参考 Notion）。
 *
 *   实时预览失了一点：Player/Timeline 的字幕预览只在提交时刷新；这是用户
 *   明确选择的行为（"历史经净 优于 实时预览"）。
 */
function DialogueDetailEditor({
  line,
}: {
  line: DialogueLine
}) {
  const sceneId = useScenarioStore((s) => s.selectedSceneId)
  const updateDialogue = useScenarioStore((s) => s.updateDialogue)
  const charactersMap = useScenarioStore((s) => s.scenario.characters)

  // 候选 speaker 来自"致性锚点"——scenario.characters 表里的 name；
  // 用 datalist 的形式建议，作者也能自由打字（路人甲、群演不需要进角色库）。
  const speakerSuggestions = useMemo<string[]>(() => {
    if (!charactersMap) return []
    return Object.values(charactersMap)
      .map((c) => c.name)
      .filter((n): n is string => !!n && n.trim().length > 0)
  }, [charactersMap])

  // 本地 buffered state —— 只在 blur/Enter 时同步到 store
  const [draftSpeaker, setDraftSpeaker] = useState<string>(line.speaker ?? '')
  const [draftText, setDraftText] = useState<string>(line.text)

  /*
   * store 里的 dialogue 可能被外部源 hydrate 覆盖（如：用户从磁盘加载了新版剧本、
   * 撤销/重做、scenarioPersist 把另一份 db 灌回来）；
   * 此时若本地没有未提交修改，应该跟着同步过来。
   *
   * 判定"无未提交修改" = 本地 draft 等于 store 里现值（line.* 是 props，
   * 上层 useEffect 已经在 line 引用变化时重渲）。本地有改动时不打断作者。
   *
   * 注意 line 引用的更新通过 props 进入，scenarioStore 内置 immer，
   * 同字段值不变时 line 引用也不会变（zustand 本身不会 hot replace），
   * 所以这层 effect 一般只在远端拉取后才跑。
   */
  useEffect(() => {
    setDraftSpeaker((cur) => (cur === (line.speaker ?? '') ? cur : line.speaker ?? ''))
    setDraftText((cur) => (cur === line.text ? cur : line.text))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.speaker, line.text])

  // 提交 helpers —— 比对 store 现值，没变就什么都不做（避免无意义的 zundo 历史）
  const flushSpeaker = useCallback(
    (next: string): void => {
      const norm = next.trim() ? next : ''
      const currentNorm = line.speaker ?? ''
      if (norm === currentNorm) return
      updateDialogue(sceneId, line.id, {
        speaker: norm || undefined,
      })
    },
    [updateDialogue, sceneId, line.id, line.speaker],
  )
  const flushText = useCallback(
    (next: string): void => {
      if (next === line.text) return
      updateDialogue(sceneId, line.id, { text: next })
    },
    [updateDialogue, sceneId, line.id, line.text],
  )

  /*
   * 组件 unmount 时（切换选中条 / 切场景 / 切 tab）flush 未提交的修改。
   *
   * 为什么用 ref：useEffect cleanup 闭包捕获的是 mount 时的 draftSpeaker/draftText，
   * 拿不到最新值。用 ref 持续跟踪最新 draft，cleanup 时读 ref.current 才正确。
   */
  const draftRef = useRef({ speaker: draftSpeaker, text: draftText })
  draftRef.current = { speaker: draftSpeaker, text: draftText }
  useEffect(() => {
    return () => {
      flushSpeaker(draftRef.current.speaker)
      flushText(draftRef.current.text)
    }
    // 只在 mount 时建立 cleanup，flush helpers 通过闭包+ref 拿最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <label className="ks-dock-field">
        <span>类型</span>
        <div className="ks-dock-seg">
          <SegBtn
            cur={line.role}
            me="narration"
            onSel={(v) => updateDialogue(sceneId, line.id, { role: v })}
            label="旁白"
          />
          <SegBtn
            cur={line.role}
            me="character"
            onSel={(v) => updateDialogue(sceneId, line.id, { role: v })}
            label="对白"
          />
        </div>
      </label>
      {line.role === 'character' && (
        <label className="ks-dock-field">
          <span>署名</span>
          <input
            type="text"
            list="ks-dialogue-speaker-list"
            value={draftSpeaker}
            onChange={(e) => setDraftSpeaker(e.target.value)}
            onBlur={() => flushSpeaker(draftSpeaker)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushSpeaker(draftSpeaker)
                ;(e.target as HTMLInputElement).blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraftSpeaker(line.speaker ?? '')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            placeholder="如：林夕"
            title="按 Enter 或离开输入框时提交修改 · Esc 撤销"
          />
          <datalist id="ks-dialogue-speaker-list">
            {speakerSuggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
      )}
      <label className="ks-dock-field ks-field-text">
        <span>台词</span>
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => flushText(draftText)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter 提交；普通 Enter 在 textarea 里语义是换行，要保留
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              flushText(draftText)
              ;(e.target as HTMLTextAreaElement).blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraftText(line.text)
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
          rows={3}
          placeholder="输入这句台词…"
          title="离开输入框 / Ctrl+Enter 提交修改 · Esc 撤销"
        />
      </label>
    </>
  )
}

/**
 * DialogueTemplateChip —— 「旁白 / 对白」模板拖拽块。
 *
 * 不带"先填后拖"的中间表单，落地后由作者在下方详情面板改 speaker / text。
 * 类型不会绕弯路：旁白模板 = role:narration、对白模板 = role:character。
 */
function DialogueTemplateChip({
  label,
  payload,
}: {
  label: string
  payload: DockDropPayload
}) {
  return (
    <div
      className="ks-dock-chip ks-dialogue-template-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title="按住拖到左侧时间轴 · 默认 2 秒，落地后在下方修改文字"
    >
      <span className="ks-dock-chip-grip" aria-hidden>⋮⋮</span>
      <span className="ks-dock-chip-label">{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// QTE
// ─────────────────────────────────────────────────────────────────────
function CueDock() {
  const [shape, setShape] = useState<QTECueShape>('tap')
  const [label, setLabel] = useState('')
  const [holdSec, setHoldSec] = useState(0.6)
  const [sweepDir, setSweepDir] = useState<'up' | 'down' | 'left' | 'right'>('right')

  const payload: DockDropPayload = {
    kind: 'cue',
    shape,
    label: label.trim() || undefined,
    holdDurationMs: shape === 'hold' ? Math.round(holdSec * 1000) : undefined,
    sweepDir: shape === 'sweep' ? sweepDir : undefined,
  }

  return (
    <div className="ks-dock-card">
      <label className="ks-dock-field">
        <span>QTE 类型</span>
        <div className="ks-dock-seg">
          <SegBtn cur={shape} me="tap" onSel={setShape} label="Tap" />
          <SegBtn cur={shape} me="hold" onSel={setShape} label="Hold" />
          <SegBtn cur={shape} me="sweep" onSel={setShape} label="Sweep" />
        </div>
      </label>
      <label className="ks-dock-field">
        <span>标签（可选）</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如：格挡"
        />
      </label>
      {shape === 'hold' && (
        <label className="ks-dock-field">
          <span>Hold {holdSec.toFixed(1)}s</span>
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={holdSec}
            onChange={(e) => setHoldSec(Number(e.target.value))}
          />
        </label>
      )}
      {shape === 'sweep' && (
        <label className="ks-dock-field">
          <span>Sweep 方向</span>
          <select
            value={sweepDir}
            onChange={(e) => setSweepDir(e.target.value as typeof sweepDir)}
          >
            <option value="right">→ 右</option>
            <option value="left">← 左</option>
            <option value="up">↑ 上</option>
            <option value="down">↓ 下</option>
          </select>
        </label>
      )}
      <DragChip
        enabled
        payload={payload}
        label={`QTE · ${shape.toUpperCase()}${label ? ' · ' + label : ''}`}
      />
    </div>
  )
}

function SegBtn<T extends string>({
  cur,
  me,
  onSel,
  label,
}: {
  cur: T
  me: T
  onSel: (v: T) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`ks-dock-seg-btn ${cur === me ? 'is-active' : ''}`}
      onClick={() => onSel(me)}
    >
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 分支
// ─────────────────────────────────────────────────────────────────────
function BranchDock({
  scenario,
  currentSceneId,
}: {
  scenario: Scenario
  currentSceneId: string
}) {
  const options = useMemo(() => {
    return Object.values(scenario.scenes)
      .filter((s) => s.id !== currentSceneId)
      .map((s) => ({ id: s.id, title: s.title ?? s.id }))
  }, [scenario.scenes, currentSceneId])

  const [targetId, setTargetId] = useState<string>(options[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [branchKind, setBranchKind] = useState<BranchKind>('choice')

  const canDrag = !!targetId
  const payload: DockDropPayload = {
    kind: 'branch',
    targetSceneId: targetId,
    label: label.trim() || undefined,
    branchKind,
  }

  return (
    <div className="ks-dock-card">
      <label className="ks-dock-field">
        <span>连线类型</span>
        <select
          value={branchKind}
          onChange={(e) => setBranchKind(e.target.value as BranchKind)}
        >
          <option value="choice">玩家选择</option>
          <option value="auto">自动续播</option>
          <option value="qte_pass">QTE 通过</option>
          <option value="qte_fail">QTE 失败</option>
        </select>
      </label>
      <label className="ks-dock-field">
        <span>目标场景</span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          disabled={options.length === 0}
        >
          {options.length === 0 ? (
            <option value="">—— 当前剧本还没有其它 scene ——</option>
          ) : (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))
          )}
        </select>
      </label>
      <label className="ks-dock-field">
        <span>按钮文字</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={branchKind === 'choice' ? '如：追上去' : '可选'}
        />
      </label>
      <DragChip
        enabled={canDrag}
        payload={payload}
        label={
          canDrag
            ? `↗ ${label || targetId.slice(0, 10)}`
            : '先添加至少两个场景'
        }
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 数值 / 变量系统（v6）
// ─────────────────────────────────────────────────────────────────────
//
// 一个 tab 把整套「数值/条件」作者工作流收在一起：
//   1. 变量定义（全局）：好感度 / flag / 积分，name + kind + 初始值
//   2. 本节点进入时的数值变化（Scene.onEnterEffects）：经过此节点就累积
//   3. 本节点各分支的「解锁条件」「选择效果」「条件不满足表现」
//
function VarsDock({
  scenario,
  currentSceneId,
}: {
  scenario: Scenario
  currentSceneId: string
}) {
  const upsertVariable = useScenarioStore((s) => s.upsertVariable)
  const removeVariable = useScenarioStore((s) => s.removeVariable)
  const updateScene = useScenarioStore((s) => s.updateScene)
  const updateBranch = useScenarioStore((s) => s.updateBranch)

  const variables = useMemo(
    () => Object.values(scenario.variables ?? {}),
    [scenario.variables],
  )
  const scene = scenario.scenes[currentSceneId]
  const branches = scene?.branches ?? []

  function addVariable(): void {
    const n = variables.length + 1
    const id = `var_${Date.now().toString(36)}`
    upsertVariable({ id, name: `数值${n}`, kind: 'number', initial: 0 })
  }

  return (
    <div className="ks-dock-card">
      {/* ── 1. 变量定义 ───────────────────────────────── */}
      <div className="ks-dock-tab-label ks-mono">变量定义（全局）</div>
      {variables.length === 0 ? (
        <div className="ks-dock-empty ks-mono">
          还没有变量 · 例如「好感度」「是否救过她」
        </div>
      ) : (
        variables.map((v) => (
          <VarDefRow
            key={v.id}
            variable={v}
            onChange={(patch) => upsertVariable({ ...v, ...patch })}
            onRemove={() => removeVariable(v.id)}
          />
        ))
      )}
      <button type="button" className="ks-dock-addbtn" onClick={addVariable}>
        ＋ 新增变量
      </button>

      {scene && (
        <>
          <div className="ks-dialogue-detail-divider" />
          {/* ── 2. 本节点进入效果 ───────────────────────── */}
          <div className="ks-dock-tab-label ks-mono">
            进入本节点时（经过即累积）
          </div>
          <EffectListEditor
            variables={variables}
            effects={scene.onEnterEffects ?? []}
            onChange={(effects) =>
              updateScene(currentSceneId, {
                onEnterEffects: effects.length ? effects : undefined,
              })
            }
          />

          <div className="ks-dialogue-detail-divider" />
          {/* ── 3. 本节点分支条件 / 效果 ─────────────────── */}
          <div className="ks-dock-tab-label ks-mono">本节点分支 · 条件 / 效果</div>
          {branches.length === 0 ? (
            <div className="ks-dock-empty ks-mono">本节点还没有分支</div>
          ) : (
            branches.map((b) => (
              <BranchGateEditor
                key={b.id}
                branch={b}
                scenario={scenario}
                variables={variables}
                onPatch={(patch) => updateBranch(currentSceneId, b.id, patch)}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}

function VarDefRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: GameVariable
  onChange: (patch: Partial<GameVariable>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-var-row">
      <input
        className="ks-var-name"
        value={variable.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="变量名"
      />
      <select
        className="ks-var-kind"
        value={variable.kind}
        onChange={(e) => {
          const kind = e.target.value as GameVariableKind
          onChange({ kind, initial: kind === 'flag' ? 0 : variable.initial })
        }}
      >
        <option value="number">数值</option>
        <option value="flag">旗标</option>
      </select>
      {variable.kind === 'flag' ? (
        <select
          className="ks-var-init"
          value={variable.initial ? '1' : '0'}
          onChange={(e) => onChange({ initial: e.target.value === '1' ? 1 : 0 })}
        >
          <option value="0">初始否</option>
          <option value="1">初始是</option>
        </select>
      ) : (
        <input
          className="ks-var-init"
          type="number"
          value={variable.initial}
          onChange={(e) => onChange({ initial: Number(e.target.value) || 0 })}
          title="初始值"
        />
      )}
      <button
        type="button"
        className="ks-var-del"
        onClick={onRemove}
        title="删除变量"
      >
        ✕
      </button>
    </div>
  )
}

/** 一组数值副作用编辑器（用于 scene.onEnterEffects 和 branch.effects） */
function EffectListEditor({
  variables,
  effects,
  onChange,
}: {
  variables: GameVariable[]
  effects: VarEffect[]
  onChange: (effects: VarEffect[]) => void
}) {
  const firstVarId = variables[0]?.id ?? ''
  if (variables.length === 0) {
    return (
      <div className="ks-dock-empty ks-mono">先在上方定义变量，才能设置效果</div>
    )
  }
  return (
    <>
      {effects.map((eff, i) => (
        <div className="ks-var-row" key={i}>
          <select
            className="ks-var-name"
            value={eff.varId}
            onChange={(e) =>
              onChange(
                effects.map((x, j) =>
                  j === i ? { ...x, varId: e.target.value } : x,
                ),
              )
            }
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            className="ks-var-kind"
            value={eff.op}
            onChange={(e) =>
              onChange(
                effects.map((x, j) =>
                  j === i ? { ...x, op: e.target.value as 'add' | 'set' } : x,
                ),
              )
            }
          >
            <option value="add">增加</option>
            <option value="set">设为</option>
          </select>
          <input
            className="ks-var-init"
            type="number"
            value={eff.value}
            onChange={(e) =>
              onChange(
                effects.map((x, j) =>
                  j === i ? { ...x, value: Number(e.target.value) || 0 } : x,
                ),
              )
            }
          />
          <button
            type="button"
            className="ks-var-del"
            onClick={() => onChange(effects.filter((_, j) => j !== i))}
            title="删除效果"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ks-dock-addbtn"
        onClick={() =>
          onChange([...effects, { varId: firstVarId, op: 'add', value: 1 }])
        }
      >
        ＋ 新增效果
      </button>
    </>
  )
}

/** 单条分支的「解锁条件 + 不满足表现 + 选择效果」编辑器 */
function BranchGateEditor({
  branch,
  scenario,
  variables,
  onPatch,
}: {
  branch: Branch
  scenario: Scenario
  variables: GameVariable[]
  onPatch: (patch: Partial<Branch>) => void
}) {
  const clauses = branch.condition?.all ?? []
  const sceneOptions = useMemo(
    () => Object.values(scenario.scenes).map((s) => ({ id: s.id, title: s.title ?? s.id })),
    [scenario.scenes],
  )

  function setClauses(next: ConditionClause[]): void {
    onPatch({ condition: next.length ? { all: next } : undefined })
  }

  return (
    <div className="ks-gate">
      <div className="ks-gate-head ks-mono">
        {branch.kind === 'choice' ? '选项' : branch.kind} ·{' '}
        {branch.label || branch.targetSceneId}
      </div>

      {/* 分支类型 + 文字（可随时改） */}
      <div className="ks-gate-typerow">
        <select
          className="ks-var-kind"
          value={branch.kind}
          onChange={(e) => onPatch({ kind: e.target.value as BranchKind })}
          title="分支连线类型"
        >
          <option value="choice">玩家选择</option>
          <option value="auto">自动续播</option>
          <option value="qte_pass">QTE 通过</option>
          <option value="qte_fail">QTE 失败</option>
        </select>
        <input
          className="ks-gate-labelinput"
          value={branch.label ?? ''}
          onChange={(e) => onPatch({ label: e.target.value || undefined })}
          placeholder={branch.kind === 'choice' ? '按钮文字' : '标签(可选)'}
        />
      </div>

      {/* 解锁条件 */}
      {clauses.map((c, i) => (
        <ConditionRow
          key={i}
          clause={c}
          variables={variables}
          sceneOptions={sceneOptions}
          onChange={(nc) => setClauses(clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => setClauses(clauses.filter((_, j) => j !== i))}
        />
      ))}
      <div className="ks-gate-actions">
        <button
          type="button"
          className="ks-dock-addbtn ks-gate-addcond"
          onClick={() =>
            setClauses([
              ...clauses,
              variables[0]
                ? { type: 'var', varId: variables[0].id, op: 'gte', value: 1 }
                : { type: 'visited', sceneId: sceneOptions[0]?.id ?? '' },
            ])
          }
        >
          ＋ 解锁条件
        </button>
        {clauses.length > 0 && (
          <label className="ks-gate-mode">
            不满足时
            <select
              value={branch.gateMode ?? 'hide'}
              onChange={(e) =>
                onPatch({ gateMode: e.target.value as 'hide' | 'lock' })
              }
            >
              <option value="hide">隐藏</option>
              <option value="lock">锁定显示</option>
            </select>
          </label>
        )}
      </div>

      {/* 选择效果 */}
      <div className="ks-gate-sub ks-mono">选中后</div>
      <EffectListEditor
        variables={variables}
        effects={branch.effects ?? []}
        onChange={(effects) =>
          onPatch({ effects: effects.length ? effects : undefined })
        }
      />
    </div>
  )
}

function ConditionRow({
  clause,
  variables,
  sceneOptions,
  onChange,
  onRemove,
}: {
  clause: ConditionClause
  variables: GameVariable[]
  sceneOptions: { id: string; title: string }[]
  onChange: (c: ConditionClause) => void
  onRemove: () => void
}) {
  const firstVarId = variables[0]?.id ?? ''
  return (
    <div className="ks-var-row">
      <select
        className="ks-var-kind"
        value={clause.type}
        onChange={(e) => {
          const type = e.target.value as ConditionClause['type']
          if (type === 'var')
            onChange({ type: 'var', varId: firstVarId, op: 'gte', value: 1 })
          else if (type === 'flag')
            onChange({ type: 'flag', varId: firstVarId, equals: true })
          else onChange({ type: 'visited', sceneId: sceneOptions[0]?.id ?? '' })
        }}
      >
        <option value="var">数值</option>
        <option value="flag">旗标</option>
        <option value="visited">经历过</option>
      </select>

      {clause.type === 'var' && (
        <>
          <select
            className="ks-var-name"
            value={clause.varId}
            onChange={(e) => onChange({ ...clause, varId: e.target.value })}
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            className="ks-var-op"
            value={clause.op}
            onChange={(e) =>
              onChange({ ...clause, op: e.target.value as typeof clause.op })
            }
          >
            <option value="gte">≥</option>
            <option value="gt">&gt;</option>
            <option value="lte">≤</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="neq">≠</option>
          </select>
          <input
            className="ks-var-init"
            type="number"
            value={clause.value}
            onChange={(e) =>
              onChange({ ...clause, value: Number(e.target.value) || 0 })
            }
          />
        </>
      )}

      {clause.type === 'flag' && (
        <>
          <select
            className="ks-var-name"
            value={clause.varId}
            onChange={(e) => onChange({ ...clause, varId: e.target.value })}
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            className="ks-var-init"
            value={clause.equals ? '1' : '0'}
            onChange={(e) =>
              onChange({ ...clause, equals: e.target.value === '1' })
            }
          >
            <option value="1">为是</option>
            <option value="0">为否</option>
          </select>
        </>
      )}

      {clause.type === 'visited' && (
        <select
          className="ks-var-name ks-gate-scenesel"
          value={clause.sceneId}
          onChange={(e) => onChange({ ...clause, sceneId: e.target.value })}
        >
          {sceneOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        className="ks-var-del"
        onClick={onRemove}
        title="删除条件"
      >
        ✕
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 音频
// ─────────────────────────────────────────────────────────────────────
function AudioDock({ currentSceneId }: { currentSceneId: string }) {
  const [role, setRole] = useState<AudioRole>('bgm')
  const [label, setLabel] = useState('')
  const [mediaId, setMediaId] = useState<string | null>(null)
  const [durMs, setDurMs] = useState(0)
  const ingest = useMediaStore((s) => s.ingest)
  const entries = useMediaStore((s) => s.entries)

  async function onPickFile(file: File): Promise<void> {
    const id = ingest(file)
    if (!id) return
    setMediaId(id)
    const probed = await probeAudioDuration(file)
    setDurMs(probed)
    if (!label) setLabel(file.name.replace(/\.[^.]+$/, ''))
  }

  const entry = mediaId ? entries[mediaId] : undefined
  const canDrag = !!mediaId && durMs > 0

  const payload: DockDropPayload | null = canDrag
    ? {
        kind: 'audio',
        mediaId: mediaId!,
        role,
        label: label.trim() || undefined,
        durationMs: durMs,
      }
    : null

  return (
    <div className="ks-dock-card">
      {/* 场景 BGM (AI 配 / 自己写) —— 从节点详情迁入, 锚定到当前 scene。
          与下方「拖一条音频 clip 到时间轴」是两件事: 这里是整场戏的背景音乐。 */}
      {currentSceneId ? (
        <div className="ks-dock-bgm-slot">
          <div className="ks-dialogue-template-label ks-mono">本场景 BGM</div>
          <SceneBgmPanel sceneId={currentSceneId} />
        </div>
      ) : null}
      <div className="ks-dialogue-detail-divider" />
      <div className="ks-dialogue-template-label ks-mono">拖一条音频到时间轴</div>
      <label className="ks-dock-field">
        <span>音频类型</span>
        <div className="ks-dock-seg">
          <SegBtn cur={role} me="bgm" onSel={setRole} label="BGM" />
          <SegBtn cur={role} me="sfx" onSel={setRole} label="SFX" />
          <SegBtn cur={role} me="vo" onSel={setRole} label="VO" />
        </div>
      </label>
      <label className="ks-dock-field">
        <span>文件</span>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onPickFile(f)
          }}
        />
      </label>
      {entry && (
        <div className="ks-dock-audio-meta ks-mono">
          {entry.name} · {(durMs / 1000).toFixed(2)}s
        </div>
      )}
      <label className="ks-dock-field">
        <span>标签</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如：紧张的鼓点"
        />
      </label>
      {payload ? (
        <DragChip enabled payload={payload} label={`${role.toUpperCase()} · ${label}`} />
      ) : (
        <DragChip
          enabled={false}
          payload={null}
          label={mediaId ? '解析时长中…' : '先选一个音频文件'}
        />
      )}
    </div>
  )
}

/** 通过 <audio> 元素测量时长（ms）—— 失败回退 4s */
function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    el.preload = 'metadata'
    el.src = url
    const cleanup = () => {
      URL.revokeObjectURL(url)
      el.onloadedmetadata = null
      el.onerror = null
    }
    el.onloadedmetadata = () => {
      const ms = Math.round((el.duration || 4) * 1000)
      cleanup()
      resolve(ms > 0 ? ms : 4000)
    }
    el.onerror = () => {
      cleanup()
      resolve(4000)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// 小游戏（拖入 shots 下方独立轨道）
// ─────────────────────────────────────────────────────────────────────
//
// 从 minigames/registry.ts 取可用小游戏，作者选一个 → DragChip 变可拖。
// 拖落到 Timeline 时由 onTrackDrop 分派，调用 addMinigameClip 建一条 clip。
function MinigameDock() {
  const enabledIds = useScenarioStore((s) => s.scenario.enabledMinigameIds)
  const available = useMemo(
    () => filterEnabledMinigames(MINIGAMES, enabledIds),
    [enabledIds],
  )
  const [selectedId, setSelectedId] = useState<string>(available[0]?.id ?? '')
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (available.length && !available.some((m) => m.id === selectedId)) {
      setSelectedId(available[0]!.id)
    }
  }, [available, selectedId])

  const selected = available.find((m) => m.id === selectedId) ?? null

  const payload: DockDropPayload | null = selected
    ? {
        kind: 'minigame',
        minigameId: selected.id,
        label: label.trim() || undefined,
        defaultDurationMs: selected.defaultDurationMs,
      }
    : null

  return (
    <div className="ks-dock-card">
      <label className="ks-dock-field">
        <span>选择小游戏</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={available.length === 0}
        >
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
              {m.tag ? ` · ${m.tag}` : ''}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <div className="ks-dock-mg-blurb" title={selected.blurb}>
          {selected.blurb}
        </div>
      )}
      <label className="ks-dock-field">
        <span>标签（可选）</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如：练习关"
        />
      </label>
      <DragChip
        enabled={!!selected}
        payload={payload}
        label={`小游戏 · ${selected ? selected.title : '无可用'}`}
      />
    </div>
  )
}


//
// 设计：从 scene.sceneImages / scene.sceneVideos 读已入库的 mediaId 列表，
// 每条显示缩略图 + 文件名 + 拖拽手柄。支持"上传新文件"按钮（和
// SceneAssetGallery 共享 mediaStore.ingest + addSceneImage/Video actions，
// 所以两处上传会互相同步）。
//
// 为什么不 import SceneAssetGallery：
//   · Gallery 带完整的排序/移除/失效提示 UI，塞进窄窄的 Dock 会溢出
//   · Dock 定位是"最小操作面"——看一眼 + 拖走
//
// 已知限制（MVP）：
//   · 这里不做排序/删除；要管理资产还是去右侧"资产"面板
//   · 拖入时间轴后，image 新建 shot，video 覆盖 scene.media —— 与
//     Timeline.onTrackDrop 的 image/video case 一致
function MediaDock({
  kind,
  scenario,
  currentSceneId,
}: {
  kind: 'image' | 'video'
  scenario: Scenario
  currentSceneId: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const ingestAsync = useMediaStore((s) => s.ingestAsync)
  const entries = useMediaStore((s) => s.entries)
  const addSceneImage = useScenarioStore((s) => s.addSceneImage)
  const addSceneVideo = useScenarioStore((s) => s.addSceneVideo)
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  /*
   * 视频 duration 缓存 —— 拖拽时要把 durationMs 带进 DockDropPayload，
   * 让 Timeline.onTrackDrop 新建 shot 时拿到"真实时长"而不是硬编码 4s。
   * Map 的 key = mediaId；首次 hover 某条视频时异步 probe 一次，后续命中缓存。
   * 用 ref 而不是 state：duration 改变不需要重渲染；读写频次低，裸 Map 够用。
   */
  const durationCacheRef = useRef<Map<string, number>>(new Map())

  const scene = scenario.scenes[currentSceneId]
  const ids: string[] = scene
    ? kind === 'image'
      ? scene.sceneImages ?? []
      : scene.sceneVideos ?? []
    : []
  const accept = kind === 'image' ? 'image/*' : 'video/*'

  /**
   * 上传流程 v2（2026-04-30 反馈："上传视频刷新就丢了"）：
   *
   *   1. 先同步 ingestAsync → 拿到 mediaId + done Promise
   *   2. 立刻把 mediaId 写进 scene.sceneImages / sceneVideos，UI 立即显示条目
   *      （pending 状态下 entry.url 是 blob URL，仍可预览/拖拽）
   *   3. await done —— 直到 asset 真正落盘成功/失败
   *      - 成功：mediaStore 内部把 entry.url 切到 /__reel__/assets/<assetId>，
   *        刷新后可经 hydrateMediaFromAssets 重新出现
   *      - 失败：标 persistState='failed'，UI 会显示 ⚠；busy 结束，用户可重试
   *
   * 为什么不"等 done 再写 scenario"：
   *   - 大视频上传可能几十秒，作者这段时间会误以为"啥也没发生"
   *   - 立刻写 scenario，UI 即时反馈；万一真失败，用户能看见失败的条目并重试
   *
   * 阻止误刷新：见 App.tsx beforeunload，当 atRiskIds（pending + failed）
   * 非空会弹原生确认框 —— pending 是"还在跑"，failed 是"后端拒了还没重试"。
   */
  async function onPickFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setBusy(true)
    setLastError(null)
    try {
      const pending: Array<Promise<void>> = []
      for (const f of Array.from(files)) {
        if (kind === 'image' && !f.type.startsWith('image/')) continue
        if (kind === 'video' && !f.type.startsWith('video/')) continue
        const { id, done } = ingestAsync(f)
        if (!id) continue
        if (kind === 'image') addSceneImage(currentSceneId, id)
        else addSceneVideo(currentSceneId, id)
        // 单个文件失败不应阻断别的文件上传；统一收集再看最终是否有失败
        pending.push(done.catch((e: unknown) => { throw e }))
      }
      const results = await Promise.allSettled(pending)
      const fails = results.filter((r) => r.status === 'rejected').length
      if (fails > 0) {
        setLastError(`${fails} 个文件保存失败，刷新后会丢失，请重试`)
      }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="ks-dock-card">
      <div className="ks-dock-field">
        <span>
          {kind === 'image' ? '上传图片' : '上传视频'}
          {busy ? <span className="ks-dock-field-busy ks-mono"> · 保存中…</span> : null}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          disabled={busy}
          onChange={(e) => void onPickFiles(e.target.files)}
        />
      </div>
      {lastError ? (
        <div className="ks-dock-media-miss ks-mono" role="status">
          ⚠ {lastError}
        </div>
      ) : null}
      {ids.length === 0 ? (
        <div className="ks-dock-empty ks-mono">
          {kind === 'image'
            ? '本场景暂无图像 · 上传或在资产面板里生成'
            : '本场景暂无视频 · 上传或在资产面板里生成'}
        </div>
      ) : (
        <ul className="ks-dock-media-list">
          {ids.map((id) => {
            const entry = entries[id]
            if (!entry) {
              return (
                <li key={id} className="ks-dock-media-item is-missing">
                  <div className="ks-dock-media-miss ks-mono">⚠ 资源丢失</div>
                  <div className="ks-dock-media-label ks-mono" title={id}>
                    {id.slice(0, 10)}…
                  </div>
                </li>
              )
            }
            const payload: DockDropPayload =
              kind === 'image'
                ? { kind: 'image', mediaId: id, label: entry.name }
                : {
                    kind: 'video',
                    mediaId: id,
                    label: entry.name,
                    // 拖起瞬间取缓存值（可能 0=未知）；onDragStart 会再尝试用最新缓存刷新
                    durationMs: durationCacheRef.current.get(id) ?? 0,
                  }
            const persist = entry.persistState ?? 'saved'
            const liCls = [
              'ks-dock-media-item',
              persist === 'pending' ? 'is-pending' : '',
              persist === 'failed' ? 'is-failed' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <li
                key={id}
                className={liCls}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  /*
                   * 重要：video 的 durationMs 在 render 期取缓存可能还没 loadedmetadata。
                   * 拖起瞬间再读一次最新缓存（durationCacheRef 是可变 ref），
                   * 避免「刚加载完立刻拖」命中 payload.durationMs=0 → Timeline 走 4 秒兜底。
                   * Timeline.onTrackDrop 另有异步 probe 兜底，本步只是乐观优化。
                   */
                  const freshPayload: DockDropPayload =
                    kind === 'image'
                      ? { kind: 'image', mediaId: id, label: entry.name }
                      : {
                          kind: 'video',
                          mediaId: id,
                          label: entry.name,
                          durationMs: durationCacheRef.current.get(id) ?? 0,
                        }
                  e.dataTransfer.setData(
                    DOCK_MIME,
                    serializeDockPayload(freshPayload),
                  )
                }}
                title={`${entry.name} · 拖到左侧时间轴${kind === 'image' ? '新建分镜' : '新建视频镜头'}${
                  persist === 'pending'
                    ? '\n\n⚠ 正在保存到磁盘，刷新前请勿关页'
                    : persist === 'failed'
                      ? '\n\n⚠ 保存失败，刷新会丢。请重新上传'
                      : ''
                }`}
              >
                {kind === 'image' ? (
                  <img
                    className="ks-dock-media-thumb"
                    src={entry.url}
                    alt={entry.name}
                    draggable={false}
                  />
                ) : (
                  <video
                    className="ks-dock-media-thumb"
                    src={entry.url}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      // 顺手写入 duration 缓存，下次拖拽时 payload 就能带上真实时长
                      const el = e.currentTarget
                      const ms = Math.round((el.duration || 0) * 1000)
                      if (ms > 0) durationCacheRef.current.set(id, ms)
                    }}
                  />
                )}
                {persist === 'pending' && (
                  <UploadProgress
                    entry={entry}
                    onAbort={
                      entry.abort
                        ? (e: React.MouseEvent) => {
                            e.stopPropagation()
                            entry.abort?.()
                          }
                        : undefined
                    }
                  />
                )}
                {persist === 'failed' && (
                  <span
                    className="ks-dock-media-badge is-failed ks-mono"
                    aria-label="保存失败"
                  >
                    未落盘
                  </span>
                )}
                <div className="ks-dock-media-label" title={entry.name}>
                  {entry.name}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 上传进度浮层 —— 用在 ks-dock-media-item 顶部覆盖
//
// 渲染条件：entry.persistState === 'pending'。
//   · 第一行：进度条（loaded/total 百分比）
//   · 第二行：速度（MB/s）+ 预估剩余时间 + 取消按钮
// total=0 时（浏览器还没拿到 Content-Length）退化成"已传 X MB · ~Y MB/s"
// ─────────────────────────────────────────────────────────────────────
function UploadProgress({
  entry,
  onAbort,
}: {
  entry: MediaEntry
  onAbort?: (e: React.MouseEvent) => void
}): JSX.Element {
  const p = entry.progress
  const total = p?.total || entry.size || 0
  const loaded = p?.loaded ?? 0
  const speed = p?.speed ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0
  const speedMb = (speed / 1024 / 1024).toFixed(1)
  const remainSec =
    total > 0 && speed > 0 ? Math.ceil((total - loaded) / speed) : 0
  const remainText =
    remainSec > 60
      ? `约 ${Math.ceil(remainSec / 60)} 分`
      : remainSec > 0
        ? `约 ${remainSec} 秒`
        : ''
  return (
    <div className="ks-dock-upload-overlay" aria-label="上传进度">
      <div className="ks-dock-upload-bar">
        <div
          className="ks-dock-upload-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="ks-dock-upload-meta ks-mono">
        <span>
          {pct}% · {speedMb} MB/s
          {remainText ? ` · ${remainText}` : ''}
        </span>
        {onAbort && (
          <button
            type="button"
            className="ks-dock-upload-cancel"
            onClick={onAbort}
            title="取消上传（已传部分会丢弃）"
            aria-label="取消上传"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 拖拽 chip
// ─────────────────────────────────────────────────────────────────────
function DragChip({
  enabled,
  payload,
  label,
}: {
  enabled: boolean
  payload: DockDropPayload | null
  label: string
}) {
  function onDragStart(e: React.DragEvent): void {
    if (!enabled || !payload) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div
      className={`ks-dock-chip ${enabled ? '' : 'is-disabled'}`}
      draggable={enabled}
      onDragStart={onDragStart}
      title={enabled ? '按住拖到左侧时间轴' : ''}
    >
      <span className="ks-dock-chip-grip" aria-hidden>⋮⋮</span>
      <span className="ks-dock-chip-label">{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 样式
// ─────────────────────────────────────────────────────────────────────
const dockCss = `
.ks-dock {
  display: flex; flex-direction: column;
  min-width: 140px;
  max-width: 210px;
  height: 100%;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-inset-hi);
  overflow: hidden;
}
.ks-dock-tabs {
  display: grid;
  /* 7 个 tab（素材库 / 字幕 / QTE / 分支 / 音频 / 小游戏 / 数值）图标化平铺。
   * 只显示图标, 文字转 title 悬停提示, 因此列再多也放得下。 */
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-surface-warm);
}
.ks-dock-tab {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ks-text-dim);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  padding: 6px 1px;
  border-radius: var(--ks-radius-sm);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--ks-dur-fast) var(--ks-ease), color var(--ks-dur-fast) var(--ks-ease);
  font-family: var(--ks-font-cn);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ks-dock-tab-icon {
  font-size: 15px;
  line-height: 1;
}
/* 文字标签仅供无障碍(aria-label)与 title; 视觉上隐藏, 只展示图标 */
.ks-dock-tab-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.ks-dock-tab:hover { color: var(--ks-text); background: rgba(255,255,255,0.04); }
.ks-dock-tab.is-active {
  color: var(--ks-amber);
  background: rgba(232, 162, 58, 0.12);
  border-color: var(--ks-amber-soft);
}
.ks-dock-body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
.ks-dock-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-dock-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ks-text-dim);
}
.ks-dock-field > span {
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-faint);
  text-transform: uppercase;
}
.ks-dock-field input[type="text"],
.ks-dock-field input:not([type]),
.ks-dock-field input[type="file"],
.ks-dock-field select,
.ks-dock-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--ks-font-cn);
  color: var(--ks-text);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  outline: none;
  transition: border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-dock-field input:focus,
.ks-dock-field select:focus,
.ks-dock-field textarea:focus {
  border-color: var(--ks-amber);
}
.ks-dock-field textarea {
  resize: vertical;
  min-height: 56px;
}
.ks-dock-field input[type="range"] { padding: 0; }

.ks-dock-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
}
.ks-dock-seg-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ks-text-dim);
  padding: 4px 10px;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  border-radius: calc(var(--ks-radius-sm) - 2px);
  cursor: pointer;
}
.ks-dock-seg-btn.is-active {
  color: var(--ks-amber);
  background: rgba(232, 162, 58, 0.15);
}

.ks-dock-audio-meta {
  font-size: 10px;
  color: var(--ks-text-dim);
  letter-spacing: 0.12em;
}

.ks-dock-chip {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-solid);
  border: 1px dashed var(--ks-amber-soft);
  color: var(--ks-amber);
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: grab;
  user-select: none;
  transition: background var(--ks-dur-fast) var(--ks-ease), border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-dock-chip:hover:not(.is-disabled) {
  background: rgba(232, 162, 58, 0.10);
  border-style: solid;
}
.ks-dock-chip:active:not(.is-disabled) { cursor: grabbing; }
.ks-dock-chip.is-disabled {
  color: var(--ks-text-faint);
  border-color: var(--ks-border-soft);
  cursor: not-allowed;
}
.ks-dock-chip-grip {
  font-size: 11px;
  letter-spacing: -2px;
  opacity: 0.6;
}

.ks-dock-hint {
  padding: 6px 10px 10px;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--ks-text-faint);
  text-align: center;
}
.ks-dock-empty {
  padding: 14px 8px;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ks-text-faint);
  text-align: center;
  border: 1px dashed var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-dock-media-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.ks-dock-media-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  cursor: grab;
  user-select: none;
  transition: border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-dock-media-item:hover {
  border-color: var(--ks-amber-soft);
}
.ks-dock-media-item:active { cursor: grabbing; }
.ks-dock-media-item.is-missing {
  cursor: not-allowed;
  opacity: 0.55;
}
.ks-dock-media-item.is-pending {
  border-color: var(--ks-amber-soft);
  box-shadow: 0 0 0 1px var(--ks-amber-soft);
}
.ks-dock-media-item.is-pending::after {
  /* pending 条纹罩：让"保存中"的条目视觉上明显地"不完成" */
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    -45deg,
    transparent 0 6px,
    rgba(232, 162, 58, 0.08) 6px 12px
  );
  pointer-events: none;
  border-radius: inherit;
}
.ks-dock-media-item.is-failed {
  border-color: rgba(232, 88, 88, 0.7);
  box-shadow: 0 0 0 1px rgba(232, 88, 88, 0.35);
}
.ks-dock-media-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ks-amber);
  background: rgba(28, 22, 15, 0.72);
  border: 1px solid var(--ks-amber-soft);
  border-radius: 999px;
  pointer-events: none;
  z-index: 2;
}
.ks-dock-media-badge.is-failed {
  color: rgb(236, 120, 120);
  border-color: rgba(232, 88, 88, 0.5);
}
/* 上传进度浮层 —— 覆盖 thumb 的下半部 */
.ks-dock-upload-overlay {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 7px;
  background: rgba(18, 14, 10, 0.78);
  border-radius: 6px;
  z-index: 3;
  pointer-events: auto;
}
.ks-dock-upload-bar {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.ks-dock-upload-bar-fill {
  height: 100%;
  background: linear-gradient(90deg,
    var(--ks-amber) 0%,
    color-mix(in oklab, var(--ks-amber) 70%, white) 100%);
  border-radius: 999px;
  transition: width 200ms linear;
}
.ks-dock-upload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(255, 240, 220, 0.92);
}
.ks-dock-upload-meta > span {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-dock-upload-cancel {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  color: rgba(255, 240, 220, 0.92);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.ks-dock-upload-cancel:hover {
  background: rgba(232, 88, 88, 0.85);
  border-color: rgba(232, 88, 88, 0.85);
  color: #fff;
}
.ks-dock-field-busy {
  margin-left: 6px;
  color: var(--ks-amber);
  font-size: 10px;
  letter-spacing: 0.1em;
}
.ks-dock-media-thumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: calc(var(--ks-radius-sm) - 2px);
  background: var(--ks-surface-warm);
  pointer-events: none;
}
.ks-dock-media-label {
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--ks-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-dock-media-miss {
  width: 100%;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ks-text-faint);
  background: repeating-linear-gradient(
    45deg,
    transparent 0 6px,
    rgba(255, 123, 61, 0.06) 6px 7px
  );
  border-radius: calc(var(--ks-radius-sm) - 2px);
}
.ks-dock-mg-blurb {
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--ks-text-dim);
  padding: 4px 8px;
  border-left: 2px solid rgba(255, 181, 80, 0.6);
  background: rgba(255, 181, 80, 0.06);
  border-radius: 4px;
}

/* AssetsDock（dock 第一页·素材库）—— 醒目「打开素材库」CTA + 成品图廊 */
.ks-assets-dock {
  gap: 8px;
  min-height: 0;
}
/* CTA 不缩, 图廊吃满剩余高度(空白点击区更大), 自身可滚 */
.ks-assets-dock > .ks-assets-dock-btn { flex: 0 0 auto; }
.ks-assets-dock > .ks-asset-gallery {
  flex: 1 1 auto;
  min-height: 140px;
}
.ks-assets-dock-btn {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 12px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11.5px;
  font-weight: 700;
  color: #15110a;
  background: var(--ks-amber, #d4ff48);
  border-radius: 999px;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--ks-amber, #d4ff48) 35%, transparent);
  transition: transform var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-assets-dock-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--ks-amber, #d4ff48) 50%, transparent);
}

/* DialogueDock v3.10 —— 上拖拽源 / 下详情面板 */
.ks-dialogue-dock {
  gap: 8px;
}
.ks-dialogue-templates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ks-dialogue-template-label {
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--ks-text-faint);
  text-transform: uppercase;
}
.ks-dialogue-template-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ks-dialogue-template-chip {
  margin-top: 0;
  padding: 6px 12px;
  font-size: 11.5px;
  letter-spacing: 0.16em;
  border-style: solid;
  border-color: var(--ks-amber-soft);
  /* 默认背景比常规 chip 略实，强调「这是一个『可拖到时间轴』的素材块」 */
  background: rgba(232, 162, 58, 0.06);
}
.ks-dialogue-detail-divider {
  height: 1px;
  background: var(--ks-border-soft);
  margin: 4px -2px;
}
.ks-dialogue-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ks-dialogue-empty {
  padding: 14px 8px;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ks-text-faint);
  text-align: center;
  border: 1px dashed var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}

/* ── 字幕页紧凑化（2026-06-19）─────────────────────────────────
 * 作者反馈：节点详情里「台词编辑/添加」太长、要往下拖才能编辑（占满两屏）。
 * 在 280px 的 dock band 里把字幕页压到一页内：模板标签与拖拽块同排、类型/署名
 * 标签与控件同排、台词框收到 3 行、收紧各处间距。仅作用于 .ks-dialogue-dock，
 * 不影响其它 dock 页。 */
.ks-dialogue-dock { gap: 6px; }
.ks-dialogue-dock .ks-dialogue-templates {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.ks-dialogue-dock .ks-dialogue-template-label { flex: 0 0 auto; }
.ks-dialogue-dock .ks-dialogue-template-chip {
  margin-top: 0;
  padding: 4px 10px;
  font-size: 11px;
}
.ks-dialogue-dock .ks-dialogue-detail-divider { margin: 2px -2px; }
.ks-dialogue-dock .ks-dialogue-detail { gap: 6px; }
/* 类型 / 署名：label 左、控件右 同排，省掉每项一行的标题高度 */
.ks-dialogue-dock .ks-dialogue-detail .ks-dock-field {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.ks-dialogue-dock .ks-dialogue-detail .ks-dock-field > span {
  flex: 0 0 30px;
}
.ks-dialogue-dock .ks-dialogue-detail .ks-dock-field .ks-dock-seg,
.ks-dialogue-dock .ks-dialogue-detail .ks-dock-field input { flex: 1 1 auto; }
/* 台词项例外：仍竖排让 textarea 占满整宽 */
.ks-dialogue-dock .ks-dialogue-detail .ks-field-text {
  flex-direction: column;
  align-items: stretch;
}
.ks-dialogue-dock .ks-dialogue-detail .ks-field-text > span { flex: none; }
.ks-dialogue-dock .ks-dialogue-detail .ks-field-text textarea { min-height: 44px; }

/* ── 数值 / 变量系统（VarsDock） ───────────────────────────── */
.ks-dock-tab-label {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--ks-text-faint);
  margin: 2px 0;
}
.ks-dock-empty {
  padding: 8px;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ks-text-faint);
  text-align: center;
  border: 1px dashed var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-dock-addbtn {
  appearance: none;
  border: 1px dashed var(--ks-border);
  background: transparent;
  color: var(--ks-text-dim);
  font-size: 11px;
  padding: 5px 8px;
  border-radius: var(--ks-radius-sm);
  cursor: pointer;
  font-family: var(--ks-font-cn);
}
.ks-dock-addbtn:hover { color: var(--ks-text); border-color: var(--ks-border-strong); }
.ks-var-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ks-var-row > input,
.ks-var-row > select {
  appearance: auto;
  min-width: 0;
  height: 26px;
  padding: 0 5px;
  font-size: 11px;
  color: var(--ks-text);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-var-name { flex: 1 1 auto; }
.ks-var-kind { flex: 0 0 auto; }
.ks-var-op { flex: 0 0 46px; text-align: center; }
.ks-var-init { flex: 0 0 64px; }
.ks-var-del {
  appearance: none;
  flex: 0 0 auto;
  width: 22px;
  height: 26px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ks-text-faint);
  cursor: pointer;
  border-radius: var(--ks-radius-sm);
}
.ks-var-del:hover { color: var(--ks-rose); border-color: var(--ks-rose); }
.ks-gate {
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: rgba(255,255,255,0.015);
}
.ks-gate-typerow { display: flex; gap: 5px; align-items: center; }
.ks-gate-labelinput {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 7px;
  font-size: 11px;
  color: var(--ks-text);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-gate-head {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ks-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-gate-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ks-gate-addcond { flex: 1 1 auto; }
.ks-gate-mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9.5px;
  color: var(--ks-text-faint);
}
.ks-gate-mode select {
  height: 24px;
  font-size: 10px;
  color: var(--ks-text);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
}
.ks-gate-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ks-text-faint);
  margin-top: 2px;
}
`
injectStyleOnce('timeline-dock', dockCss)
