import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocumentType } from '../assets/registry-types'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  fetchProjectDocument,
  fetchProjectDocuments,
  selectProjectProposal,
  type ProjectDocument,
  type ProjectDocumentSelection,
  type ProjectDocumentSummary,
} from './document-client'
import { useDocumentNav } from '../persist/documentNavStore'

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  proposal: '策划案',
  outline: '大纲',
  script: '剧本',
}

const CSS = `
.gdx-root{height:100%;min-height:0;display:flex;flex-direction:column;background:#201d1a;color:#f6f1e9;font-family:'PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif}
.gdx-header{flex:none;padding:28px 36px 22px;border-bottom:1px solid rgba(255,255,255,.12);background:#2c2c2c}
.gdx-title{margin:0;font-size:24px;font-weight:600;letter-spacing:.02em}
.gdx-content{flex:1;min-height:0;overflow:auto;padding:28px 36px 56px}
.gdx-proposal-rail{display:flex;gap:14px;overflow-x:auto;padding:4px 3px 18px;margin:0 -3px 24px;scroll-snap-type:x proximity}
.gdx-proposal-card{position:relative;flex:0 0 min(290px,80vw);min-height:142px;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:linear-gradient(155deg,#353535,#292522);box-shadow:inset 0 1px rgba(255,255,255,.07),0 4px 0 rgba(0,0,0,.18),0 10px 22px rgba(0,0,0,.2);cursor:pointer;text-align:left;color:#f6f1e9;font:inherit;scroll-snap-align:start;transition:transform .2s cubic-bezier(.34,1.45,.64,1),border-color .18s,box-shadow .18s}
.gdx-proposal-card:hover{transform:translateY(-3px);border-color:#f08840;box-shadow:inset 0 1px rgba(255,255,255,.07),0 4px 0 rgba(0,0,0,.18),0 12px 26px rgba(240,136,64,.18)}
.gdx-proposal-card[data-active="true"]{border-color:#f08840;box-shadow:inset 0 1px rgba(255,255,255,.07),0 0 0 1px rgba(240,136,64,.5),0 10px 24px rgba(240,136,64,.18)}
.gdx-proposal-card[data-adopted="true"]{border-color:#ffb862;background:linear-gradient(155deg,#3d301f,#292522)}
.gdx-proposal-name{display:block;padding-right:58px;font-size:16px;font-weight:700}.gdx-proposal-meta{display:block;margin-top:8px;color:rgba(255,255,255,.55);font-size:12px}
.gdx-adopt{position:absolute;right:12px;top:12px;border:1px solid rgba(255,184,98,.8);border-radius:8px;background:linear-gradient(135deg,#ffc96a,#f08840);color:#3d2800;padding:5px 9px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.gdx-adopt:disabled{opacity:.5;cursor:wait}
.gdx-adopted-badge{position:absolute;right:13px;top:15px;color:#ffca87;font-size:12px;font-weight:700}
.gdx-paper{max-width:880px;padding:36px 44px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#292522;box-shadow:0 16px 40px rgba(0,0,0,.16)}
.gdx-prose{font-size:16px;line-height:1.85;color:rgba(255,255,255,.88);overflow-wrap:anywhere}
.gdx-prose h1,.gdx-prose h2,.gdx-prose h3{color:#fff;line-height:1.3;margin:1.45em 0 .55em}
.gdx-prose h1{font-size:28px;margin-top:0}.gdx-prose h2{font-size:21px}.gdx-prose h3{font-size:17px}
.gdx-prose p,.gdx-prose ul,.gdx-prose ol,.gdx-prose blockquote{margin:0 0 1em}
.gdx-prose blockquote{margin-left:0;padding:8px 16px;border-left:3px solid #f08840;background:rgba(240,136,64,.08);color:rgba(255,255,255,.68)}
.gdx-prose code{padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.1);font-family:ui-monospace,monospace;font-size:.88em}
.gdx-prose pre{overflow:auto;padding:14px;border-radius:6px;background:#171411}.gdx-prose pre code{padding:0;background:transparent}
.gdx-empty,.gdx-error{max-width:620px;padding:30px;border:1px dashed rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.025);color:rgba(255,255,255,.72);line-height:1.7}
.gdx-error{border-color:rgba(255,134,134,.6);color:#ffc1c1}.gdx-loading{color:rgba(255,255,255,.6)}
`

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(value)
}

export function DocumentLibraryView(): JSX.Element {
  injectStyleOnce('game-document-library', CSS)
  const documentType = useDocumentNav((state) => state.documentType)
  const [documents, setDocuments] = useState<ProjectDocumentSummary[] | null>(null)
  const [selection, setSelection] = useState<ProjectDocumentSelection | null>(null)
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [document, setDocument] = useState<ProjectDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    void fetchProjectDocuments()
      .then((next) => {
        if (!cancelled) {
          setDocuments(next.documents)
          setSelection(next.selection)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取项目文档失败')
      })
    return () => { cancelled = true }
  }, [])

  const matching = useMemo(
    () => (documents ?? []).filter((item) => item.documentType === documentType),
    [documentType, documents],
  )

  useEffect(() => {
    setSelectedId(matching[0]?.id ?? null)
  }, [documentType, matching])

  useEffect(() => {
    let cancelled = false
    setDocument(null)
    if (!selectedId) return () => { cancelled = true }
    void fetchProjectDocument(selectedId)
      .then((next) => {
        if (!cancelled) setDocument(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取文档正文失败')
      })
    return () => { cancelled = true }
  }, [selectedId])

  const title = DOCUMENT_LABELS[documentType]
  const adoptProposal = async (event: React.MouseEvent<HTMLButtonElement>, id: string): Promise<void> => {
    event.stopPropagation()
    if (selection?.proposalId || adoptingId) return
    setAdoptingId(id)
    setError(null)
    try {
      setSelection(await selectProjectProposal(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '采用策划案失败')
    } finally {
      setAdoptingId(null)
    }
  }
  return (
    <section className="gdx-root" aria-label="项目文档">
      <header className="gdx-header">
        <h1 className="gdx-title">{title}</h1>
      </header>
      <div className="gdx-content">
        {error ? <div className="gdx-error" role="alert">{error}</div> : null}
        {documents === null && !error ? <p className="gdx-loading">正在读取项目文档…</p> : null}
        {documents !== null && matching.length === 0 ? (
          <div className="gdx-empty">
            当前项目尚无{title}。创建和写入功能将在后续版本提供。
          </div>
        ) : null}
        {documentType === 'proposal' && matching.length > 0 ? (
          <div className="gdx-proposal-rail" aria-label="策划案列表">
            {matching.map((item) => {
              const adopted = selection?.proposalId === item.id
              return (
                <div
                  key={item.id}
                  className="gdx-proposal-card"
                  data-active={item.id === selectedId}
                  data-adopted={adopted}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(item.id)
                    }
                  }}
                >
                  <span className="gdx-proposal-name">{item.name}</span>
                  <span className="gdx-proposal-meta">更新于 {formatDate(item.updatedAt)}</span>
                  {adopted ? <span className="gdx-adopted-badge">已采用</span> : null}
                  {!selection?.proposalId ? (
                    <button
                      type="button"
                      className="gdx-adopt"
                      disabled={adoptingId !== null}
                      onClick={(event) => void adoptProposal(event, item.id)}
                    >
                      {adoptingId === item.id ? '采用中…' : '采用'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {selectedId && !document && !error ? <p className="gdx-loading">正在读取正文…</p> : null}
        {document ? (
          <article className="gdx-paper">
            <div className="gdx-prose">
              <ReactMarkdown>{document.content}</ReactMarkdown>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  )
}
