import { useEffect, useLayoutEffect, useRef } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import type { OutlineNode } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

const EMPTY_OUTLINE: OutlineNode[] = []

/**
 * 随内容自动撑高的 textarea —— 大纲概要不再写死行数 / 内部滚动截断，
 * 完整内容直接铺开（卡片高度随之增长）。
 *
 * ⚠ 关键：ForgeStudio 把 5 个面板**同时挂载、用 `hidden`(display:none) 切显隐**。
 * 本组件可能在隐藏态下挂载，此时 `scrollHeight` 量到 0、撑不开；切到可见也不会
 * 自动重算。故用 `ResizeObserver` 监听 textarea **宽度**变化（隐藏→显示会从 0 变
 * 成真实宽度，换列/缩放同理），一变可见就重测高度。用"宽度变化"做判据，避开
 * "设高度 → 触发 observer"的反馈死循环（设高度不改宽度）。
 */
function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
}: {
  value: string
  onChange: (next: string) => void
  className?: string
  placeholder?: string
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const resize = (): void => {
    const el = ref.current
    if (!el) return
    if (el.clientWidth === 0) return // 隐藏态量不准，跳过；变可见时 RO 会再触发
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(resize, [value])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastW = -1
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w !== lastW) {
        lastW = w
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={minRows}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * OutlinePanel —— 剧情大纲 / 脑图（小说家工作板 · 第 4 段）。
 *
 * 数据源：`Scenario.outline: OutlineNode[]`（v5 新增）。
 *
 * 展示形态（2026-06 作者反馈："要卡牌形式，不是表单行"）：
 *   - **卡牌网格**：每个幕（act）= 一张卡，顶部为幕序号徽章条 + 幕标题，中部概要，
 *     底部其下 Beat 以 mini 卡片堆叠。网格平铺自适应列数。
 *   - 增删改 / +Beat / 级联删除等功能与旧列表完全一致，仅排版升级为卡牌。
 *   - 纯用主站主题 token，不引入自创配色。
 *
 * 与 scenes 的关系：大纲改了 ≠ 自动重写 scenes；想"按新大纲扩写"→ chat 输 `/expand`。
 */
export function OutlinePanel() {
  const outline = useScenarioStore((s) => s.scenario.outline ?? EMPTY_OUTLINE)
  const upsert = useScenarioStore((s) => s.upsertOutlineNode)
  const remove = useScenarioStore((s) => s.removeOutlineNode)

  const acts = [...outline].filter((n) => !n.parentId).sort((a, b) => a.order - b.order)

  function makeId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  function handleAddAct(): void {
    upsert({
      id: makeId('act'),
      title: `第${acts.length + 1}幕`,
      summary: '',
      order: acts.length,
    })
  }

  function handleAddBeat(parentId: string): void {
    const siblings = outline.filter((n) => n.parentId === parentId)
    upsert({
      id: makeId('beat'),
      parentId,
      title: `Beat ${siblings.length + 1}`,
      summary: '',
      order: siblings.length,
    })
  }

  return (
    <div className="ks-fs-panel ks-fs-outline">
      <div className="ks-fs-panel-head">
        <span className="ks-mono ks-faint">剧情大纲 · OUTLINE</span>
        <button type="button" className="ks-fs-add-btn" onClick={handleAddAct}>
          + 新增幕
        </button>
      </div>

      {acts.length === 0 ? (
        <div className="ks-fs-empty">
          <div className="ks-fs-empty-title">还没有大纲</div>
          <div className="ks-fs-empty-body">
            点「+ 新增幕」手动搭骨架，或在右侧 chat 写一段故事让 AI 拉大纲。
            <br />
            想根据已有梗概反向提炼大纲？输入 <code>/outline</code>。
          </div>
        </div>
      ) : (
        <div className="ks-oc-grid">
          {acts.map((act, idx) => {
            const beats = outline
              .filter((n) => n.parentId === act.id)
              .sort((a, b) => a.order - b.order)
            return (
              <div key={act.id} className="ks-oc-act">
                <div className="ks-oc-act-band">
                  <span className="ks-oc-badge">{String(idx + 1).padStart(2, '0')}</span>
                  <input
                    type="text"
                    className="ks-oc-title"
                    value={act.title}
                    onChange={(e) => upsert({ ...act, title: e.target.value })}
                    placeholder="幕标题"
                  />
                  <button
                    type="button"
                    className="ks-oc-del"
                    onClick={() => remove(act.id)}
                    title="删除该幕（连带删除其下 Beat）"
                  >
                    ×
                  </button>
                </div>

                <div className="ks-oc-act-body">
                  <AutoGrowTextarea
                    className="ks-oc-summary"
                    minRows={3}
                    value={act.summary ?? ''}
                    onChange={(next) => upsert({ ...act, summary: next })}
                    placeholder="本幕概要：发生什么、推到哪里、留下什么钩子"
                  />

                  <div className="ks-oc-beats">
                    {beats.map((beat) => (
                      <BeatCard
                        key={beat.id}
                        node={beat}
                        onSave={upsert}
                        onRemove={() => remove(beat.id)}
                      />
                    ))}
                    <button
                      type="button"
                      className="ks-oc-add-beat"
                      onClick={() => handleAddBeat(act.id)}
                      title="添加子节点 (Beat)"
                    >
                      + Beat
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="ks-fs-panel-hint ks-mono ks-faint">
        ▸ 改完大纲想重拉详细剧本？右侧 chat 输 <code>/expand</code> 按新大纲扩写
      </div>
    </div>
  )
}

function BeatCard({
  node,
  onSave,
  onRemove,
}: {
  node: OutlineNode
  onSave: (n: OutlineNode) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-oc-beat">
      <div className="ks-oc-beat-head">
        <span className="ks-oc-beat-bullet" aria-hidden>
          ◇
        </span>
        <input
          type="text"
          className="ks-oc-beat-title"
          value={node.title}
          onChange={(e) => onSave({ ...node, title: e.target.value })}
          placeholder="Beat 标题"
        />
        <button
          type="button"
          className="ks-oc-beat-del"
          onClick={onRemove}
          title="删除该 Beat"
        >
          ×
        </button>
      </div>
      <AutoGrowTextarea
        className="ks-oc-beat-summary"
        minRows={2}
        value={node.summary ?? ''}
        onChange={(next) => onSave({ ...node, summary: next })}
        placeholder="具体场景 / 关键节奏点"
      />
    </div>
  )
}

const css = `
.ks-oc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(288px, 1fr));
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-content: start;
  padding-right: 4px;
}
/* 幕 = 一张卡牌 */
.ks-oc-act {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-solid);
  overflow: hidden;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast), transform var(--ks-dur-fast);
}
.ks-oc-act:hover {
  border-color: rgba(255, 123, 61, 0.35);
  box-shadow: var(--ks-shadow-soft);
  transform: translateY(-2px);
}
.ks-oc-act:focus-within {
  border-color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
}
/* 顶部序号徽章条 */
.ks-oc-act-band {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  background: var(--ks-surface-warm);
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-oc-badge {
  font-family: var(--ks-font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--ks-amber);
  background: rgba(255, 123, 61, 0.12);
  border: 1px solid rgba(255, 123, 61, 0.3);
  border-radius: var(--ks-radius-sm);
  padding: 2px 8px;
  letter-spacing: 0.06em;
}
.ks-oc-title {
  font-family: var(--ks-font-cn);
  font-size: 14px;
  font-weight: 600;
  color: var(--ks-text);
  border: 1px solid transparent;
  background: transparent;
  padding: 3px 6px;
  border-radius: var(--ks-radius-sm);
  min-width: 0;
}
.ks-oc-title:hover { background: var(--ks-amber-soft); }
.ks-oc-title:focus { outline: none; border-color: var(--ks-amber); background: var(--ks-surface); }
.ks-oc-del {
  all: unset;
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  color: var(--ks-text-faint);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-oc-del:hover { background: rgba(240, 119, 157, 0.15); color: var(--ks-rose); }
.ks-oc-act-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 12px 12px;
  flex: 1;
  min-height: 0;
}
.ks-oc-summary {
  width: 100%;
  font-family: var(--ks-font-cn);
  font-size: 12px;
  line-height: 1.65;
  padding: 8px 10px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface);
  color: var(--ks-text-soft);
  resize: none;
  overflow: hidden;
  min-height: 64px;
  box-sizing: border-box;
}
.ks-oc-summary:focus { outline: none; border-color: var(--ks-amber); color: var(--ks-text); }
/* Beat mini 卡 */
.ks-oc-beats {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ks-oc-beat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 9px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  transition: border-color var(--ks-dur-fast);
}
.ks-oc-beat:focus-within { border-color: var(--ks-amber); }
.ks-oc-beat-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ks-oc-beat-bullet {
  font-family: var(--ks-font-mono);
  font-size: 11px;
  color: var(--ks-amber);
  width: 14px;
  text-align: center;
  user-select: none;
  flex-shrink: 0;
}
.ks-oc-beat-title {
  flex: 1;
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ks-text);
  border: 1px solid transparent;
  background: transparent;
  padding: 2px 5px;
  border-radius: var(--ks-radius-sm);
  min-width: 0;
}
.ks-oc-beat-title:hover { background: var(--ks-amber-soft); }
.ks-oc-beat-title:focus { outline: none; border-color: var(--ks-amber); background: var(--ks-surface); }
.ks-oc-beat-del {
  all: unset;
  cursor: pointer;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  color: var(--ks-text-faint);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-oc-beat-del:hover { background: rgba(240, 119, 157, 0.15); color: var(--ks-rose); }
.ks-oc-beat-summary {
  width: 100%;
  font-family: var(--ks-font-cn);
  font-size: 11.5px;
  line-height: 1.6;
  padding: 6px 8px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface);
  color: var(--ks-text-soft);
  resize: none;
  overflow: hidden;
  min-height: 40px;
  box-sizing: border-box;
}
.ks-oc-beat-summary:focus { outline: none; border-color: var(--ks-amber); color: var(--ks-text); }
.ks-oc-add-beat {
  all: unset;
  cursor: pointer;
  text-align: center;
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  padding: 6px;
  color: var(--ks-cyan);
  border: 1px dashed rgba(108, 143, 184, 0.4);
  border-radius: var(--ks-radius-sm);
  transition: background var(--ks-dur-fast), border-color var(--ks-dur-fast);
}
.ks-oc-add-beat:hover {
  background: rgba(108, 143, 184, 0.1);
  border-color: var(--ks-cyan);
}
`
injectStyleOnce('forge-studio-outline', css)
