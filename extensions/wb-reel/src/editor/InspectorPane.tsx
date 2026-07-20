import { useShallow } from 'zustand/react/shallow'
import { useScenarioStore } from '../scenario/scenarioStore'
import type {
  Branch,
  DialogueLine,
  QTECue,
  Scene,
} from '../scenario/types'
import { PromptTabs } from './PromptTabs'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 右栏 · INSPECTOR PANE —— 当前 Scene 的全部可编辑属性
 *
 * 分四组卡片：
 *   - SCENE META （标题/时长/媒体提示词）
 *   - DIALOGUE   （台词列表 inline 编辑）
 *   - QTE        （节奏点列表 + 全局窗口/分值）
 *   - BRANCHES   （分支跳转）
 *
 * 全部 inline 编辑，change 直接落到 store。
 * 每个子项均可 add / remove。
 */
export function InspectorPane() {
  const scenario = useScenarioStore((s) => s.scenario)
  const sceneId = useScenarioStore((s) => s.selectedSceneId)
  const scene = scenario.scenes[sceneId]

  if (!scene) {
    return <div className="ks-inspector-empty ks-mono">未选中场景</div>
  }

  return (
    <div className="ks-inspector">
      <SceneMetaCard scene={scene} />
      <PromptTabsCard scene={scene} />
      <DialogueCard scene={scene} />
      <QTECard scene={scene} />
      <BranchCard scene={scene} sceneIds={Object.keys(scenario.scenes)} />
    </div>
  )
}

export function PromptTabsCard({ scene }: { scene: Scene }) {
  return (
    <Card title="提示词与媒体 · PROMPTS & MEDIA">
      <PromptTabs scene={scene} />
    </Card>
  )
}

export function SceneMetaCard({ scene }: { scene: Scene }) {
  const updateScene = useScenarioStore((s) => s.updateScene)

  return (
    <Card title={`场景属性 · ${scene.id}`}>
      <Field label="标题">
        <input
          type="text"
          value={scene.title}
          onChange={(e) => updateScene(scene.id, { title: e.target.value })}
        />
      </Field>
      <Field label="时长 (ms)">
        <input
          type="number"
          value={scene.durationMs}
          min={1000}
          step={100}
          onChange={(e) =>
            updateScene(scene.id, { durationMs: Number(e.target.value) || 0 })
          }
        />
      </Field>
      <Field label="媒体类型">
        <span className="ks-mono ks-faint">{scene.media.kind}</span>
      </Field>
      {/*
       * v3 · 背景描述（scene.background）
       *
       * 专门拆出来的原因：这段文字**不**上字幕带、**不**念出来（不进 DialogueLine），
       * 只喂生图和帮镜头对齐空间。旁白 narration 仍然走 DialogueCard 下面的
       * "narration · 旁白"条目——两者分家后彼此 schema 独立，不再靠 role 区分含义。
       * 留空相当于"本场景没有独立的舞美描述"，生图时回退到 prompt.scene 即可。
       */}
      <Field label="背景描述" align="top">
        <textarea
          rows={3}
          value={scene.background ?? ''}
          placeholder="导演/舞美：雨夜地下车库的冷蓝惨白、霓虹残迹、远处水滴……"
          onChange={(e) =>
            updateScene(scene.id, { background: e.target.value })
          }
        />
      </Field>
    </Card>
  )
}

export function DialogueCard({ scene }: { scene: Scene }) {
  const update = useScenarioStore((s) => s.updateDialogue)
  const remove = useScenarioStore((s) => s.removeDialogue)
  const add = useScenarioStore((s) => s.addDialogue)

  function makeId(): string {
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  return (
    <Card title={`台词 · ${scene.dialogue.length}`}>
      {scene.dialogue.map((d) => (
        <DialogueRow
          key={d.id}
          line={d}
          onChange={(p) => update(scene.id, d.id, p)}
          onRemove={() => remove(scene.id, d.id)}
        />
      ))}
      <button
        type="button"
        className="ks-add-row"
        onClick={() =>
          add(scene.id, {
            id: makeId(),
            role: 'narration',
            text: '新台词…',
            startMs: scene.dialogue.length === 0
              ? 200
              : Math.min(
                  scene.durationMs - 200,
                  (scene.dialogue[scene.dialogue.length - 1]?.startMs ?? 0) + 1500,
                ),
          })
        }
      >
        + 添加台词
      </button>
    </Card>
  )
}

function DialogueRow({
  line,
  onChange,
  onRemove,
}: {
  line: DialogueLine
  onChange: (p: Partial<DialogueLine>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-sub-card">
      <div className="ks-sub-card-head">
        <select
          value={line.role}
          onChange={(e) =>
            onChange({ role: e.target.value as DialogueLine['role'] })
          }
        >
          <option value="narration">narration · 旁白</option>
          <option value="protagonist">protagonist · 主角</option>
          <option value="character">character · 角色</option>
          <option value="system">system · 系统</option>
        </select>
        {line.role === 'character' && (
          <input
            type="text"
            placeholder="speaker"
            value={line.speaker ?? ''}
            onChange={(e) => onChange({ speaker: e.target.value })}
          />
        )}
        <button type="button" onClick={onRemove} className="ks-row-del">
          ×
        </button>
      </div>
      <textarea
        rows={2}
        value={line.text}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      <div className="ks-sub-card-grid">
        <Field label="start" inline>
          <input
            type="number"
            value={line.startMs}
            min={0}
            step={50}
            onChange={(e) => onChange({ startMs: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="end" inline>
          <input
            type="number"
            value={line.endMs ?? ''}
            min={0}
            step={50}
            placeholder="auto"
            onChange={(e) =>
              onChange({
                endMs: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </Field>
      </div>
    </div>
  )
}

export function QTECard({ scene }: { scene: Scene }) {
  const setQTESpec = useScenarioStore((s) => s.setQTESpec)
  const updateCue = useScenarioStore((s) => s.updateQTECue)
  const addCue = useScenarioStore((s) => s.addQTECue)
  const removeCue = useScenarioStore((s) => s.removeQTECue)

  if (!scene.qte) {
    return (
      <Card title="QTE · (无)">
        <button
          type="button"
          className="ks-add-row"
          onClick={() =>
            setQTESpec(scene.id, {
              cues: [],
              // 命中窗口默认值 —— 跟 demo 剧本保持一致，互动影游式节奏。
              // 过去这里是 { perfect: 80, great: 160, good: 280 }（音游级），
              // 作者新建 QTE 后玩家反映"刚出现就过期"、"按住也失败"，
              // 根因就是这组窗口太窄。统一放宽到 demo 量级。
              window: { perfect: 400, great: 800, good: 1500 },
              score: { perfect: 100, great: 60, good: 25, miss: -30 },
              passingScore: 200,
            })
          }
        >
          + 启用 QTE
        </button>
      </Card>
    )
  }
  const spec = scene.qte
  function makeCueId(): string {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  return (
    <Card title={`QTE · ${spec.cues.length} cues`}>
      <div className="ks-sub-card-grid">
        <Field label="perfect" inline>
          <input
            type="number"
            value={spec.window.perfect}
            min={20}
            step={10}
            onChange={(e) =>
              setQTESpec(scene.id, {
                ...spec,
                window: { ...spec.window, perfect: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="great" inline>
          <input
            type="number"
            value={spec.window.great}
            min={40}
            step={10}
            onChange={(e) =>
              setQTESpec(scene.id, {
                ...spec,
                window: { ...spec.window, great: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="good" inline>
          <input
            type="number"
            value={spec.window.good}
            min={80}
            step={10}
            onChange={(e) =>
              setQTESpec(scene.id, {
                ...spec,
                window: { ...spec.window, good: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="passing" inline>
          <input
            type="number"
            value={spec.passingScore ?? 0}
            step={10}
            onChange={(e) =>
              setQTESpec(scene.id, {
                ...spec,
                passingScore: Number(e.target.value) || 0,
              })
            }
          />
        </Field>
      </div>

      {spec.cues.map((c) => (
        <CueRow
          key={c.id}
          cue={c}
          onChange={(p) => updateCue(scene.id, c.id, p)}
          onRemove={() => removeCue(scene.id, c.id)}
        />
      ))}
      <button
        type="button"
        className="ks-add-row"
        onClick={() =>
          addCue(scene.id, {
            id: makeCueId(),
            shape: 'tap',
            x: 0.5,
            y: 0.5,
            appearAt: spec.cues.length === 0 ? 1500 : (spec.cues.at(-1)?.targetAt ?? 0) + 800,
            targetAt: spec.cues.length === 0 ? 2300 : (spec.cues.at(-1)?.targetAt ?? 0) + 1600,
          })
        }
      >
        + 添加节奏点
      </button>
      <button
        type="button"
        className="ks-add-row ks-row-del-line"
        onClick={() => setQTESpec(scene.id, undefined)}
      >
        × 移除整个 QTE
      </button>
    </Card>
  )
}

function CueRow({
  cue,
  onChange,
  onRemove,
}: {
  cue: QTECue
  onChange: (p: Partial<QTECue>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-sub-card">
      <div className="ks-sub-card-head">
        <select
          value={cue.shape}
          onChange={(e) => onChange({ shape: e.target.value as QTECue['shape'] })}
        >
          <option value="tap">tap · 点</option>
          <option value="hold">hold · 长按</option>
          <option value="sweep">sweep · 滑动</option>
        </select>
        <input
          type="text"
          placeholder="label"
          value={cue.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <button type="button" onClick={onRemove} className="ks-row-del">
          ×
        </button>
      </div>
      <div className="ks-sub-card-grid">
        <Field label="appear" inline>
          <input
            type="number"
            value={cue.appearAt}
            step={50}
            onChange={(e) => onChange({ appearAt: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="target" inline>
          <input
            type="number"
            value={cue.targetAt}
            step={50}
            onChange={(e) => onChange({ targetAt: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="x" inline>
          <input
            type="number"
            value={cue.x}
            min={0} max={1}
            step={0.05}
            onChange={(e) => onChange({ x: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="y" inline>
          <input
            type="number"
            value={cue.y}
            min={0} max={1}
            step={0.05}
            onChange={(e) => onChange({ y: Number(e.target.value) || 0 })}
          />
        </Field>
        {cue.shape === 'hold' && (
          <Field label="dur" inline>
            <input
              type="number"
              value={cue.durationMs ?? 800}
              step={100}
              onChange={(e) => onChange({ durationMs: Number(e.target.value) || 0 })}
            />
          </Field>
        )}
      </div>

      <SlowMoEditor
        cue={cue}
        onChange={(slowMoPatch) =>
          onChange({
            slowMo: slowMoPatch === null ? undefined : { ...(cue.slowMo ?? { rate: 0.3 }), ...slowMoPatch },
          })
        }
      />
    </div>
  )
}

/**
 * 触发点 / 子弹时间编辑器 —— 跟在 CueRow 末尾，作为可折叠子卡片。
 *
 * 没启用时显示一个"+ 升级为触发点"按钮；启用后显示：
 *   rate · leadIn · holdAfterHit · requireHit · failSceneId
 * 一键移除回到普通 QTE。
 */
function SlowMoEditor({
  cue,
  onChange,
}: {
  cue: QTECue
  onChange: (patch: Partial<NonNullable<QTECue['slowMo']>> | null) => void
}) {
  // 用 useShallow 浅比较 —— 否则每次 Object.keys() 返新数组，
  // React 18 的 useSyncExternalStore 视为 snapshot 变化 → 死循环重渲。
  const sceneIds = useScenarioStore(
    useShallow((s) => Object.keys(s.scenario.scenes)),
  )

  if (!cue.slowMo) {
    return (
      <button
        type="button"
        className="ks-add-row ks-slowmo-toggle"
        onClick={() => onChange({ rate: 0.3, leadInMs: 200, requireHit: true })}
        title="把这个节奏点升级成视频时间轴上的触发点：进入区间慢放，命中继续，失败结算"
      >
        ✦ 升级为触发点 / 子弹时间
      </button>
    )
  }
  const slow = cue.slowMo
  const requireHit = slow.requireHit !== false
  return (
    <div className="ks-sub-card ks-slowmo-card">
      <div className="ks-sub-card-head">
        <span className="ks-mono ks-slowmo-tag-inline">SLOW · TRIGGER</span>
        <button type="button" onClick={() => onChange(null)} className="ks-row-del">
          ×
        </button>
      </div>
      <div className="ks-sub-card-grid">
        <Field label="rate" inline>
          <input
            type="number"
            value={slow.rate}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(e) =>
              onChange({ rate: clamp(Number(e.target.value) || 0.3, 0.05, 1) })
            }
          />
        </Field>
        <Field label="leadIn" inline>
          <input
            type="number"
            value={slow.leadInMs ?? 0}
            min={0}
            step={50}
            onChange={(e) => onChange({ leadInMs: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
        <Field label="hold-after-hit" inline>
          <input
            type="number"
            value={slow.holdAfterHitMs ?? 0}
            min={0}
            step={50}
            onChange={(e) => onChange({ holdAfterHitMs: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
        <Field label="requireHit" inline>
          <select
            value={requireHit ? 'yes' : 'no'}
            onChange={(e) => onChange({ requireHit: e.target.value === 'yes' })}
          >
            <option value="yes">必命中（失败结算）</option>
            <option value="no">仅氛围（不影响）</option>
          </select>
        </Field>
        <Field label="failSceneId" inline>
          <select
            value={slow.failSceneId ?? ''}
            onChange={(e) =>
              onChange({ failSceneId: e.target.value || undefined })
            }
          >
            <option value="">— 走 qte_fail 分支 / 弹结算屏 —</option>
            {sceneIds.map((id) => (
              <option key={id} value={id}>
                → {id}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function BranchCard({
  scene,
  sceneIds,
}: {
  scene: Scene
  sceneIds: string[]
}) {
  const update = useScenarioStore((s) => s.updateBranch)
  const remove = useScenarioStore((s) => s.removeBranch)
  const add = useScenarioStore((s) => s.addBranch)

  function makeBranchId(): string {
    return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  return (
    <Card title={`分支 · ${scene.branches.length}`}>
      {scene.branches.map((b) => (
        <BranchRow
          key={b.id}
          branch={b}
          sceneIds={sceneIds}
          onChange={(p) => update(scene.id, b.id, p)}
          onRemove={() => remove(scene.id, b.id)}
        />
      ))}
      <button
        type="button"
        className="ks-add-row"
        onClick={() =>
          add(scene.id, {
            id: makeBranchId(),
            kind: 'choice',
            label: '新选项',
            targetSceneId: sceneIds.find((id) => id !== scene.id) ?? scene.id,
            showAt: scene.durationMs - 1000,
          })
        }
      >
        + 添加分支
      </button>
    </Card>
  )
}

function BranchRow({
  branch,
  sceneIds,
  onChange,
  onRemove,
}: {
  branch: Branch
  sceneIds: string[]
  onChange: (p: Partial<Branch>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-sub-card">
      <div className="ks-sub-card-head">
        <select
          value={branch.kind}
          onChange={(e) => onChange({ kind: e.target.value as Branch['kind'] })}
        >
          <option value="choice">choice · 选项</option>
          <option value="qte_pass">qte_pass · QTE 通过</option>
          <option value="qte_fail">qte_fail · QTE 失败</option>
          <option value="auto">auto · 自动</option>
        </select>
        <button type="button" onClick={onRemove} className="ks-row-del">
          ×
        </button>
      </div>
      {branch.kind === 'choice' && (
        <input
          type="text"
          placeholder="选项文本"
          value={branch.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      )}
      <div className="ks-sub-card-grid">
        <Field label="target" inline>
          <select
            value={branch.targetSceneId}
            onChange={(e) => onChange({ targetSceneId: e.target.value })}
          >
            {sceneIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Field>
        {branch.kind === 'choice' && (
          <Field label="showAt" inline>
            <input
              type="number"
              value={branch.showAt ?? 0}
              step={100}
              onChange={(e) => onChange({ showAt: Number(e.target.value) || 0 })}
            />
          </Field>
        )}
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ks-card">
      <div className="ks-section-title">{title}</div>
      <div className="ks-card-body">{children}</div>
    </section>
  )
}

function Field({
  label,
  children,
  align = 'center',
  inline = false,
}: {
  label: string
  children: React.ReactNode
  align?: 'center' | 'top'
  inline?: boolean
}) {
  return (
    <div className={`ks-field ${inline ? 'ks-field-inline' : ''} ks-field-${align}`}>
      <label className="ks-field-label ks-mono">{label}</label>
      <div className="ks-field-input">{children}</div>
    </div>
  )
}

const inspectCss = `
.ks-inspector {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex; flex-direction: column;
  gap: 14px;
  padding: 14px 14px 18px;
}
.ks-inspector-empty {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--ks-text-faint);
  letter-spacing: 0.02em;
  text-align: center;
  font-size: 13px;
}
.ks-card {
  display: flex; flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-soft), var(--ks-shadow-inset-hi);
}
.ks-card-body {
  display: flex; flex-direction: column;
  gap: 8px;
}
.ks-field {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.ks-field-inline {
  grid-template-columns: 56px minmax(0, 1fr);
}
.ks-field-top { align-items: start; }
.ks-field-label {
  font-family: var(--ks-font-ui);
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ks-text-dim);
  font-weight: 500;
}
.ks-field-input input,
.ks-field-input textarea,
.ks-field-input select {
  width: 100%;
}
.ks-sub-card {
  display: flex; flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
}
.ks-sub-card-head {
  display: flex; gap: 8px; align-items: center;
}
.ks-sub-card-head select {
  flex: 0 0 auto;
  font-size: 11.5px;
  padding: 6px 8px;
}
.ks-sub-card-head input {
  flex: 1;
  font-size: 11.5px;
  padding: 6px 10px;
}
.ks-sub-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}
.ks-row-del {
  all: unset;
  cursor: pointer;
  padding: 2px 8px;
  color: var(--ks-rose);
  font-size: 14px;
  line-height: 1;
  border-radius: var(--ks-radius-pill);
  transition: background var(--ks-dur-fast);
}
.ks-row-del:hover { background: rgba(240, 119, 157, 0.14); }

.ks-add-row {
  font-family: var(--ks-font-ui);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 6px 14px;
  background: rgba(108, 143, 184, 0.08);
  border-color: rgba(108, 143, 184, 0.35);
  color: var(--ks-cyan);
  border-radius: var(--ks-radius-pill);
}
.ks-row-del-line {
  background: rgba(240, 119, 157, 0.06);
  border-color: rgba(240, 119, 157, 0.35);
  color: var(--ks-rose);
  border-radius: var(--ks-radius-pill);
}

.ks-slowmo-toggle {
  align-self: flex-start;
  margin-top: 4px;
  background: var(--ks-amber-soft);
  border-color: rgba(255, 123, 61, 0.35);
  color: var(--ks-amber);
  letter-spacing: 0;
  font-weight: 500;
  border-radius: var(--ks-radius-pill);
  padding: 6px 14px;
}
.ks-slowmo-toggle:hover:not(:disabled) {
  background: rgba(255, 123, 61, 0.16);
  border-color: var(--ks-amber);
  color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
}
.ks-slowmo-card {
  background:
    repeating-linear-gradient(
      135deg,
      rgba(108, 143, 184, 0.05) 0 8px,
      rgba(255, 123, 61, 0.04) 8px 16px
    ),
    var(--ks-panel-solid);
  border-color: rgba(108, 143, 184, 0.3);
  margin-top: 4px;
}
.ks-slowmo-tag-inline {
  flex: 1;
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: var(--ks-cyan);
  text-transform: uppercase;
  font-weight: 600;
}
`
injectStyleOnce('inspector-pane', inspectCss)
