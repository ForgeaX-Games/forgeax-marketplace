import { useScenarioStore } from '../../scenario/scenarioStore'
import { useShellStore } from '../../shell/shellStore'
import type { Scenario, Scene, DialogueLine } from '../../scenario/types'
import { CopyButton } from '../../ui/CopyButton'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useMemo } from 'react'

/**
 * DetailScriptPanel —— 详细剧本（小说家工作板 · 第 5 段）。
 *
 * 形态：把当前选中剧集的所有 scene 按 root 起 BFS 拼成一份"线性剧本"，
 *      场景标题 + 背景速记 + 对话行 + 分支提示，全文展示，可整体复制。
 *
 * 数据源：实时从 `scenario.scenes` + `episodes` 拼，不存独立字段。
 *
 * 编辑能力：
 *   - 顶层：场景标题 / 背景速记 inline 编辑（updateScene）
 *   - 对话：addDialogue / updateDialogue / removeDialogue
 *   - 想改分支 / QTE / 分镜？切到「剧情树」tab 双击节点 —— 那里有完整的
 *     SceneDetailDrawer，这里只做"线性预览 + 文本编辑"
 *
 * 设计动因：
 *   - 作者反馈"详细剧本" —— 想要"小说连续展开"那种阅读视图
 *   - 与剧情树（图视图）互补：树看结构，剧本看内容
 *   - 文本编辑足以覆盖 80% 改剧本场景；复杂操作走 SceneDetailDrawer
 */
export function DetailScriptPanel() {
  const scenario = useScenarioStore((s) => s.scenario)
  const updateScene = useScenarioStore((s) => s.updateScene)
  const addDialogue = useScenarioStore((s) => s.addDialogue)
  const updateDialogue = useScenarioStore((s) => s.updateDialogue)
  const removeDialogue = useScenarioStore((s) => s.removeDialogue)
  const activeEpisodeId = useShellStore((s) => s.activeEpisodeId)

  const orderedScenes = useMemo(
    () => orderScenesForEpisode(scenario, activeEpisodeId),
    [scenario, activeEpisodeId],
  )

  const scriptText = useMemo(
    () => composeFullScriptText(scenario, orderedScenes),
    [scenario, orderedScenes],
  )

  return (
    <div className="ks-fs-panel ks-fs-detail">
      <div className="ks-fs-panel-head">
        <span className="ks-mono ks-faint">详细剧本 · DETAIL SCRIPT</span>
        <div className="ks-fs-panel-head-right">
          <span className="ks-fs-panel-count ks-mono ks-faint">
            {orderedScenes.length} 场
          </span>
          <CopyButton value={scriptText} />
        </div>
      </div>

      {orderedScenes.length === 0 ? (
        <div className="ks-fs-empty">
          <div className="ks-fs-empty-title">本集还没有场景</div>
          <div className="ks-fs-empty-body">
            在右侧 chat 写下你的故事 → AI 会锻造完整剧本树（场景 / 对话 / 分支），
            自动展示在这里。
            <br />
            想从大纲扩写？输入 <code>/expand</code>。
          </div>
        </div>
      ) : (
        <div className="ks-fs-scene-stream">
          {orderedScenes.map((scene, idx) => (
            <SceneBlock
              key={scene.id}
              scene={scene}
              index={idx}
              onUpdateScene={updateScene}
              onAddDialogue={addDialogue}
              onUpdateDialogue={updateDialogue}
              onRemoveDialogue={removeDialogue}
            />
          ))}
        </div>
      )}

      <div className="ks-fs-panel-hint ks-mono ks-faint">
        ▸ 想改分支 / QTE / 分镜？「剧情树」tab 双击节点 · 这里只做线性文本编辑
      </div>
    </div>
  )
}

function SceneBlock({
  scene,
  index,
  onUpdateScene,
  onAddDialogue,
  onUpdateDialogue,
  onRemoveDialogue,
}: {
  scene: Scene
  index: number
  onUpdateScene: (id: string, patch: Partial<Scene>) => void
  onAddDialogue: (sceneId: string, line: DialogueLine) => void
  onUpdateDialogue: (sceneId: string, lineId: string, patch: Partial<DialogueLine>) => void
  onRemoveDialogue: (sceneId: string, lineId: string) => void
}) {
  function makeDialogueId(): string {
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  return (
    <article className="ks-fs-scene-block">
      <header className="ks-fs-scene-block-head">
        <span className="ks-fs-scene-block-idx ks-mono">
          {String(index + 1).padStart(2, '0')}
        </span>
        <input
          type="text"
          className="ks-fs-scene-block-title"
          value={scene.title}
          onChange={(e) => onUpdateScene(scene.id, { title: e.target.value })}
          placeholder="场景标题"
        />
      </header>

      {/* 背景速记 */}
      <textarea
        className="ks-fs-scene-block-bg"
        rows={2}
        value={scene.background ?? ''}
        onChange={(e) => onUpdateScene(scene.id, { background: e.target.value })}
        placeholder="背景速记（舞美 / 氛围 / 镜头大致走向 —— 不会被念出来）"
      />

      {/* 对话行 */}
      <div className="ks-fs-scene-block-dialogues">
        {scene.dialogue.map((line) => (
          <div key={line.id} className="ks-fs-dialogue-line">
            <input
              type="text"
              className="ks-fs-dialogue-speaker"
              value={line.speaker ?? ''}
              placeholder="角色 / 旁白"
              onChange={(e) =>
                onUpdateDialogue(scene.id, line.id, { speaker: e.target.value })
              }
            />
            <textarea
              className="ks-fs-dialogue-text"
              rows={1}
              value={line.text}
              placeholder="台词内容"
              onChange={(e) =>
                onUpdateDialogue(scene.id, line.id, { text: e.target.value })
              }
            />
            <button
              type="button"
              className="ks-fs-row-del"
              onClick={() => onRemoveDialogue(scene.id, line.id)}
              title="删除该行"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ks-fs-add-dialogue"
          onClick={() =>
            onAddDialogue(scene.id, {
              id: makeDialogueId(),
              role: 'character',
              speaker: '',
              text: '',
              // 落到当前已有台词最后 +1s 处；空场景则 0
              startMs:
                scene.dialogue.reduce(
                  (max, d) => Math.max(max, (d.startMs ?? 0) + (d.endMs ?? d.startMs ?? 0)),
                  0,
                ) + 1000,
            })
          }
        >
          + 加一行台词
        </button>
      </div>

      {/* 分支提示 */}
      {scene.branches.length > 0 && (
        <div className="ks-fs-scene-block-branches">
          <span className="ks-mono ks-faint">分支 →</span>
          {scene.branches.map((b) => (
            <span key={b.id} className="ks-fs-branch-pip">
              {b.label || b.kind} → {b.targetSceneId}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * 拼出当前剧集的"线性"场景顺序：
 *   - 仅包含 scene.episodeId === episodeId 的（episodeId=null 表示无过滤兜底用 root 起 BFS）
 *   - 起点：episode.rootSceneId（找不到则 fallback 到 scenario.rootSceneId）
 *   - 顺序：BFS（与 ScenesList orderScenes 同思路）
 *   - 兜底：BFS 完后还有未访问的 scene（孤儿/跨集），按 id 升序 append
 */
function orderScenesForEpisode(scenario: Scenario, episodeId: string | null): Scene[] {
  const allScenes = scenario.scenes
  const candidate: Record<string, Scene> = {}
  for (const [id, s] of Object.entries(allScenes)) {
    if (!episodeId) {
      candidate[id] = s
      continue
    }
    if (s.episodeId === episodeId || s.episodeId === undefined) {
      candidate[id] = s
    }
  }

  const ep = scenario.episodes?.find((e) => e.id === episodeId)
  const startId = ep?.rootSceneId && candidate[ep.rootSceneId] ? ep.rootSceneId : scenario.rootSceneId

  const visited = new Set<string>()
  const out: Scene[] = []
  const queue: string[] = [startId]
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const sc = candidate[id]
    if (!sc) continue
    out.push(sc)
    for (const b of sc.branches) {
      if (!visited.has(b.targetSceneId) && candidate[b.targetSceneId]) {
        queue.push(b.targetSceneId)
      }
    }
  }
  // 兜底：未访问的孤儿场景
  for (const sc of Object.values(candidate)) {
    if (!visited.has(sc.id)) out.push(sc)
  }
  return out
}

/** 把 ordered scenes 拼成一份纯文本剧本（CopyButton 用） */
function composeFullScriptText(scenario: Scenario, scenes: Scene[]): string {
  const lines: string[] = []
  if (scenario.title) lines.push(`# ${scenario.title}`, '')
  if (scenario.synopsis) lines.push(`> ${scenario.synopsis}`, '')
  scenes.forEach((sc, i) => {
    lines.push(`## ${String(i + 1).padStart(2, '0')} · ${sc.title}`)
    if (sc.background) lines.push(`*${sc.background}*`, '')
    for (const d of sc.dialogue) {
      lines.push(`- **${d.speaker || '旁白'}**: ${d.text}`)
    }
    if (sc.branches.length > 0) {
      lines.push('')
      for (const b of sc.branches) {
        lines.push(`  → [${b.label || b.kind}] → ${b.targetSceneId}`)
      }
    }
    lines.push('')
  })
  return lines.join('\n')
}

const css = `
.ks-fs-scene-stream {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 4px;
}
.ks-fs-scene-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
  transition: border-color var(--ks-dur-fast);
}
.ks-fs-scene-block:hover { border-color: rgba(255, 123, 61, 0.25); }
.ks-fs-scene-block:focus-within {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px rgba(255, 123, 61, 0.1);
}
.ks-fs-scene-block-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ks-fs-scene-block-idx {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--ks-amber);
  font-weight: 600;
}
.ks-fs-scene-block-title {
  flex: 1;
  font-family: var(--ks-font-cn);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ks-text);
  border: 1px solid transparent;
  background: transparent;
  padding: 4px 8px;
  border-radius: var(--ks-radius-sm);
  min-width: 0;
}
.ks-fs-scene-block-title:hover { background: rgba(255, 123, 61, 0.05); }
.ks-fs-scene-block-title:focus { outline: none; border-color: var(--ks-amber); background: var(--ks-surface); }
.ks-fs-scene-block-bg {
  width: 100%;
  font-family: var(--ks-font-cn);
  font-size: 12px;
  line-height: 1.6;
  font-style: italic;
  padding: 8px 12px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface-warm);
  color: var(--ks-text-soft);
  resize: vertical;
  min-height: 38px;
}
.ks-fs-scene-block-bg:focus {
  outline: none;
  border-color: var(--ks-amber);
}
.ks-fs-scene-block-dialogues {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ks-fs-dialogue-line {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 8px;
  align-items: start;
}
.ks-fs-dialogue-speaker,
.ks-fs-dialogue-text {
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  padding: 6px 10px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface);
  color: var(--ks-text);
}
.ks-fs-dialogue-speaker {
  font-weight: 500;
  color: var(--ks-amber);
}
.ks-fs-dialogue-text {
  line-height: 1.7;
  resize: vertical;
  min-height: 32px;
}
.ks-fs-dialogue-speaker:focus,
.ks-fs-dialogue-text:focus {
  outline: none;
  border-color: var(--ks-amber);
}
.ks-fs-add-dialogue {
  all: unset;
  cursor: pointer;
  align-self: flex-start;
  font-family: var(--ks-font-ui);
  font-size: 10.5px;
  font-weight: 500;
  padding: 4px 12px;
  margin-top: 2px;
  background: rgba(255, 123, 61, 0.06);
  border: 1px dashed rgba(255, 123, 61, 0.35);
  color: var(--ks-amber);
  border-radius: var(--ks-radius-pill);
  transition: background var(--ks-dur-fast);
}
.ks-fs-add-dialogue:hover { background: rgba(255, 123, 61, 0.16); }
.ks-fs-scene-block-branches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--ks-border-soft);
  font-size: 11px;
  color: var(--ks-text-soft);
}
.ks-fs-scene-block-branches .ks-mono {
  font-size: 10px;
  letter-spacing: 0.16em;
}
.ks-fs-branch-pip {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 8px;
  border: 1px solid rgba(108, 143, 184, 0.35);
  color: var(--ks-cyan);
  background: rgba(108, 143, 184, 0.06);
}
`
injectStyleOnce('forge-studio-detail', css)
