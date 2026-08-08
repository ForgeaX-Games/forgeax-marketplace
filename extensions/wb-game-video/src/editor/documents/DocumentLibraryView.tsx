import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocumentType } from '../assets/registry-types'
import { getDocumentMountOptions } from '../../host-init'
import { injectStyleOnce } from '../../styles/injectStyle'
import {
  fetchProjectDocument,
  fetchProjectDocuments,
  type ProjectDocument,
  type ProjectDocumentSummary,
} from './document-client'
import { extractAuthorVisible } from './extractAuthorVisible'
import { useDocumentNav } from '../persist/documentNavStore'

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  intake: '需求',
  core: '核心',
  inquiry: '问询',
  pillar: '支柱',
}

const CSS = `
.gdx-root{height:100%;min-height:0;display:flex;flex-direction:column;background:#201d1a;color:#f6f1e9;font-family:'PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif}
.gdx-header{flex:none;padding:28px 36px 22px;border-bottom:1px solid rgba(255,255,255,.12);background:#2c2c2c}
.gdx-title{margin:0;font-size:24px;font-weight:600;letter-spacing:.02em}
.gdx-content{flex:1;min-height:0;overflow:auto;padding:28px 36px 56px}
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

export function DocumentLibraryView(): JSX.Element {
  injectStyleOnce('game-document-library', CSS)
  const documentType = useDocumentNav((state) => state.documentType)
  const [documents, setDocuments] = useState<ProjectDocumentSummary[] | null>(null)
  const [document, setDocument] = useState<ProjectDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Re-listing per active type keeps a document that was upserted or healed
  // after mount visible without a reload; the previous list and error are
  // dropped first so nothing from the outgoing type survives the switch.
  useEffect(() => {
    let cancelled = false
    setDocuments(null)
    setError(null)
    void fetchProjectDocuments()
      .then((next) => {
        if (!cancelled) setDocuments(next.documents)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取项目文档失败')
      })
    return () => { cancelled = true }
  }, [documentType])

  const matching = useMemo(
    () => (documents ?? []).filter((item) => item.documentType === documentType),
    [documentType, documents],
  )

  const selectedId = matching[0]?.id ?? null

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
  const { docActionSlotEl } = getDocumentMountOptions()

  return (
    <section className="gdx-root" aria-label="项目文档">
      <header className="gdx-header">
        <h1 className="gdx-title">{title}</h1>
        {docActionSlotEl ? (
          <div
            data-testid="doc-action-slot-host"
            ref={(el) => {
              if (el && docActionSlotEl.parentElement !== el) {
                el.appendChild(docActionSlotEl)
              }
            }}
          />
        ) : null}
      </header>
      <div className="gdx-content">
        {error ? <div className="gdx-error" role="alert">{error}</div> : null}
        {documents === null && !error ? <p className="gdx-loading">正在读取项目文档…</p> : null}
        {documents !== null && matching.length === 0 ? (
          <div className="gdx-empty">
            当前项目尚无{title}。
          </div>
        ) : null}
        {selectedId && !document && !error ? <p className="gdx-loading">正在读取正文…</p> : null}
        {document ? (
          <article className="gdx-paper">
            <div className="gdx-prose">
              <ReactMarkdown>{extractAuthorVisible(document.content)}</ReactMarkdown>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  )
}
