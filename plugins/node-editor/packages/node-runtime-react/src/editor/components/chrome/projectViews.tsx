// Shared project sub-views — the building blocks for both the modal
// `ProjectsDialog` and the inline `ProjectPanel` (left side pane). Extracted so
// the project UI has a SINGLE implementation: a card (open / rename / delete),
// the new-project wizard, and the delete confirmation. Consumers compose these;
// they own no layout chrome beyond what the cards need.

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getEditorTransport } from '../../transport/index.js'
import { useProjectStore } from '../../stores/projectStore.js'
import type { ImportTemplate, ProjectMeta } from '@forgeax/node-runtime'
import './ProjectsDialog.css'

export interface ProjectExecutionLock {
  agentId: string
  sessionId?: string
  acquiredAt?: string
}

/** aw-support export pipeline still in flight (may not hold a scene lock). */
export interface ActivePipelineRunInfo {
  runId: string
  sceneProjectId: string
  sceneName?: string
  sessionId?: string
  stage?: string
}

/** Human-readable agent lock badge: agent + session + aw-support run hint from name. */
export function formatProjectLockLabel(lock: ProjectExecutionLock, projectName?: string): string {
  const agent =
    lock.agentId === 'sino' || lock.agentId.startsWith('sino-')
      ? 'Sino'
      : lock.agentId.startsWith('ai:')
        ? lock.agentId.slice(3)
        : lock.agentId
  const session = lock.sessionId ? lock.sessionId.slice(0, 8) : null
  const runMatch = projectName?.match(/aw-support · .+? · ([\w-]+)/)
  const runHint = runMatch?.[1]
  const parts = [`Executing · ${agent}`]
  if (session) parts.push(`session ${session}`)
  if (runHint) parts.push(`run ${runHint}`)
  return parts.join(' · ')
}

/** Pipeline-run badge when ForgeaX agents are working but scene lock may be idle. */
export function formatPipelineRunLabel(run: ActivePipelineRunInfo): string {
  const session = run.sessionId ? run.sessionId.slice(0, 8) : null
  const shortRun = run.runId.replace(/^pure-asset-\d{8}-/, '').replace(/^export-\d{8}-/, '')
  const parts = ['Pipeline run']
  if (session) parts.push(`session ${session}`)
  parts.push(`run ${shortRun}`)
  if (run.stage && run.stage !== 'agents') parts.push(run.stage)
  return parts.join(' · ')
}

/**
 * Pick a project name that doesn't collide with existing ones. The first choice
 * is `base` ("My scene"); if taken, append " (2)", " (3)", … until free.
 * Comparison is case-insensitive on the trimmed name.
 */
function uniqueProjectName(base: string, existing: readonly ProjectMeta[]): string {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function ProjectCard({
  project,
  isActive,
  isSwitching,
  lockLabel,
  executingLock,
  pipelineRun,
  canDelete = true,
  extraActions,
  onActivate,
  onRename,
  onRequestDelete,
}: {
  project: ProjectMeta
  isActive: boolean
  isSwitching: boolean
  /** @deprecated Prefer executingLock — kept for custom lockLabelOf overrides. */
  lockLabel?: string | null
  /** When set, the project is held by an agent — render an executing badge. */
  executingLock?: ProjectExecutionLock | null
  /** aw-support pipeline still running on this project (even without scene lock). */
  pipelineRun?: ActivePipelineRunInfo | null
  /** When false, the Delete action is disabled (e.g. the last remaining project). */
  canDelete?: boolean
  /** Optional extra action(s) injected into the card's action column (e.g. Save). */
  extraActions?: ReactNode
  onActivate: () => void
  onRename: (name: string) => void
  onRequestDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const executingLabel =
    lockLabel ?? (executingLock ? formatProjectLockLabel(executingLock, project.name) : null)
  const pipelineLabel = pipelineRun ? formatPipelineRunLabel(pipelineRun) : null

  return (
    <div className={`proj-card${isActive ? ' proj-card--active' : ''}${executingLock || pipelineRun ? ' proj-card--executing' : ''}`}>
      <button type="button" className="proj-card__open" disabled={isSwitching} onClick={onActivate}>
        <span className="proj-card__type">{project.type}</span>
        {editing ? (
          <input
            className="proj-card__name-input"
            value={name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name !== project.name) onRename(name.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <span className="proj-card__name">{project.name}</span>
        )}
        <span className="proj-card__badges">
          {isActive && <span className="proj-card__badge proj-card__badge--viewing">Viewing</span>}
          {pipelineLabel && (
            <span className="proj-card__badge proj-card__badge--pipeline" title={pipelineLabel}>
              {pipelineLabel}
            </span>
          )}
          {executingLabel && (
            <span className="proj-card__badge proj-card__badge--lock" title={executingLabel}>
              {executingLabel}
            </span>
          )}
        </span>
      </button>
      <div className="proj-card__actions">
        {extraActions}
        <button type="button" className="proj-card__action" title="Rename" onClick={() => setEditing(true)}>
          Rename
        </button>
        <button
          type="button"
          className="proj-card__action proj-card__action--danger"
          title={canDelete ? 'Delete' : 'Cannot delete the last project'}
          disabled={!canDelete}
          onClick={onRequestDelete}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

export function NewProjectWizard({
  defaultProjectType,
  defaultProjectName,
  onCancel,
  onCreated,
}: {
  defaultProjectType: string
  defaultProjectName: string
  onCancel: () => void
  onCreated: () => void
}): JSX.Element {
  const createProject = useProjectStore((s) => s.createProject)
  const existingProjects = useProjectStore((s) => s.projects)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fromTemplate, setFromTemplate] = useState('')
  const [templates, setTemplates] = useState<readonly ImportTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEditorTransport()
      .api.listImportTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  const submit = useCallback(async () => {
    // Empty name → fall back to the default ("My scene"), de-duplicating against
    // existing project names as "My scene (2)", "(3)", … so a blank name is
    // always a valid, unique project rather than an error.
    const resolvedName = name.trim() || uniqueProjectName(defaultProjectName, existingProjects)
    setBusy(true)
    setError(null)
    try {
      await createProject({
        type: defaultProjectType,
        name: resolvedName,
        description: description.trim() || undefined,
        fromTemplate: fromTemplate || undefined,
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [name, description, fromTemplate, defaultProjectType, defaultProjectName, existingProjects, createProject, onCreated])

  return (
    <div className="proj-wizard">
      <header className="proj-modal__head">
        <h2>New project</h2>
      </header>
      <label className="proj-field">
        <span>Name</span>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={defaultProjectName} />
      </label>
      <label className="proj-field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="(optional)" />
      </label>
      <label className="proj-field">
        <span>Template</span>
        <select value={fromTemplate} onChange={(e) => setFromTemplate(e.target.value)}>
          <option value="">Blank</option>
          {templates.map((t) => (
            <option key={t.path} value={t.path}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="proj-error">{error}</div>}
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating...' : 'Create and open'}
        </button>
      </footer>
    </div>
  )
}

export function DeleteProjectDialog({
  project,
  onCancel,
  onDone,
}: {
  project: ProjectMeta
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const [policy, setPolicy] = useState<'detach' | 'delete'>('detach')
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      await deleteProject(project.id, policy)
      onDone()
    } finally {
      setBusy(false)
    }
  }, [deleteProject, project.id, policy, onDone])

  return (
    <div className="proj-delete">
      <header className="proj-modal__head">
        <h2>Delete "{project.name}"?</h2>
      </header>
      <p className="proj-delete__copy">
        This permanently removes the project's graph, history, and outputs. This cannot be undone.
      </p>
      <fieldset className="proj-delete__policy">
        <legend>Produced assets</legend>
        <label>
          <input type="radio" checked={policy === 'detach'} onChange={() => setPolicy('detach')} /> Keep assets (detach)
        </label>
        <label>
          <input type="radio" checked={policy === 'delete'} onChange={() => setPolicy('delete')} /> Delete produced assets
        </label>
      </fieldset>
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Deleting...' : 'Delete project'}
        </button>
      </footer>
    </div>
  )
}
