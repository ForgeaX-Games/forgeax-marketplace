import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import type { Character } from '../../scenario/types'
import { CopyButton } from '../../ui/CopyButton'
import { injectStyleOnce } from '../../styles/injectStyle'

const EMPTY_CHARS: Record<string, Character> = {}

/**
 * CharactersTextPanel —— 角色设定（小说家工作板 · 第 3 段，纯文本版）。
 *
 * 与 `editor/CharactersPanel.tsx`（视觉 tab 用）的关系：
 *   - 这里**只**做"角色卡 / 文字描述"：名字、外观气质提示词、增删改名
 *   - 生立绘 / 拖参考图 / 三视图 全部留在 `editor/CharactersPanel.tsx`（「视觉」tab）
 *   - 数据共享同一份 `scenario.characters`，两边编辑实时联动
 *
 * 展示形态（2026-06 作者反馈："要卡牌形式，不是表单行"）：
 *   - **卡牌网格**：每个角色 = 一张竖版收藏卡，上半为立绘大图区（有 refImage 显图、
 *     否则首字大头像 + 中性渐变），名字压在图底（带 scrim），下半为完整外观描述。
 *   - 网格平铺自适应列数；纯用主站主题 token，不引入自创配色。
 *   - 立绘只读展示（数据来自视觉 tab 共享的 refImageId）；本面板不含生成/拖图。
 */
export function CharactersTextPanel() {
  const characters = useScenarioStore((s) => s.scenario.characters ?? EMPTY_CHARS)
  const upsert = useScenarioStore((s) => s.upsertCharacter)
  const remove = useScenarioStore((s) => s.removeCharacter)
  const list = Object.values(characters)

  function makeId(): string {
    return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  function handleAdd(): void {
    upsert({
      id: makeId(),
      name: '新角色',
      prompt: '外观、年龄、穿着、气质……',
    })
  }

  return (
    <div className="ks-fs-panel ks-fs-chars">
      <div className="ks-fs-panel-head">
        <span className="ks-mono ks-faint">角色设定 · CHARACTERS</span>
        <button type="button" className="ks-fs-add-btn" onClick={handleAdd}>
          + 添加角色
        </button>
      </div>

      {list.length === 0 ? (
        <div className="ks-fs-empty">
          <div className="ks-fs-empty-title">还没有角色</div>
          <div className="ks-fs-empty-body">
            点右上角「+ 添加角色」手动加，或在右侧 chat 描述故事 → AI 锻造时会自动抽取角色。
          </div>
        </div>
      ) : (
        <div className="ks-fc-grid">
          {list.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              onSave={upsert}
              onRemove={() => remove(c.id)}
            />
          ))}
        </div>
      )}

      <div className="ks-fs-panel-hint ks-mono ks-faint">
        ▸ 想生立绘 / 拖参考图？切到「视觉」tab，那里有完整的角色三视图工具
      </div>
    </div>
  )
}

function CharacterCard({
  character,
  onSave,
  onRemove,
}: {
  character: Character
  onSave: (c: Character) => void
  onRemove: () => void
}) {
  const refMedia = useMediaStore((s) =>
    character.refImageId ? s.entries[character.refImageId] : undefined,
  )
  const hasImg = refMedia && refMedia.mimeType.startsWith('image/')

  return (
    <div className="ks-fc">
      <div className="ks-fc-portrait">
        {hasImg ? (
          <img src={refMedia!.url} alt={character.name} draggable={false} />
        ) : (
          <span className="ks-fc-portrait-initial">{character.name.slice(0, 1) || '?'}</span>
        )}
        <div className="ks-fc-portrait-scrim" aria-hidden />
        <button
          type="button"
          className="ks-fc-del"
          onClick={onRemove}
          title="删除该角色"
        >
          ×
        </button>
        <div className="ks-fc-namebar">
          <input
            type="text"
            className="ks-fc-name"
            value={character.name}
            onChange={(e) => onSave({ ...character, name: e.target.value })}
            placeholder="角色名"
          />
          <span className="ks-fc-id">{character.id.slice(-6)}</span>
        </div>
      </div>

      <div className="ks-fc-body">
        <div className="ks-fc-prompt-head">
          <span>外观设定</span>
          <CopyButton value={character.prompt} />
        </div>
        <textarea
          className="ks-fc-prompt"
          value={character.prompt}
          onChange={(e) => onSave({ ...character, prompt: e.target.value })}
          placeholder="外观气质 · 例：约 28 岁中国男性，黑色长款风衣，发尾被雨打湿…"
        />
      </div>
    </div>
  )
}

const css = `
.ks-fc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 14px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-content: start;
  padding-right: 4px;
}
.ks-fc {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-solid);
  overflow: hidden;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast), transform var(--ks-dur-fast);
}
.ks-fc:hover {
  border-color: rgba(255, 123, 61, 0.35);
  box-shadow: var(--ks-shadow-soft);
  transform: translateY(-2px);
}
.ks-fc:focus-within {
  border-color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
}
/* 立绘大图区 */
.ks-fc-portrait {
  position: relative;
  aspect-ratio: 4 / 3;
  background:
    radial-gradient(circle at 50% 38%, var(--ks-surface-warm) 0%, var(--ks-panel-elev) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex: 0 0 auto;
}
.ks-fc-portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ks-fc-portrait-initial {
  font-family: var(--ks-font-cn);
  font-size: 52px;
  font-weight: 700;
  color: var(--ks-text-faint);
  user-select: none;
}
.ks-fc-portrait-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.7) 100%);
  pointer-events: none;
}
.ks-fc-namebar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 10px 9px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ks-fc-name {
  font-family: var(--ks-font-cn);
  font-size: 14.5px;
  font-weight: 600;
  color: #fff;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ks-radius-sm);
  padding: 1px 5px;
  min-width: 0;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.ks-fc-name:hover { background: rgba(255, 255, 255, 0.14); }
.ks-fc-name:focus {
  outline: none;
  background: rgba(0, 0, 0, 0.45);
  border-color: var(--ks-amber);
  text-shadow: none;
}
.ks-fc-id {
  font-family: var(--ks-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.62);
  padding-left: 6px;
}
.ks-fc-del {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(20, 16, 14, 0.5);
  color: rgba(255, 255, 255, 0.85);
  font-size: 15px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-fc-del:hover {
  background: rgba(240, 119, 157, 0.85);
  color: #fff;
}
/* 描述区 */
.ks-fc-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px 12px;
  flex: 1;
  min-height: 0;
}
.ks-fc-prompt-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-fc-prompt {
  width: 100%;
  flex: 1;
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  line-height: 1.7;
  padding: 9px 11px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface);
  color: var(--ks-text);
  resize: vertical;
  min-height: 120px;
}
.ks-fc-prompt:focus { outline: none; border-color: var(--ks-amber); }
`
injectStyleOnce('forge-studio-chars', css)
