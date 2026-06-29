import { useRef, useState } from 'react'
import { createTextProvider } from '../../llm'
import { forgeScenarioFromScriptSegmented } from '../../llm/forgeScriptSegmented'
import type { ForgeProgress } from '../../llm/promptForge'
import { loadScriptFile, SCRIPT_ALLOWED_EXTENSIONS } from '../../io/loadScriptFile'
import { CHUNK_THRESHOLD_CHARS } from '../../io/chunkPlanner'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { inferAdoptMode } from '../../scenario/forgeIntent'
import { useShellStore } from '../../shell/shellStore'
import { broadcastScenarioAdopt } from '../../shell/crossPaneSync'
import { useToastStore } from '../../ui/toastStore'
import { distillOutline, distillRelations } from '../forgeDistillSkills'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * ScriptImportPanel —— 「导入完整剧本」模态面板
 *
 * 为什么存在：作者上传 / 粘贴整本剧本时，老路径是把全文塞进对话窗交给 Reia
 * agent，再由 agent 调 reel:forge-script。长剧本下 agent 那次 LLM 调用会因
 * 全文超长被网关重置（ECONNRESET），作者看到「对话解析不了」。
 *
 * 本面板**绕开 agent**：作者直接在影游模块里粘贴 / 上传，点「开始解析」就在
 * 本地直跑 forgeScenarioFromScriptSegmented（短剧本单次、长剧本自动分段逐读
 * 再合并），产出 Scenario 后 adopt 进 store，再蒸馏大纲 / 人物关系。整条链路
 * 不经过对话 agent，从根上消除那条长连接被重置的失败。
 */

interface StageLog {
  label: string
  detail?: string
}

const ACCEPT = SCRIPT_ALLOWED_EXTENSIONS.join(',')

function countChars(s: string): number {
  return Array.from(s.trim()).length
}

export function ScriptImportPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('')
  const [busy, setBusy] = useState(false)
  const [stages, setStages] = useState<StageLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  if (!open) return null

  const chars = countChars(text)
  const willSegment = chars > CHUNK_THRESHOLD_CHARS
  const canStart = chars > 0 && !busy

  async function ingestFile(file: File): Promise<void> {
    try {
      const res = await loadScriptFile(file)
      setText(res.content)
      setFilename(res.filename)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void ingestFile(file)
  }

  async function onStart(): Promise<void> {
    const script = text.trim()
    if (!script) return
    setBusy(true)
    setError(null)
    setStages([])
    const ctrl = new AbortController()
    ctrlRef.current = ctrl

    const onProgress = (ev: ForgeProgress): void => {
      // 只收里程碑事件，流式增量不入列表（避免刷屏）
      if (ev.kind === 'stage') {
        setStages((prev) => [...prev, { label: ev.label, detail: ev.detail }])
      }
    }

    try {
      const res = await forgeScenarioFromScriptSegmented(
        createTextProvider(),
        { script },
        { onProgress, signal: ctrl.signal },
      )
      useScenarioStore.getState().adoptForgedScenario(res.scenario, {
        mode: inferAdoptMode(useScenarioStore.getState().scenario),
      })
      // 让另一个 pane(如 sidebar)也切到这本新剧本
      broadcastScenarioAdopt(useScenarioStore.getState().scenario)

      // 蒸馏大纲 + 人物关系（best-effort，失败不影响主流程）
      setStages((prev) => [...prev, { label: '提取大纲与人物关系' }])
      const adopted = useScenarioStore.getState().scenario
      const llm2 = createTextProvider()
      const [outline, relations] = await Promise.all([
        distillOutline(llm2, adopted, '').catch(() => []),
        distillRelations(llm2, adopted, '').catch(() => []),
      ])
      if (outline.length > 0) useScenarioStore.getState().setOutline(outline)
      if (relations.length > 0)
        useScenarioStore.getState().setCharacterRelations(relations)

      const sceneCount = Object.keys(res.scenario.scenes).length
      const charCount = Object.keys(res.scenario.characters ?? {}).length
      useToastStore
        .getState()
        .fire(
          `已按剧本生成「${res.scenario.title}」· ${sceneCount} 场景 · ${charCount} 角色${
            res.warnings.length > 0 ? `（${res.warnings.length} 段有提示）` : ''
          }`,
          { kind: 'success', ttl: 5000 },
        )
      // 跳到剧情树看结果
      useShellStore.getState().setForgeView('tree')
      setBusy(false)
      setText('')
      setFilename('')
      onClose()
    } catch (e) {
      const msg = (e as Error).message
      const aborted =
        (e as Error).name === 'AbortError' || /aborted/i.test(msg)
      setError(aborted ? '已取消解析。' : msg)
      setBusy(false)
    } finally {
      ctrlRef.current = null
    }
  }

  function onCancel(): void {
    if (busy) {
      ctrlRef.current?.abort()
      return
    }
    onClose()
  }

  return (
    <div className="ks-sip-overlay" role="dialog" aria-modal="true">
      <div className="ks-sip">
        <header className="ks-sip-head">
          <div>
            <div className="ks-sip-title">导入完整剧本</div>
            <div className="ks-sip-sub ks-faint">
              粘贴或上传你写好的剧本，严格按原文逐字解析成剧情树（不经过对话，不改写原文）
            </div>
          </div>
          <button
            className="ks-sip-x"
            onClick={onCancel}
            aria-label="关闭"
            disabled={false}
          >
            {busy ? '中断' : '✕'}
          </button>
        </header>

        <div
          className={`ks-sip-body${dragOver ? ' is-drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <textarea
            className="ks-sip-text"
            value={text}
            placeholder={`在此粘贴剧本全文，或把 ${SCRIPT_ALLOWED_EXTENSIONS.join(' / ')} 文件拖进来…`}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            disabled={busy}
          />
          {dragOver && <div className="ks-sip-dropmask">松手即导入剧本文件</div>}
        </div>

        <div className="ks-sip-meta">
          <div className="ks-sip-count ks-mono">
            {filename && <span className="ks-sip-fn">{filename} · </span>}
            {chars.toLocaleString()} 字
            {willSegment && (
              <span className="ks-sip-seg">
                {' '}
                · 长剧本，将自动分段逐读后合并（避免超长被截断）
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void ingestFile(f)
              e.currentTarget.value = ''
            }}
          />
          <button
            className="ks-sip-upload"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            上传文件
          </button>
        </div>

        {stages.length > 0 && (
          <ul className="ks-sip-stages ks-mono">
            {stages.map((s, i) => (
              <li key={i} className={i === stages.length - 1 && busy ? 'is-active' : ''}>
                <span className="ks-sip-stage-label">{s.label}</span>
                {s.detail && <span className="ks-sip-stage-detail ks-faint"> · {s.detail}</span>}
              </li>
            ))}
          </ul>
        )}

        {error && <div className="ks-sip-error">{error}</div>}

        <footer className="ks-sip-foot">
          <button className="ks-sip-cancel" onClick={onCancel}>
            {busy ? '中断解析' : '取消'}
          </button>
          <button
            className="ks-sip-go"
            onClick={() => void onStart()}
            disabled={!canStart}
          >
            {busy ? '解析中…' : willSegment ? '分段解析剧本' : '开始解析剧本'}
          </button>
        </footer>
      </div>
    </div>
  )
}

const css = `
.ks-sip-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  padding: 24px;
}
.ks-sip {
  width: min(720px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--color-background-base);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  padding: 18px 20px;
  overflow: hidden;
}
.ks-sip-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ks-sip-title { font-size: 16px; font-weight: 600; }
.ks-sip-sub { font-size: 12px; margin-top: 3px; line-height: 1.5; }
.ks-sip-x {
  flex: 0 0 auto;
  border: 1px solid var(--color-border-default);
  background: var(--color-background-elevated);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.ks-sip-x:hover { color: var(--color-text-primary); }
.ks-sip-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 200px;
  display: flex;
}
.ks-sip-body.is-drag { outline: 2px dashed var(--color-accent, #6aa0ff); outline-offset: -4px; }
.ks-sip-text {
  flex: 1;
  width: 100%;
  resize: none;
  background: var(--color-background-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.ks-sip-dropmask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-size: 14px;
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-sm);
}
.ks-sip-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ks-sip-count { font-size: 12px; }
.ks-sip-seg { color: var(--color-accent, #6aa0ff); }
.ks-sip-fn { color: var(--color-text-secondary); }
.ks-sip-upload, .ks-sip-cancel, .ks-sip-go {
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
}
.ks-sip-upload, .ks-sip-cancel {
  background: var(--color-background-elevated);
  color: var(--color-text-secondary);
}
.ks-sip-upload:hover, .ks-sip-cancel:hover { color: var(--color-text-primary); }
.ks-sip-go {
  background: var(--color-accent, #3b6fd4);
  border-color: var(--color-accent, #3b6fd4);
  color: #fff;
  font-weight: 600;
}
.ks-sip-go:disabled { opacity: 0.45; cursor: not-allowed; }
.ks-sip-stages {
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
  background: var(--color-background-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.7;
}
.ks-sip-stages li.is-active .ks-sip-stage-label::before { content: '▸ '; }
.ks-sip-stage-detail { font-size: 11px; }
.ks-sip-error {
  font-size: 12px;
  color: var(--color-danger, #e5534b);
  background: rgba(229, 83, 75, 0.12);
  border: 1px solid rgba(229, 83, 75, 0.3);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  white-space: pre-wrap;
  max-height: 140px;
  overflow-y: auto;
}
.ks-sip-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
`
injectStyleOnce('script-import-panel', css)
