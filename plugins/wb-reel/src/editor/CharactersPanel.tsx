import { useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { createImageProvider } from '../llm'
import { composeVisualPrompt } from '../llm/visualStylePresets'
import type { Character } from '../scenario/types'
import { CopyButton } from '../ui/CopyButton'
import { MediaDropzone } from '../ui/MediaDropzone'
import { injectStyleOnce } from '../styles/injectStyle'

const EMPTY_CHARS: Record<string, Character> = {}

/**
 * 角色库 · CHARACTERS
 *
 * 一致性可控的核心：每个角色有
 *   - prompt: 外观气质提示词（可独立喂 GPT-Image-2 出立绘）
 *   - refImageId: 在 mediaStore 里的参考图（首次生立绘 / 拖入参考 / 复用）
 *
 * 后续场景生图时，PromptTabs 会自动把"出场角色"的 prompt 拼到主 prompt 前面，
 * 保证不同场景里同一个人物气质一致。
 */
export function CharactersPanel() {
  const characters = useScenarioStore((s) => s.scenario.characters ?? EMPTY_CHARS)
  const upsert = useScenarioStore((s) => s.upsertCharacter)
  const remove = useScenarioStore((s) => s.removeCharacter)
  const list = Object.values(characters)

  function makeId(): string {
    return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  return (
    <div className="ks-cp">
      {list.length === 0 && (
        <div className="ks-cp-empty ks-mono ks-faint">
          ◇ 还没有角色 · 添加后可在场景里勾选作为一致性锚点
        </div>
      )}

      <div className="ks-cp-list">
        {list.map((c) => (
          <CharacterRow
            key={c.id}
            character={c}
            onSave={upsert}
            onRemove={() => remove(c.id)}
          />
        ))}
      </div>

      <button
        type="button"
        className="ks-cp-add"
        onClick={() =>
          upsert({
            id: makeId(),
            name: '新角色',
            prompt: '外观、年龄、穿着、气质……',
          })
        }
      >
        + 添加角色
      </button>

    </div>
  )
}

function CharacterRow({
  character,
  onSave,
  onRemove,
}: {
  character: Character
  onSave: (c: Character) => void
  onRemove: () => void
}) {
  const ingestMedia = useMediaStore((s) => s.ingest)
  const refMedia = useMediaStore((s) =>
    character.refImageId ? s.entries[character.refImageId] : undefined,
  )
  const [open, setOpen] = useState(false)
  const [genStatus, setGenStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const imgClient = useMemo(() => createImageProvider(), [])

  async function generatePortrait(): Promise<void> {
    if (!character.prompt.trim()) return
    setGenStatus({ kind: 'pending' })
    try {
      // 角色立绘也吃全局美术风格 —— 否则 anime 剧本会出现一张写实立绘，撕裂世界观
      const style = useScenarioStore.getState().scenario.visualStyle
      const out = await imgClient.generate({
        prompt: composeVisualPrompt(
          `角色立绘 · 单人居中 · 中性背景 · ${character.prompt}`,
          style,
        ),
        size: '1024x1024',
      })
      // 把 dataUrl 落成 file → mediaStore
      const blob = await dataUrlToBlob(out.dataUrl)
      const file = new File([blob], `${character.id}.png`, { type: blob.type })
      const id = ingestMedia(file)
      onSave({ ...character, refImageId: id })
      setGenStatus({ kind: 'idle' })
    } catch (e) {
      setGenStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  return (
    <div className={`ks-cp-row ${open ? 'is-open' : ''}`}>
      <div className="ks-cp-row-head" onClick={() => setOpen((o) => !o)}>
        <div className="ks-cp-thumb">
          {refMedia ? (
            refMedia.mimeType.startsWith('image/') ? (
              <img src={refMedia.url} alt={character.name} draggable={false} />
            ) : (
              <span className="ks-cp-thumb-placeholder">img</span>
            )
          ) : (
            <span className="ks-cp-thumb-placeholder">{character.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="ks-cp-row-title">
          <span className="ks-cn">{character.name}</span>
          <span className="ks-mono ks-faint">{character.id.slice(-6)}</span>
        </div>
        <span className="ks-cp-arrow">{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div className="ks-cp-row-body">
          <input
            type="text"
            value={character.name}
            onChange={(e) => onSave({ ...character, name: e.target.value })}
            placeholder="角色名"
          />
          <div className="ks-cp-row-prompt-head">
            <span className="ks-mono ks-faint">外观提示词</span>
            <CopyButton value={character.prompt} />
          </div>
          <textarea
            rows={3}
            value={character.prompt}
            onChange={(e) => onSave({ ...character, prompt: e.target.value })}
            placeholder="例：约 28 岁中国男性，黑色长款风衣，发尾被雨打湿……"
          />

          <div className="ks-cp-row-actions">
            <button
              type="button"
              onClick={generatePortrait}
              disabled={genStatus.kind === 'pending' || !character.prompt.trim()}
              className="ks-cp-gen"
            >
              {genStatus.kind === 'pending' ? '生成中…' : '↻ 生成立绘 (GPT-Image-2)'}
            </button>
            <button type="button" onClick={onRemove} className="ks-cp-del">
              删除
            </button>
          </div>
          {genStatus.kind === 'error' && (
            <div className="ks-cp-err ks-mono">{genStatus.message}</div>
          )}

          <div className="ks-cp-ref-head ks-mono ks-faint">
            或拖入参考图（同样会绑定为 refImage）
          </div>
          <MediaDropzone
            accept="image"
            compact
            hint="拖入立绘 / 风格参考"
            onFile={({ file }) => {
              const id = ingestMedia(file)
              onSave({ ...character, refImageId: id })
            }}
          />
        </div>
      )}
    </div>
  )
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl)
  return resp.blob()
}

const cpCss = `
.ks-cp {
  display: flex; flex-direction: column;
  gap: 8px;
}
.ks-cp-empty {
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--ks-text-dim);
}
.ks-cp-list { display: flex; flex-direction: column; gap: 8px; }
.ks-cp-row {
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
  overflow: hidden;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast);
}
.ks-cp-row.is-open {
  border-color: rgba(255, 123, 61, 0.35);
  box-shadow: var(--ks-shadow-soft);
}

.ks-cp-row-head {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--ks-dur-fast);
}
.ks-cp-row-head:hover { background: var(--ks-amber-soft); }
.ks-cp-thumb {
  width: 44px; height: 44px;
  border-radius: var(--ks-radius-sm);
  overflow: hidden;
  background: var(--ks-surface-warm);
  border: 1px solid var(--ks-border-soft);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ks-cp-thumb img {
  width: 100%; height: 100%; object-fit: cover;
}
.ks-cp-thumb-placeholder {
  font-family: var(--ks-font-mono);
  font-size: 16px;
  color: var(--ks-text-faint);
}
.ks-cp-row-title {
  display: flex; flex-direction: column; min-width: 0;
}
.ks-cp-row-title > .ks-cn { font-size: 13.5px; font-weight: 500; color: var(--ks-text); }
.ks-cp-row-title > .ks-mono { font-family: var(--ks-font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--ks-text-dim); }
.ks-cp-arrow { color: var(--ks-text-soft); font-size: 12px; }

.ks-cp-row-body {
  padding: 12px;
  display: flex; flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-elev);
}
.ks-cp-row-body input,
.ks-cp-row-body textarea {
  width: 100%;
  font-size: 12.5px;
}
.ks-cp-row-body textarea { font-family: var(--ks-font-cn); line-height: 1.7; }
.ks-cp-row-prompt-head {
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-cp-row-actions {
  display: flex; gap: 6px;
}
.ks-cp-gen {
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 5px 12px;
  background: rgba(108, 143, 184, 0.08);
  border-color: rgba(108, 143, 184, 0.35);
  color: var(--ks-cyan);
  border-radius: var(--ks-radius-pill);
}
.ks-cp-gen:hover:not(:disabled) {
  background: rgba(108, 143, 184, 0.18);
  border-color: var(--ks-cyan);
  box-shadow: var(--ks-shadow-soft);
}
.ks-cp-del {
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 5px 12px;
  background: rgba(240, 119, 157, 0.08);
  border-color: rgba(240, 119, 157, 0.35);
  color: var(--ks-rose);
  border-radius: var(--ks-radius-pill);
}
.ks-cp-err {
  font-size: 11px;
  color: #b1335a;
  word-break: break-all;
}
.ks-cp-ref-head { font-family: var(--ks-font-mono); font-size: 10px; letter-spacing: 0.18em; color: var(--ks-text-dim); text-transform: uppercase; font-weight: 600; }

.ks-cp-add {
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
`
injectStyleOnce('characters-panel', cpCss)
