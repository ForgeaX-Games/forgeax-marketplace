// ProjectPanel — the inline, non-modal project manager for a workbench's left
// side pane. The SSOT for "switch / create / delete project" UI: it is driven by
// the same `useProjectStore` as the editor canvas, so a switch here flips the
// center editor live (via the project:activated cross-client sync), and a switch
// elsewhere (an agent tool) reflects here. Replaces the old top-right toolbar
// button + ProjectsDialog modal.
//
// The host (left-pane surface) is responsible for configuring the editor
// transport (configureEditorTransport) and calling
// useProjectStore.subscribeProjectActivation() so this panel stays live.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useProjectStore } from '../../stores/projectStore.js'
import type { ProjectMeta } from '@forgeax/node-runtime'
import { ProjectCard, NewProjectWizard, DeleteProjectDialog } from './projectViews.js'
import './ProjectPanel.css'

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'delete'; project: ProjectMeta }

export interface ProjectPanelProps {
  /** Domain type tag for newly-created projects (e.g. 'lowpoly', 'scene'). */
  defaultProjectType?: string
  /** Placeholder name shown in the new-project wizard. */
  defaultProjectName?: string
  /** Optional resolver for a per-project "held by agent" badge label. */
  lockLabelOf?: (project: ProjectMeta) => string | null
  /** Optional extra control(s) rendered in the panel header, after "+ New". */
  headerActions?: ReactNode
  /** Optional per-project action(s) injected into each card's action column. */
  renderProjectActions?: (project: ProjectMeta) => ReactNode
}

export function ProjectPanel({
  defaultProjectType = 'default',
  defaultProjectName = 'My project',
  lockLabelOf,
  headerActions,
  renderProjectActions,
}: ProjectPanelProps): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const isSwitching = useProjectStore((s) => s.isSwitching)
  const switchProject = useProjectStore((s) => s.switchProject)
  const renameProject = useProjectStore((s) => s.renameProject)

  const [view, setView] = useState<View>({ kind: 'list' })

  // The list, new-project wizard, and delete dialog are mutually-exclusive
  // renders of this same panel — entering one UNMOUNTS the scrollable list, so
  // its scrollTop is lost and the list would snap back to the top on return.
  // We snapshot the scroll offset when leaving the list and restore it via a
  // callback ref the moment the list re-mounts, keeping the user in place.
  const listScrollRef = useRef(0)
  const captureListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) listScrollRef.current = el.scrollTop
  }, [])
  const restoreListScroll = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = listScrollRef.current
  }, [])

  const handleActivate = useCallback(
    (id: string) => {
      if (id === activeProjectId) return
      void switchProject(id)
    },
    [activeProjectId, switchProject],
  )

  const sorted = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name)), [projects])

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
        <h2>Projects</h2>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => setView({ kind: 'new' })}>
          + New
        </button>
        {headerActions}
      </header>
      <div className="proj-panel__list" ref={restoreListScroll} onScroll={(e) => captureListScroll(e.currentTarget)}>
        {sorted.length === 0 && <div className="proj-empty">No projects yet - create one.</div>}
        {sorted.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            isActive={p.id === activeProjectId}
            isSwitching={isSwitching}
            lockLabel={lockLabelOf?.(p) ?? null}
            // The active project can never be deleted: it's the one currently
            // open, and deleting it would force a disruptive auto-switch. This
            // also keeps the workspace non-empty (the sole project is active).
            canDelete={p.id !== activeProjectId}
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
