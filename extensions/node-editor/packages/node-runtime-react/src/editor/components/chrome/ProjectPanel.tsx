// ProjectPanel — the inline, non-modal project manager for a workbench's left
// side pane. The SSOT for "switch / create / delete project" UI: it is driven by
// the same `useProjectStore` as the editor canvas, so a switch here flips the
// center editor live (via the project:viewing cross-client sync), and a switch
// elsewhere (an agent tool) reflects here. Replaces the old top-right toolbar
// button + ProjectsDialog modal.
//
// The host (left-pane surface) is responsible for configuring the editor
// transport (configureEditorTransport) and calling
// useProjectStore.subscribeProjectActivation() so this panel stays live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useProjectStore } from '../../stores/projectStore.js'
import { getEditorTransport } from '../../transport/index.js'
import type { ProjectMeta } from '@forgeax/node-runtime'
import {
  ProjectCard,
  NewProjectWizard,
  DeleteProjectDialog,
  formatProjectLockLabel,
  formatPipelineRunLabel,
  type ActivePipelineRunInfo,
  type ProjectExecutionLock,
} from './projectViews.js'
import './ProjectPanel.css'

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'delete'; project: ProjectMeta }

type LockMap = Record<string, ProjectExecutionLock>

export interface ProjectPanelProps {
  /** Domain type tag for newly-created projects (e.g. 'lowpoly', 'scene'). */
  defaultProjectType?: string
  /** Placeholder name shown in the new-project wizard. */
  defaultProjectName?: string
  /** Optional resolver for a per-project "held by agent" badge label. */
  lockLabelOf?: (project: ProjectMeta) => string | null
  /**
   * aw-support (or other orchestrator) export pipelines still in flight.
   * Distinct from scene-generator locks — parallel runs may share only one lock
   * at a time but still have multiple ForgeaX sessions active.
   */
  activePipelineRuns?: readonly ActivePipelineRunInfo[]
  /** Optional extra control(s) rendered in the panel header, after "+ New". */
  headerActions?: ReactNode
  /** Optional per-project action(s) injected into each card's action column. */
  renderProjectActions?: (project: ProjectMeta) => ReactNode
}

function projectSortRank(
  p: ProjectMeta,
  viewingProjectId: string | null,
  lockedProjectIds: ReadonlySet<string>,
  pipelineProjectIds: ReadonlySet<string>,
): number {
  const locked = lockedProjectIds.has(p.id)
  const pipelined = pipelineProjectIds.has(p.id)
  const viewing = p.id === viewingProjectId
  if ((locked || pipelined) && !viewing) return 0
  if (viewing) return 1
  if (locked || pipelined) return 0
  return 2
}

export function ProjectPanel({
  defaultProjectType = 'default',
  defaultProjectName = 'My project',
  lockLabelOf,
  activePipelineRuns = [],
  headerActions,
  renderProjectActions,
}: ProjectPanelProps): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const viewingProjectId = useProjectStore((s) => s.viewingProjectId)
  const executingProjectIds = useProjectStore((s) => s.executingProjectIds)
  const isSwitching = useProjectStore((s) => s.isSwitching)
  const switchProject = useProjectStore((s) => s.switchProject)
  const renameProject = useProjectStore((s) => s.renameProject)

  const [view, setView] = useState<View>({ kind: 'list' })
  const [lockMap, setLockMap] = useState<LockMap>({})
  const [filter, setFilter] = useState('')
  const fetchProjects = useProjectStore((s) => s.fetchProjects)

  // aw-support provisions projects out-of-band; refresh while agents are active so
  // newly created rows appear without a full page reload.
  useEffect(() => {
    const hasActive = executingProjectIds.length > 0 || activePipelineRuns.length > 0
    if (!hasActive) return
    void fetchProjects()
    const timer = setInterval(() => void fetchProjects(), 5000)
    return () => clearInterval(timer)
  }, [executingProjectIds.length, activePipelineRuns.length, fetchProjects])

  const pipelineByProject = useMemo(() => {
    const map: Record<string, ActivePipelineRunInfo> = {}
    for (const run of activePipelineRuns) {
      if (run.sceneProjectId) map[run.sceneProjectId] = run
    }
    return map
  }, [activePipelineRuns])

  const pipelineProjectIds = useMemo(
    () => new Set(activePipelineRuns.map((r) => r.sceneProjectId).filter(Boolean)),
    [activePipelineRuns],
  )

  const refreshLocks = useCallback(async () => {
    const { api } = getEditorTransport()
    if (api.listWorkspaceLocks) {
      try {
        const res = await api.listWorkspaceLocks()
        if (!res) return
        const next: LockMap = {}
        for (const entry of res.locks ?? []) {
          next[entry.projectId] = {
            agentId: entry.agentId,
            sessionId: entry.sessionId,
            acquiredAt: entry.acquiredAt,
          }
        }
        setLockMap(next)
        return
      } catch {
        /* fall through to per-project fetch */
      }
    }
    if (!api.getProjectLock) {
      setLockMap({})
      return
    }
    const ids = new Set([...executingProjectIds, ...Object.keys(pipelineByProject)])
    if (ids.size === 0) {
      setLockMap({})
      return
    }
    const entries = await Promise.all(
      [...ids].map(async (id) => {
        try {
          const res = await api.getProjectLock!(id)
          const lock = res?.lock
          return lock ? ([id, { agentId: lock.agentId, sessionId: lock.sessionId, acquiredAt: lock.acquiredAt }] as const) : null
        } catch {
          return null
        }
      }),
    )
    setLockMap(Object.fromEntries(entries.filter(Boolean) as Array<[string, ProjectExecutionLock]>))
  }, [executingProjectIds, pipelineByProject])

  useEffect(() => {
    void refreshLocks()
    const timer = setInterval(() => void refreshLocks(), 3000)
    return () => clearInterval(timer)
  }, [refreshLocks])

  const lockedProjectIds = useMemo(() => {
    const ids = new Set(Object.keys(lockMap))
    for (const id of executingProjectIds) ids.add(id)
    for (const id of pipelineProjectIds) ids.add(id)
    return ids
  }, [lockMap, executingProjectIds, pipelineProjectIds])

  const resolveSceneLock = useCallback(
    (project: ProjectMeta): ProjectExecutionLock | null => lockMap[project.id] ?? null,
    [lockMap],
  )

  const resolvePipelineRun = useCallback(
    (project: ProjectMeta): ActivePipelineRunInfo | null => pipelineByProject[project.id] ?? null,
    [pipelineByProject],
  )

  const resolveLockLabel = useCallback(
    (project: ProjectMeta): string | null => {
      const custom = lockLabelOf?.(project)
      if (custom) return custom
      const lock = resolveSceneLock(project)
      return lock ? formatProjectLockLabel(lock, project.name) : null
    },
    [lockLabelOf, resolveSceneLock],
  )

  const listScrollRef = useRef(0)
  const captureListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) listScrollRef.current = el.scrollTop
  }, [])
  const restoreListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = listScrollRef.current
  }, [])

  const handleActivate = useCallback(
    (id: string) => {
      if (id === viewingProjectId) return
      void switchProject(id)
    },
    [viewingProjectId, switchProject],
  )

  const viewingProject = useMemo(
    () => projects.find((p) => p.id === viewingProjectId) ?? null,
    [projects, viewingProjectId],
  )

  const sorted = useMemo(
    () => {
      const knownIds = new Set(projects.map((p) => p.id))
      const orphanExecuting: ProjectMeta[] = [...executingProjectIds, ...pipelineProjectIds]
        .filter((id, i, arr) => arr.indexOf(id) === i && !knownIds.has(id))
        .map((id) => ({
          id,
          type: defaultProjectType,
          name: `Agent project (${id.slice(-8)})`,
          description: 'Created by agent — refresh if name is missing',
          createdAt: '',
          updatedAt: '',
        }))
      const all = [...orphanExecuting, ...projects]
      return all.sort((a, b) => {
        const ra = projectSortRank(a, viewingProjectId, lockedProjectIds, pipelineProjectIds)
        const rb = projectSortRank(b, viewingProjectId, lockedProjectIds, pipelineProjectIds)
        return ra - rb || a.name.localeCompare(b.name)
      })
    },
    [projects, viewingProjectId, lockedProjectIds, pipelineProjectIds, executingProjectIds, defaultProjectType],
  )

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    )
  }, [sorted, filter])

  const activeCount = lockedProjectIds.size
  const showStatus = viewingProject || activePipelineRuns.length > 0 || activeCount > 0

  if (view.kind === 'new') {
    return (
      <section className="proj-panel">
        <NewProjectWizard
          defaultProjectType={defaultProjectType}
          defaultProjectName={defaultProjectName}
          onCancel={() => setView({ kind: 'list' })}
          onCreated={() => setView({ kind: 'list' })}
        />
      </section>
    )
  }

  if (view.kind === 'delete') {
    return (
      <section className="proj-panel">
        <DeleteProjectDialog
          project={view.project}
          onCancel={() => setView({ kind: 'list' })}
          onDone={() => setView({ kind: 'list' })}
        />
      </section>
    )
  }

  return (
    <section className="proj-panel" aria-label="Projects">
      <header className="proj-panel__head">
        <h2>
          Projects
          <span className="proj-panel__count" title={`${projects.length} total${activeCount ? ` · ${activeCount} active` : ''}`}>
            {projects.length}
            {activeCount > 0 ? ` · ${activeCount} active` : ''}
          </span>
        </h2>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => setView({ kind: 'new' })}>
          + New
        </button>
        {headerActions}
      </header>
      <input
        type="search"
        className="proj-panel__filter"
        placeholder="Filter projects…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter projects"
      />
      {showStatus && (
        <div className="proj-panel__status" aria-live="polite">
          {viewingProject && (
            <div className="proj-panel__status-row">
              <span className="proj-panel__status-label">Viewing</span>
              <span className="proj-panel__status-value" title={`${viewingProject.name} (${viewingProject.id})`}>
                {viewingProject.name}
              </span>
            </div>
          )}
          {executingProjectIds
            .filter((projectId) => !lockMap[projectId])
            .map((projectId) => {
              const meta = projects.find((p) => p.id === projectId)
              const isViewing = projectId === viewingProjectId
              return (
                <div key={`exec-${projectId}`} className="proj-panel__status-row proj-panel__status-row--executing">
                  <span className="proj-panel__status-label">Executing</span>
                  <button
                    type="button"
                    className="proj-panel__status-action"
                    disabled={isViewing || isSwitching}
                    title={isViewing ? projectId : `${meta?.name ?? projectId} — click to view canvas`}
                    onClick={() => handleActivate(projectId)}
                  >
                    {meta?.name ?? projectId}
                    {!isViewing && ' →'}
                  </button>
                </div>
              )
            })}
          {Object.entries(lockMap).map(([projectId, lock]) => {
            const meta = projects.find((p) => p.id === projectId)
            const label = formatProjectLockLabel(lock, meta?.name ?? projectId)
            const isViewing = projectId === viewingProjectId
            return (
              <div key={`lock-${projectId}`} className="proj-panel__status-row proj-panel__status-row--executing">
                <span className="proj-panel__status-label">Executing</span>
                <button
                  type="button"
                  className="proj-panel__status-action"
                  disabled={isViewing || isSwitching}
                  title={isViewing ? label : `${label} — click to view`}
                  onClick={() => handleActivate(projectId)}
                >
                  {meta?.name ?? projectId}
                  {!isViewing && ' →'}
                </button>
              </div>
            )
          })}
          {activePipelineRuns
            .filter((run) => run.sceneProjectId && !lockMap[run.sceneProjectId])
            .map((run) => {
              const meta = projects.find((p) => p.id === run.sceneProjectId)
              const label = formatPipelineRunLabel(run)
              return (
                <div key={`run-${run.runId}`} className="proj-panel__status-row proj-panel__status-row--pipeline">
                  <span className="proj-panel__status-label">Pipeline</span>
                  <span className="proj-panel__status-value" title={label}>
                    {meta?.name ?? run.sceneName ?? run.sceneProjectId}
                  </span>
                </div>
              )
            })}
        </div>
      )}
      <div className="proj-panel__list" ref={restoreListScroll} onScroll={(e) => captureListScroll(e.currentTarget)}>
        {filtered.length === 0 && (
          <div className="proj-empty">
            {sorted.length === 0 ? 'No projects yet - create one.' : 'No projects match filter.'}
          </div>
        )}
        {filtered.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            isActive={p.id === viewingProjectId}
            isSwitching={isSwitching}
            executingLock={resolveSceneLock(p)}
            pipelineRun={resolvePipelineRun(p)}
            lockLabel={resolveLockLabel(p)}
            canDelete={p.id !== viewingProjectId}
            extraActions={renderProjectActions?.(p)}
            onActivate={() => handleActivate(p.id)}
            onRename={(name) => void renameProject(p.id, name)}
            onRequestDelete={() => setView({ kind: 'delete', project: p })}
          />
        ))}
      </div>
    </section>
  )
}
