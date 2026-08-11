import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePipelineStore } from '@forgeax/node-runtime-react/editor'

import {
  limitSceneScriptDiagnostics,
  SceneScriptRequestError,
  type HttpApiClient,
  type SceneScriptDiagnostic,
  type SceneScriptDiagnosticFix,
  type SceneScriptSourceMapEntry,
  type SceneScriptSourceRange,
} from '../api/HttpApiClient.js'
import { publishSceneScriptDiagnostics } from './sceneScriptDiagnosticBridge.js'
import { SceneScriptDiffPanel } from './SceneScriptDiffPanel.js'
import {
  diffAuthoringSourceMap,
  diffSemanticGraph,
  diffTextLines,
  digestPngDataUrl,
  type PreviewCapture,
  type SceneDiffEvidence,
  type SemanticGraphDiff,
} from './sceneScriptDiff.js'
import './SceneScriptStudio.css'

type ProjectInfo = Awaited<ReturnType<HttpApiClient['getSceneScriptProjectInfo']>>

interface SceneScriptStudioProps {
  client: HttpApiClient
  projectId: string
  capturePreview: () => Promise<PreviewCapture>
  expanded?: boolean
  onToggleExpanded?: () => void
  onClose?: () => void
}

function diagnosticLabel(diagnostic: SceneScriptDiagnostic): string {
  const source = diagnostic.source
  const end = source?.endLine
    ? `-${source.endLine}:${source.endColumn ?? source.column}`
    : ''
  const location = source
    ? `${source.file}:${source.line}:${source.column}${end} [${source.start}-${source.end}]`
    : ''
  return [diagnostic.severity, diagnostic.phase, diagnostic.code, location].filter(Boolean).join(' · ')
}

function evidence(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isSafeFix(fix: SceneScriptDiagnosticFix): boolean {
  return fix.edits.length > 0 && fix.edits.every((edit) => edit.type === 'ReplaceReference')
}

function entryAt(
  sourceMap: readonly SceneScriptSourceMapEntry[],
  file: string,
  offset: number,
): SceneScriptSourceMapEntry | undefined {
  return sourceMap
    .filter((entry) => entry.source.file === file && entry.source.start <= offset && offset <= entry.source.end)
    .sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
}

export function SceneScriptStudio({
  client,
  projectId,
  capturePreview,
  expanded = false,
  onToggleExpanded,
  onClose,
}: SceneScriptStudioProps): JSX.Element {
  const selectedNodeIds = usePipelineStore((state) => state.selectedNodeIds)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const validationSequence = useRef(0)
  const selectionFromCodeRef = useRef<string | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [file, setFile] = useState('')
  const [source, setSource] = useState('')
  const [revision, setRevision] = useState('')
  const [savedSource, setSavedSource] = useState('')
  const [savedSourceMap, setSavedSourceMap] = useState<SceneScriptSourceMapEntry[]>([])
  const [sourceMap, setSourceMap] = useState<SceneScriptSourceMapEntry[]>([])
  const [diagnostics, setDiagnostics] = useState<SceneScriptDiagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applyingFix, setApplyingFix] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ expected?: string; actual?: string } | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [draftGraphDiff, setDraftGraphDiff] = useState<SemanticGraphDiff | null>(null)
  const [acceptedEvidence, setAcceptedEvidence] = useState<SceneDiffEvidence | null>(null)
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(true)

  const dirty = source !== savedSource
  const draftTextDiff = useMemo(() => diffTextLines(savedSource, source), [savedSource, source])
  const moduleFiles = useMemo(
    () => projectInfo?.files.filter((item) => item.kind === 'module') ?? [],
    [projectInfo],
  )
  const visibleDiagnostics = useMemo(
    () => limitSceneScriptDiagnostics(diagnostics),
    [diagnostics],
  )

  useEffect(() => {
    publishSceneScriptDiagnostics(projectId, visibleDiagnostics, sourceMap)
  }, [projectId, sourceMap, visibleDiagnostics])

  const selectRange = useCallback((range: SceneScriptSourceRange) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(range.start, range.end)
      const before = textarea.value.slice(0, range.start)
      const line = before.split('\n').length - 1
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 19
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3)
    })
  }, [])

  const loadFile = useCallback(async (nextFile: string, range?: SceneScriptSourceRange) => {
    setLoading(true)
    setNotice(null)
    setConflict(null)
    try {
      const module = await client.getSceneScriptModule(nextFile, projectId)
      setFile(module.file)
      setSource(module.source)
      setSavedSource(module.source)
      setRevision(module.revision)
      const nextSourceMap = module.state?.sourceMap ?? []
      setSavedSourceMap(nextSourceMap)
      setSourceMap(nextSourceMap)
      setDiagnostics([])
      setDraftGraphDiff(null)
      setAcceptedEvidence(null)
      if (range) selectRange(range)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client, projectId, selectRange])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProjectInfo(null)
    setFile('')
    setSource('')
    setSavedSource('')
    setSavedSourceMap([])
    setRevision('')
    setSourceMap([])
    setDiagnostics([])
    setConflict(null)
    setNotice(null)
    setDraftGraphDiff(null)
    setAcceptedEvidence(null)
    void client.getSceneScriptProjectInfo(projectId)
      .then(async (info) => {
        if (cancelled) return
        setProjectInfo(info)
        await loadFile(info.canonicalModule)
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : String(error))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [client, loadFile, projectId])

  const validate = useCallback(async (nextSource = source) => {
    if (!file) return
    const sequence = ++validationSequence.current
    setValidating(true)
    try {
      const result = await client.validateSceneScript({ file, source: nextSource }, projectId)
      if (sequence !== validationSequence.current) return
      setDiagnostics(result.diagnostics)
      const nextSourceMap = result.sourceMap ?? []
      setSourceMap(nextSourceMap)
      setDraftGraphDiff(diffAuthoringSourceMap(savedSourceMap, nextSourceMap, savedSource, nextSource))
      setNotice(result.valid ? null : 'Scene Script has errors. Fix them before saving.')
    } catch (error) {
      if (sequence === validationSequence.current) {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (sequence === validationSequence.current) setValidating(false)
    }
  }, [client, file, projectId, savedSource, savedSourceMap, source])

  useEffect(() => {
    if (!file || loading) return
    const timer = setTimeout(() => { void validate(source) }, 450)
    return () => clearTimeout(timer)
  }, [file, loading, source, validate])

  const save = useCallback(async () => {
    if (!file || saving) return
    setSaving(true)
    setNotice(null)
    setConflict(null)
    const transactionId = `save-${Date.now().toString(36)}`
    const beforeRevision = revision
    const beforeSource = savedSource
    let beforeGraph: Awaited<ReturnType<HttpApiClient['getSceneGraphSample']>>
    let beforePreview: PreviewCapture
    try {
      ;[beforeGraph, beforePreview] = await Promise.all([
        client.getSceneGraphSample(projectId),
        capturePreview(),
      ])
    } catch (error) {
      setNotice(`Save not started: unable to capture baseline evidence — ${error instanceof Error ? error.message : String(error)}`)
      setSaving(false)
      return
    }
    try {
      const result = await client.saveSceneScript({
        file,
        source,
        expectedRevision: revision,
        label: `Edit ${file} in Scene Script Studio`,
      }, projectId)
      setSource(result.canonicalSource)
      setSavedSource(result.canonicalSource)
      setRevision(result.revision)
      setSavedSourceMap(result.sourceMap)
      setSourceMap(result.sourceMap)
      setDiagnostics(result.diagnostics)
      setDraftGraphDiff(null)
      try {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const [afterGraph, afterPreview] = await Promise.all([
          client.getSceneGraphSample(projectId),
          capturePreview(),
        ])
        const beforeDigest = digestPngDataUrl(beforePreview.dataUrl)
        const afterDigest = digestPngDataUrl(afterPreview.dataUrl)
        setAcceptedEvidence({
          transactionId,
          file,
          beforeRevision,
          afterRevision: result.revision,
          acceptedAt: new Date().toISOString(),
          text: diffTextLines(beforeSource, result.canonicalSource),
          graph: diffSemanticGraph(beforeGraph, afterGraph, result.sourceMap),
          preview: {
            before: { ...beforePreview, digest: beforeDigest },
            after: { ...afterPreview, digest: afterDigest },
            status: beforeDigest === afterDigest ? 'unchanged' : 'changed',
          },
        })
        setDiffOpen(true)
        setNotice('Saved, compiled, and captured transaction evidence.')
      } catch (error) {
        setNotice(
          `Saved as ${result.revision.slice(0, 8)}, but evidence capture failed; the previous accepted evidence was kept. ` +
          (error instanceof Error ? error.message : String(error)),
        )
      }
    } catch (error) {
      if (error instanceof SceneScriptRequestError) {
        setDiagnostics(error.diagnostics)
        if (error.status === 409) {
          setConflict({ expected: error.expectedRevision, actual: error.actualRevision })
          setNotice('Save conflict: the remote file changed. Your local edits were kept and were not uploaded.')
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }, [capturePreview, client, file, projectId, revision, savedSource, saving, source])

  useEffect(() => {
    const selected = selectedNodeIds[0]
    if (!selected || selected === selectionFromCodeRef.current) {
      selectionFromCodeRef.current = null
      return
    }
    const entry = sourceMap.find(
      (candidate) => candidate.entityId === selected || candidate.runtimeNodeIds.includes(selected),
    )
    if (!entry) return
    if (entry.source.file !== file) {
      if (dirty) {
        setNotice(`Selected node is in ${entry.source.file}. Save or discard local edits before switching files.`)
        return
      }
      void loadFile(entry.source.file, entry.source)
      return
    }
    selectRange(entry.source)
  }, [dirty, file, loadFile, selectRange, selectedNodeIds, sourceMap])

  const selectNodeFromCursor = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const entry = entryAt(sourceMap, file, textarea.selectionStart)
    if (!entry) return
    selectionFromCodeRef.current = entry.entityId
    usePipelineStore.getState().requestSelectNodes([entry.entityId])
  }, [file, sourceMap])

  const chooseFile = useCallback((nextFile: string) => {
    if (nextFile === file) return
    if (dirty && !window.confirm(`Discard unsaved changes in ${file}?`)) return
    void loadFile(nextFile)
  }, [dirty, file, loadFile])

  const openDiagnostic = useCallback((diagnostic: SceneScriptDiagnostic) => {
    const statementId =
      diagnostic.graph?.authoringNodeId ??
      diagnostic.source?.statementId ??
      diagnostic.statementId
    const mapped = statementId
      ? sourceMap.find((entry) => entry.statementId === statementId)
      : undefined
    const nodeIds = mapped
      ? [mapped.entityId]
      : (diagnostic.graph?.runtimeNodeIds ?? [])
    if (nodeIds.length) {
      selectionFromCodeRef.current = nodeIds[0]
      usePipelineStore.getState().requestSelectNodes(nodeIds)
    }
    if (!diagnostic.source) return
    const range = diagnostic.source
    if (range.file !== file) {
      if (dirty && !window.confirm(`Discard unsaved changes in ${file}?`)) return
      void loadFile(range.file, range)
    } else {
      selectRange(range)
    }
  }, [dirty, file, loadFile, selectRange, sourceMap])

  const applyFix = useCallback(async (fix: SceneScriptDiagnosticFix) => {
    if (!file || applyingFix || !isSafeFix(fix)) return
    setApplyingFix(fix.fixId)
    setConflict(null)
    setNotice(null)
    try {
      const result = await client.applySceneScriptFix({
        file,
        expectedRevision: revision,
        fix,
      }, projectId)
      setSource(result.canonicalSource)
      setSavedSource(result.canonicalSource)
      setRevision(result.revision)
      setSavedSourceMap(result.sourceMap)
      setSourceMap(result.sourceMap)
      setDiagnostics(result.diagnostics)
      setDraftGraphDiff(null)
      setNotice(`Applied fix: ${fix.title}`)
    } catch (error) {
      if (error instanceof SceneScriptRequestError) {
        setDiagnostics(error.diagnostics)
        if (error.status === 409) {
          setConflict({ expected: error.expectedRevision, actual: error.actualRevision })
          setNotice('Fix conflict: the remote file changed. Your local edits were kept and were not overwritten.')
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setApplyingFix(null)
    }
  }, [applyingFix, client, file, projectId, revision])

  return (
    <aside
      className={`scene-script-studio${diagnosticsCollapsed ? ' has-collapsed-diagnostics' : ''}`}
      aria-label="Scene Script Studio"
    >
      <header className="scene-script-studio__header">
        <div>
          <strong>Scene Script</strong>
          <span className="scene-script-studio__revision" title={revision}>
            {dirty ? 'Unsaved' : revision ? `rev ${revision.slice(0, 8)}` : ''}
          </span>
        </div>
        <div className="scene-script-studio__actions">
          {onToggleExpanded && (
            <button
              type="button"
              aria-label={expanded ? 'Restore split Scene Script view' : 'Expand Scene Script editor'}
              title={expanded ? 'Restore balanced split' : 'Give the code editor more room'}
              onClick={onToggleExpanded}
            >
              {expanded ? 'Split' : 'Expand'}
            </button>
          )}
          <button type="button" onClick={() => void validate()} disabled={!file || validating}>
            {validating ? 'Checking…' : 'Check'}
          </button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {onClose && <button type="button" aria-label="Close Scene Script" onClick={onClose}>×</button>}
        </div>
      </header>

      <label className="scene-script-studio__file">
        <span>Project file</span>
        <select
          aria-label="Scene Script project file"
          value={file}
          disabled={loading}
          onChange={(event) => chooseFile(event.currentTarget.value)}
        >
          {moduleFiles.map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
        </select>
      </label>

      <div className="scene-script-studio__status">
        {conflict && (
          <div className="scene-script-studio__conflict" role="alert">
            Remote revision {conflict.actual?.slice(0, 8) || 'changed'} conflicts with local base{' '}
            {conflict.expected?.slice(0, 8) || revision.slice(0, 8)}. Local text is preserved.
            <button type="button" onClick={() => {
              if (!dirty || window.confirm('Discard local edits and load the remote revision?')) void loadFile(file)
            }}>
              Load remote
            </button>
          </div>
        )}
        {notice && <div className="scene-script-studio__notice" role="status">{notice}</div>}
      </div>

      <textarea
        ref={textareaRef}
        className="scene-script-studio__editor"
        aria-label="Scene Script source"
        value={source}
        disabled={loading}
        spellCheck={false}
        onChange={(event) => {
          setSource(event.currentTarget.value)
          setConflict(null)
          setNotice(null)
          setDraftGraphDiff(null)
        }}
        onClick={selectNodeFromCursor}
        onKeyUp={selectNodeFromCursor}
        onSelect={selectNodeFromCursor}
      />

      <SceneScriptDiffPanel
        open={diffOpen}
        draftRevision={revision}
        draftText={draftTextDiff}
        draftGraph={draftGraphDiff}
        evidence={acceptedEvidence}
        onToggle={() => setDiffOpen((open) => !open)}
      />

      <section
        className={`scene-script-studio__diagnostics${diagnosticsCollapsed ? ' is-collapsed' : ''}`}
        aria-label="Scene Script diagnostics"
      >
        <button
          type="button"
          className="scene-script-studio__diagnostics-title"
          aria-expanded={!diagnosticsCollapsed}
          onClick={() => setDiagnosticsCollapsed((collapsed) => !collapsed)}
        >
          <span>Diagnostics</span>
          <span>{validating ? '…' : visibleDiagnostics.length} · {diagnosticsCollapsed ? 'Show' : 'Hide'}</span>
        </button>
        <div className="scene-script-studio__diagnostics-body">
          {visibleDiagnostics.length === 0 ? (
            <p>No parse or compile diagnostics.</p>
          ) : (
            <ul>
            {visibleDiagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.source?.start ?? index}`} data-severity={diagnostic.severity}>
                <button className="scene-script-studio__diagnostic-open" type="button" onClick={() => openDiagnostic(diagnostic)}>
                  <span>{diagnosticLabel(diagnostic)}</span>
                  {diagnostic.message}
                </button>
                <dl className="scene-script-studio__diagnostic-details">
                  {diagnostic.expected !== undefined && <><dt>Expected</dt><dd>{evidence(diagnostic.expected)}</dd></>}
                  {diagnostic.actual !== undefined && <><dt>Actual</dt><dd>{evidence(diagnostic.actual)}</dd></>}
                  {diagnostic.transaction && (
                    <>
                      <dt>Transaction</dt>
                      <dd>
                        applied={String(diagnostic.transaction.applied)} · rolledBack={String(diagnostic.transaction.rolledBack)}
                        {diagnostic.transaction.undoToken ? ` · undo ${diagnostic.transaction.undoToken}` : ''}
                      </dd>
                    </>
                  )}
                  {diagnostic.retryable !== undefined && <><dt>Retryable</dt><dd>{String(diagnostic.retryable)}</dd></>}
                  {diagnostic.escalation && <><dt>Escalation</dt><dd>{diagnostic.escalation}</dd></>}
                  {diagnostic.debugAttachment && <><dt>Debug Attachment</dt><dd><code>{diagnostic.debugAttachment}</code></dd></>}
                </dl>
                {(diagnostic.fixes ?? []).slice(0, 3).map((fix) => (
                  <button
                    className="scene-script-studio__fix"
                    type="button"
                    key={fix.fixId}
                    disabled={!isSafeFix(fix) || applyingFix !== null}
                    title={isSafeFix(fix) ? `Apply ${fix.title}` : 'This fix requires manual source review.'}
                    onClick={() => void applyFix(fix)}
                  >
                    {applyingFix === fix.fixId ? 'Applying…' : `Fix: ${fix.title}`}
                  </button>
                ))}
              </li>
            ))}
            </ul>
          )}
        </div>
      </section>
    </aside>
  )
}
