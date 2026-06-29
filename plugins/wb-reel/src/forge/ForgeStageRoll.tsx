import { useMemo } from 'react'
import { useForgeChatStore } from './forgeChatStore'
import type {
  ForgeStage,
  StageDraftLogline,
  StageDraftOutline,
  StageDraftStyle,
  StageDraftSynopsis,
  StageRecord,
  StageStatus,
} from './forgeChatStore'
import {
  runStageLogline,
  runStageOutline,
  runStageStyle,
  runStageSynopsis,
} from './runStages'
import type { TextClient } from '../llm/types'
import { injectStyleOnce } from '../styles/injectStyle'
import { stageRollCss } from './ForgeStageRoll.css'

/**
 * ForgeStageRoll —— Forge 模块化锻造的"主流"展示。
 *
 * 设计要点（与 ForgeChatPanel 的关系）：
 *   - ChatPanel 仍然显示"作者发了什么 / 系统说了什么 / 锻造日志"。
 *   - StageRoll 显示"当前管道走到哪、每一步的 draft 长什么样"。
 *   - 两者共用 forgeChatStore，但渲染目标不同：消息流是过程，stage roll 是产物.
 *
 * 列表式时间线（idle → await-style → logline → synopsis → outline → expansion
 * → await-assets → generating-assets → confirmed）逐 stage 渲染卡片：
 *   - 还没走到 (records 里没有 entry)：渲染一个灰色 placeholder ("待开始")，
 *     仅在管道头部紧邻 current 的那几格显示，更下游的不渲染避免 UI 噪声.
 *   - 走过了但 status === 'idle' / 'running' / 'await-confirm' / 'failed' /
 *     'confirmed'：每种 status 渲染卡片头不同的 chip + 操作按钮.
 *
 * 每张卡片三按钮 (按需出现)：
 *   1. 修改 (patch)  —— 落焦到输入框, 让作者用自然语言提局部修改.
 *      默认实现：把 stage 名拼到草稿前缀 ("[改 logline] ...") 引导路由器；
 *      作者也可以直接在输入框敲, router 已经按 stage 兜底分流.
 *   2. 重生 (regenerate) —— 不带 instruction 调对应 runStageX, 重新出一版.
 *   3. 确认 (confirm)  —— store.confirmStage(scenarioId, stage, { advance: true }),
 *      推进 current 指针到下一个 stage; UI 自动渲染下游卡片.
 *
 * 历史归档 (stageHistory) 在卡片底部以折叠条形式呈现，不在主 roll 里反复 渲染
 * 旧版本，避免视觉混乱。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

interface ForgeStageRollProps {
  scenarioId: string
  llm: TextClient
  /**
   * 把焦点送回 ChatPanel 的输入框, 顺便预填一段引导文本 ("[改 logline] ...").
   * 由父组件实现 (持有 textarea ref); StageRoll 不假设 DOM 结构.
   */
  onRequestPatch: (stage: ForgeStage, hint?: string) => void
}

const VISIBLE_STAGES: ForgeStage[] = [
  'await-style',
  'logline',
  'synopsis',
  'outline',
  'expansion',
  'await-assets',
]

export function ForgeStageRoll({ scenarioId, llm, onRequestPatch }: ForgeStageRollProps) {
  const stages = useForgeChatStore((s) => s.getSession(scenarioId).stages)
  const pending = useForgeChatStore((s) => s.getSession(scenarioId).pending)

  const { current, records } = stages
  // 计算需要渲染的卡片：所有已存在 record 的 stage + current（即便没 record 也画占位）
  const renderList = useMemo<ForgeStage[]>(() => {
    const out: ForgeStage[] = []
    for (const k of VISIBLE_STAGES) {
      if (records[k] || k === current) out.push(k)
      // current 之后的 stages 不主动渲染, 避免空卡片噪声; 用户走到了再出现
      if (k === current) break
    }
    return out
  }, [current, records])

  if (current === 'idle' && Object.keys(records).length === 0) {
    return null
  }

  const isAnyRunning = pending !== null

  return (
    <section className="ks-forge-stages-roll" aria-label="forge stages">
      <header className="ks-forge-stages-roll-head ks-mono">
        <span className="ks-forge-stages-roll-kicker">PIPELINE</span>
        <span className="ks-forge-stages-roll-sub">
          {labelOfStage(current)}
        </span>
      </header>

      <ol className="ks-forge-stages-roll-list">
        {renderList.map((stage) => {
          const rec = records[stage] as StageRecord | undefined
          const isCurrent = stage === current
          return (
            <li
              key={stage}
              className={[
                'ks-forge-stage-card',
                rec ? `is-${rec.status}` : 'is-pending',
                isCurrent ? 'is-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <StageCard
                scenarioId={scenarioId}
                llm={llm}
                stage={stage}
                record={rec}
                disabled={isAnyRunning}
                onRequestPatch={onRequestPatch}
              />
            </li>
          )
        })}
      </ol>

      {stages.history.length > 0 && (
        <details className="ks-forge-stages-history">
          <summary className="ks-mono">
            历史归档 · {stages.history.length} 条
          </summary>
          <ul>
            {stages.history.map((h, i) => (
              <li key={i}>
                <span className="ks-mono">
                  {labelOfStage(h.kind)} · {new Date(h.at).toLocaleString()}
                </span>
                {h.note && <span> · {h.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 单卡片
// ─────────────────────────────────────────────────────────────────────────────

interface StageCardProps {
  scenarioId: string
  llm: TextClient
  stage: ForgeStage
  record: StageRecord | undefined
  disabled: boolean
  onRequestPatch: (stage: ForgeStage, hint?: string) => void
}

function StageCard({ scenarioId, llm, stage, record, disabled, onRequestPatch }: StageCardProps) {
  const status: StageStatus = record?.status ?? 'idle'
  const chat = useForgeChatStore.getState()

  const handleRegenerate = (): void => {
    void runStageOf(stage, { scenarioId, llm })
  }
  const handleConfirm = (): void => {
    chat.confirmStage(scenarioId, stage, { advance: true })
  }
  const handlePatch = (): void => {
    onRequestPatch(stage, `[改${labelOfStage(stage)}] `)
  }

  return (
    <div className="ks-forge-stage-card-inner">
      <header className="ks-forge-stage-card-head">
        <div className="ks-forge-stage-card-titlewrap">
          <span className="ks-forge-stage-card-kicker ks-mono">
            STAGE · {stageOrdinal(stage)}
          </span>
          <h4 className="ks-forge-stage-card-title ks-cn">
            {labelOfStage(stage)}
          </h4>
        </div>
        <StatusChip status={status} error={record?.error} />
      </header>

      <div className="ks-forge-stage-card-body">
        <StageBody stage={stage} record={record} scenarioId={scenarioId} />
      </div>

      <footer className="ks-forge-stage-card-actions">
        {status === 'idle' && stage === 'await-style' && (
          <button
            type="button"
            className="ks-forge-stage-btn is-primary"
            onClick={handleRegenerate}
            disabled={disabled}
            title="基于作者最近的想法/上传的剧本, 让 LLM 给一版风格策展"
          >
            开始风格策展
          </button>
        )}
        {status === 'failed' && (
          <button
            type="button"
            className="ks-forge-stage-btn is-primary"
            onClick={handleRegenerate}
            disabled={disabled}
          >
            重试
          </button>
        )}
        {status === 'await-confirm' && (
          <>
            <button
              type="button"
              className="ks-forge-stage-btn"
              onClick={handlePatch}
              disabled={disabled}
              title="用自然语言提一个局部修改诉求 (例如 把女主改成男生)"
            >
              修改
            </button>
            <button
              type="button"
              className="ks-forge-stage-btn"
              onClick={handleRegenerate}
              disabled={disabled}
              title="不带 instruction, 整段重新生成一版"
            >
              重生
            </button>
            <button
              type="button"
              className="ks-forge-stage-btn is-primary"
              onClick={handleConfirm}
              disabled={disabled}
              title="确认这一版, 推进到下一阶段"
            >
              确认 ⏎
            </button>
          </>
        )}
        {status === 'running' && (
          <span className="ks-forge-stage-running ks-mono">
            <span className="ks-forge-stage-spinner" /> 锻造中…
          </span>
        )}
      </footer>
    </div>
  )
}

function StatusChip({ status, error }: { status: StageStatus; error?: string }) {
  const map: Record<StageStatus, { label: string; cls: string }> = {
    idle: { label: '待开始', cls: 'is-idle' },
    running: { label: '生成中', cls: 'is-running' },
    'await-confirm': { label: '待确认', cls: 'is-await' },
    confirmed: { label: '已确认', cls: 'is-confirmed' },
    failed: { label: '失败', cls: 'is-failed' },
  }
  const m = map[status]
  return (
    <span
      className={`ks-forge-stage-chip ${m.cls}`}
      title={error ? error : undefined}
    >
      {m.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 各 stage 的 body 渲染（只读视图；编辑走 patch instruction）
// ─────────────────────────────────────────────────────────────────────────────

function StageBody({
  stage,
  record,
  scenarioId,
}: {
  stage: ForgeStage
  record: StageRecord | undefined
  scenarioId: string
}) {
  if (!record) {
    return (
      <div className="ks-forge-stage-body-empty ks-cn">
        点上方按钮开始这一步, 或在下面对话框里说一句你的诉求.
      </div>
    )
  }
  if (record.status === 'failed') {
    return (
      <div className="ks-forge-stage-body-error ks-cn">
        <strong>失败：</strong>
        {record.error || '未知错误'}
      </div>
    )
  }
  if (record.status === 'running' || record.status === 'idle') {
    return (
      <div className="ks-forge-stage-body-empty ks-cn">
        {record.status === 'running' ? '模型正在写…' : '准备就绪'}
      </div>
    )
  }
  // editable: 草稿出来 (await-confirm) 才允许控件快捷修改;
  // 已 confirmed 的卡片只读 —— 想改, 用作者的"回到 outline 改"指令重启.
  const editable = record.status === 'await-confirm'
  switch (stage) {
    case 'await-style':
      return <StyleBody draft={record.draft as StageDraftStyle} />
    case 'logline':
      return <LoglineBody draft={record.draft as StageDraftLogline} />
    case 'synopsis':
      return <SynopsisBody draft={record.draft as StageDraftSynopsis} />
    case 'outline':
      return (
        <OutlineBody
          draft={record.draft as StageDraftOutline}
          scenarioId={scenarioId}
          editable={editable}
        />
      )
    default:
      return (
        <div className="ks-forge-stage-body-empty ks-cn">
          (这个 stage 还没接入卡片预览)
        </div>
      )
  }
}

function StyleBody({ draft }: { draft: StageDraftStyle }) {
  return (
    <div className="ks-forge-stage-style ks-cn">
      {draft.director && (
        <Row label="导演" value={draft.director} />
      )}
      {draft.writer && <Row label="编剧" value={draft.writer} />}
      {draft.visualPreset && <Row label="视觉" value={draft.visualPreset} />}
      {draft.notes && <Row label="备注" value={draft.notes} />}
    </div>
  )
}

function LoglineBody({ draft }: { draft: StageDraftLogline }) {
  return (
    <div className="ks-forge-stage-logline ks-cn">
      <p className="ks-forge-stage-logline-main">{draft.text || '(空)'}</p>
      {draft.alternatives && draft.alternatives.length > 0 && (
        <ul className="ks-forge-stage-logline-alts">
          {draft.alternatives.map((a, i) => (
            <li key={i}>
              <span className="ks-mono">备选 {i + 1}</span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SynopsisBody({ draft }: { draft: StageDraftSynopsis }) {
  return (
    <div className="ks-forge-stage-synopsis ks-cn">
      <p>{draft.text || '(空)'}</p>
      {draft.beats && draft.beats.length > 0 && (
        <ol className="ks-forge-stage-synopsis-beats">
          {draft.beats.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function OutlineBody({
  draft,
  scenarioId,
  editable,
}: {
  draft: StageDraftOutline
  scenarioId: string
  editable: boolean
}) {
  if (!draft.chapters?.length) {
    return <div className="ks-forge-stage-body-empty ks-cn">(空大纲)</div>
  }
  // 控件快捷通道: 直接对 stage draft 做不可变更新 —— 不走 LLM, 不走 jsonPatch
  // (因为 stage draft 还没 commit 到 scenario, 还在 forgeChatStore 里).
  // 这是"控件" + "自然语言" 双通道里的控件那一边: 上移/下移/删除三个常用操作.
  const moveChapter = (id: string, dir: -1 | 1): void => {
    const chapters = [...draft.chapters!]
    const i = chapters.findIndex((c) => c.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= chapters.length) return
    ;[chapters[i], chapters[j]] = [chapters[j]!, chapters[i]!]
    useForgeChatStore
      .getState()
      .setStageDraft(scenarioId, 'outline', { ...draft, chapters })
  }
  const deleteChapter = (id: string): void => {
    const chapters = (draft.chapters ?? []).filter((c) => c.id !== id)
    useForgeChatStore
      .getState()
      .setStageDraft(scenarioId, 'outline', { ...draft, chapters })
  }
  return (
    <ol className="ks-forge-stage-outline ks-cn">
      {draft.chapters.map((c, idx) => (
        <li key={c.id} className="ks-forge-stage-outline-item">
          <div className="ks-forge-stage-outline-text">
            <strong>{c.title}</strong>
            <span> · {c.summary}</span>
          </div>
          {editable && (
            <div className="ks-forge-stage-outline-tools">
              <button
                type="button"
                className="ks-forge-stage-outline-tool"
                title="上移"
                disabled={idx === 0}
                onClick={() => moveChapter(c.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="ks-forge-stage-outline-tool"
                title="下移"
                disabled={idx === draft.chapters!.length - 1}
                onClick={() => moveChapter(c.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="ks-forge-stage-outline-tool is-danger"
                title="删除此章节"
                onClick={() => deleteChapter(c.id)}
              >
                删
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ks-forge-stage-row">
      <span className="ks-forge-stage-row-key ks-mono">{label}</span>
      <span className="ks-forge-stage-row-val">{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 路由 stage → runStage 函数
// ─────────────────────────────────────────────────────────────────────────────

function runStageOf(
  stage: ForgeStage,
  args: { scenarioId: string; llm: TextClient; instruction?: string },
): Promise<void> {
  switch (stage) {
    case 'await-style':
      return runStageStyle(args)
    case 'logline':
      return runStageLogline(args)
    case 'synopsis':
      return runStageSynopsis(args)
    case 'outline':
      return runStageOutline(args)
    default:
      // expansion / assets 阶段暂未接入卡片驱动 runner; 后续 PR 切.
      return Promise.resolve()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 字典：stage → 中文标签 / 序号
// ─────────────────────────────────────────────────────────────────────────────

function labelOfStage(stage: ForgeStage): string {
  switch (stage) {
    case 'idle':
      return '尚未开始'
    case 'await-style':
      return '风格策展'
    case 'logline':
      return '一句话核心冲突'
    case 'synopsis':
      return '梗概与节拍'
    case 'outline':
      return '故事大纲'
    case 'expansion':
      return '分幕扩写'
    case 'await-assets':
      return '等待资产生成'
    case 'generating-assets':
      return '资产生成中'
    case 'confirmed':
      return '定稿'
  }
}

function stageOrdinal(stage: ForgeStage): string {
  const idx = VISIBLE_STAGES.indexOf(stage)
  return idx >= 0 ? String(idx + 1).padStart(2, '0') : '--'
}

injectStyleOnce('forge-stage-roll', stageRollCss)
