import { useScenarioStore } from '../scenario/scenarioStore'
import type { Scene } from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 左栏 · 场景（关卡）列表 —— 拖到中央舞台 = 选中并预览。
 *
 * - 点击：选中
 * - 拖拽：通过 dataTransfer 传 sceneId，StagePane 监听 drop 切换预览
 * - 右键（双击）：标记为根场景（playerd 默认入口）
 */
export function ScenesList() {
  const scenes = useScenarioStore((s) => s.scenario.scenes)
  const rootSceneId = useScenarioStore((s) => s.scenario.rootSceneId)
  const selectedId = useScenarioStore((s) => s.selectedSceneId)
  const select = useScenarioStore((s) => s.selectScene)

  const ordered = orderScenes(scenes, rootSceneId)

  return (
    <div className="ks-scenes-list">
      {ordered.map((scene) => (
        <SceneRow
          key={scene.id}
          scene={scene}
          isRoot={scene.id === rootSceneId}
          isActive={scene.id === selectedId}
          onSelect={() => select(scene.id)}
        />
      ))}

      <div className="ks-scenes-hint ks-mono">
        ▸ 拖入舞台预览 · 点击 = 选中
      </div>

    </div>
  )
}

interface RowProps {
  scene: Scene
  isRoot: boolean
  isActive: boolean
  onSelect: () => void
}

function SceneRow({ scene, isRoot, isActive, onSelect }: RowProps) {
  const qteCount = scene.qte?.cues.length ?? 0
  const branchCount = scene.branches.length

  return (
    <div
      className={`ks-row ks-scene-row ${isActive ? 'ks-row-active' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-reel-scene-id', scene.id)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onClick={onSelect}
    >
      <div className="ks-scene-marker" data-root={isRoot ? 'true' : 'false'} />
      <div className="ks-scene-meta">
        <div className="ks-scene-title">{scene.title}</div>
        <div className="ks-scene-sub ks-mono">
          {(scene.durationMs / 1000).toFixed(1)}s
          {qteCount > 0 && <span className="ks-pip ks-pip-cyan">QTE×{qteCount}</span>}
          {branchCount > 0 && (
            <span className="ks-pip ks-pip-amber">↗{branchCount}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function orderScenes(
  scenes: Record<string, Scene>,
  rootId: string,
): Scene[] {
  const visited = new Set<string>()
  const out: Scene[] = []
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const scene = scenes[id]
    if (!scene) continue
    out.push(scene)
    for (const b of scene.branches) {
      if (!visited.has(b.targetSceneId)) queue.push(b.targetSceneId)
    }
  }
  for (const s of Object.values(scenes)) {
    if (!visited.has(s.id)) out.push(s)
  }
  return out
}

const listCss = `
.ks-scenes-list {
  display: flex; flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}
.ks-scene-row {
  align-items: stretch;
  padding: 8px 10px;
}
.ks-scene-marker {
  width: 4px;
  align-self: stretch;
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.5), rgba(232, 162, 58, 0.4));
  border-radius: 2px;
  flex-shrink: 0;
}
.ks-scene-marker[data-root="true"] {
  background: linear-gradient(180deg, var(--ks-amber), var(--ks-amber-glow));
  box-shadow: 0 0 6px rgba(232, 162, 58, 0.45);
}
.ks-scene-meta {
  display: flex; flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ks-scene-title {
  font-size: 13px;
  color: var(--ks-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-scene-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ks-text-dim);
  display: flex; gap: 6px;
}
.ks-pip {
  padding: 1px 5px;
  border-radius: 8px;
  font-size: 8.5px;
  letter-spacing: 0.12em;
  border: 1px solid currentColor;
}
.ks-pip-cyan { color: var(--ks-cyan); }
.ks-pip-amber { color: var(--ks-amber); }

.ks-scenes-hint {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--ks-text-faint);
  padding-top: 6px;
}
`
injectStyleOnce('scenes-list', listCss)
