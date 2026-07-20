// Project store — multi-project management for the faithful editor.
//
// A port of the legacy editor's projectStore onto the kernel transport. It
// drives create / list / open(switch) / delete over the EditorApiAdapter's
// optional project methods, and wires the OPEN CASCADE into the existing
// live-sync machinery rather than reinventing it:
//
//   switchProject(id):
//     1. persistSession()            ← flush the outgoing project's canvas
//     2. api.viewProject(id)        ← server sets the UI viewing target
//     3. reset node outputs / dynamic ports / selection / group view
//     4. loadPipeline()              ← pipelineRevision++ → useCanvasGraphSync
//                                       reconcile rebuild → preview refresh
//     5. clearHistory()              ← undo stack does NOT cross projects
//     6. setActiveProjectType(type)  ← keeps the battery filter correct
//     7. refresh recentProjectIds from the workspace doc
//
// Steps 1–7 reuse the SAME paths every other actor uses (loadPipeline →
// graph:applied → reconcile), so no editor behaviour is regressed. The app
// (e.g. scene-generator) observes `viewingProjectId` to clear/reload its preview
// iframe (the renderer `projectChanged` signal) — that wiring stays app-level.

import { create } from 'zustand'

import type { CreateProjectRequest } from '../../api/ApiClient.js'
import type { ProjectMeta, WorkspaceState } from '@forgeax/node-runtime'

import { getEditorTransport } from '../transport/index.js'
import { useHistoryStore } from './historyStore.js'
import {
  cancelDeferredProjectSwitchOutputRefresh,
  clearOutputMetaCache,
  usePipelineStore,
} from './pipelineStore.js'
import { useUIStore } from './uiStore.js'

function resetPipelineUiForProjectSwitch(): void {
  cancelDeferredProjectSwitchOutputRefresh()
  clearOutputMetaCache()
  usePipelineStore.setState({
    nodeOutputs: {},
    dynamicOutputPorts: {},
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    pendingSelectNodeIds: null,
    groupViewStack: [],
  })
}

function refreshOutputsAfterProjectSwitch(_agentBusy: boolean): void {
  // Always hydrate the viewing project from server-retained outputs. Agents
  // executing on *other* projects must not defer or skip this — that left the
  // preview blank until every unrelated session went idle.
  cancelDeferredProjectSwitchOutputRefresh()
  void usePipelineStore.getState().refreshConnectedOutputs('project-switch')
}

function reloadHistoryAfterProjectSwitch(agentBusy: boolean): void {
  const { api } = getEditorTransport()
  useHistoryStore.getState().clearHistory()
  if (agentBusy) {
    void api
      .getHistory()
      .then((entries) => useHistoryStore.getState().hydrate(entries))
      .catch((e) => console.warn('[projectStore] deferred history reload failed:', e))
    return
  }
  void (async () => {
    try {
      useHistoryStore.getState().hydrate(await api.getHistory())
    } catch (e) {
      console.warn('[projectStore] history reload after switch failed:', e)
      useHistoryStore.getState().clearHistory()
    }
  })()
}

function viewingIdFromWorkspace(workspace: WorkspaceState | null | undefined): string | null {
  if (!workspace) return null
  return workspace.viewingProjectId ?? (workspace as { activeProjectId?: string | null }).activeProjectId ?? null
}

interface ProjectState {
  projects: ProjectMeta[]
  viewingProjectId: string | null
  executingProjectIds: string[]
  recentProjectIds: string[]
  isLoading: boolean
  isSwitching: boolean
  error: string | null

  /** Load the project list + workspace, syncing the viewing project type. */
  fetchProjects: () => Promise<void>
  /** fetchProjects then open the viewing project (cold boot). */
  bootstrap: () => Promise<void>
  /** Open a project: the full faithful cascade (flush → view → reconcile → clearHistory). */
  switchProject: (id: string) => Promise<void>
  /**
   * Listen for `project:viewing` (and legacy `project:activated`) broadcast by
   * the backend when ANOTHER client switches the viewing project, and re-sync
   * this client to it. Also tracks `project:executing` for agent lock badges.
   * Returns an unsubscribe. Wire alongside pipelineStore.subscribeLiveSync at boot.
   */
  subscribeProjectActivation: () => () => void
  /** Create a project then open it. */
  createProject: (input: CreateProjectRequest) => Promise<ProjectMeta>
  /** Delete a project; the server keeps the workspace non-empty + returns it. */
  deleteProject: (id: string, assetPolicy?: 'detach' | 'delete') => Promise<void>
  /** Rename a project. */
  renameProject: (id: string, name: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  viewingProjectId: null,
  executingProjectIds: [],
  recentProjectIds: [],
  isLoading: false,
  isSwitching: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const { api } = getEditorTransport()
      const [projects, workspace] = await Promise.all([api.listProjects(), api.getWorkspace()])
      const viewingProjectId = viewingIdFromWorkspace(workspace)
      set({
        projects: [...projects],
        viewingProjectId,
        executingProjectIds: workspace?.executingProjectIds ?? [],
        recentProjectIds: workspace?.recentProjectIds ?? [],
      })
      const viewing = projects.find((p) => p.id === viewingProjectId)
      useUIStore.getState().setActiveProjectType(viewing?.type ?? null)
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  bootstrap: async () => {
    await get().fetchProjects()
    const viewingId = get().viewingProjectId
    if (viewingId) {
      await get().switchProject(viewingId)
    }
  },

  switchProject: async (id: string) => {
    if (get().isSwitching) return
    // Page refresh: fetchProjects already set viewingProjectId, but the graph /
    // nodeOutputs cache are empty — still run the full open cascade (viewProject,
    // loadPipeline, refreshConnectedOutputs). Skip only when this project is
    // already loaded in memory (user re-clicking the same row in the panel).
    if (id === get().viewingProjectId && usePipelineStore.getState().currentPipeline) return
    set({ isSwitching: true, error: null })
    try {
      const { api } = getEditorTransport()
      const leavingId = get().viewingProjectId
      const agentBusy = get().executingProjectIds.length > 0
      const leavingIsExecuting =
        leavingId != null && get().executingProjectIds.includes(leavingId)

      if (!leavingIsExecuting) {
        try {
          await usePipelineStore.getState().persistSession()
        } catch (e) {
          console.warn('[projectStore] persistSession before switch failed:', e)
        }
      }

      const view = api.viewProject ?? api.activateProject
      if (!view) throw new Error('[projectStore] transport does not support viewProject')
      const { project, pipeline } = await view.call(api, id)

      set({ viewingProjectId: id })
      resetPipelineUiForProjectSwitch()

      if (pipeline) {
        usePipelineStore.getState().hydratePipelineFromSnapshot(pipeline)
      } else {
        await usePipelineStore.getState().loadPipeline()
      }

      refreshOutputsAfterProjectSwitch(agentBusy)
      reloadHistoryAfterProjectSwitch(agentBusy)

      useUIStore.getState().setActiveProjectType(project?.manifest?.type ?? null)

      void api.getWorkspace().then((ws) => {
        set({
          recentProjectIds: ws?.recentProjectIds ?? [],
          executingProjectIds: ws?.executingProjectIds ?? get().executingProjectIds,
        })
      })
    } catch (e) {
      console.error('[projectStore] switchProject failed:', e)
      set({ error: (e as Error).message })
    } finally {
      set({ isSwitching: false })
    }
  },

  subscribeProjectActivation: () => {
    const { ws } = getEditorTransport()
    ws.connect()

    const syncViewingProject = (projectId: string) => {
      if (projectId === get().viewingProjectId) return
      if (get().isSwitching) return
      void (async () => {
        set({ isSwitching: true, error: null })
        try {
          const agentBusy = get().executingProjectIds.length > 0
          set({ viewingProjectId: projectId })
          resetPipelineUiForProjectSwitch()
          await usePipelineStore.getState().loadPipeline()
          refreshOutputsAfterProjectSwitch(agentBusy)
          reloadHistoryAfterProjectSwitch(agentBusy)
          await get().fetchProjects()
        } catch (e) {
          console.error('[projectStore] project:viewing sync failed:', e)
          set({ error: (e as Error).message })
        } finally {
          set({ isSwitching: false })
        }
      })()
    }

    const refreshExecuting = () => {
      void (async () => {
        try {
          const ws = await getEditorTransport().api.getWorkspace()
          if (ws?.executingProjectIds) {
            set({ executingProjectIds: ws.executingProjectIds })
          }
        } catch {
          /* ignore — badge degrades gracefully */
        }
      })()
    }

    const unsubs = [
      ws.on('project:viewing', ({ projectId }) => syncViewingProject(projectId)),
      ws.on('project:activated', ({ projectId }) => syncViewingProject(projectId)),
      ws.on('project:executing', ({ projectId }) => {
        set((s) => ({
          executingProjectIds: s.executingProjectIds.includes(projectId)
            ? s.executingProjectIds
            : [...s.executingProjectIds, projectId],
        }))
        refreshExecuting()
        // aw-support creates projects out-of-band; refresh so the new row appears.
        void get().fetchProjects()
      }),
      ws.on('project:list-changed', () => {
        void get().fetchProjects()
      }),
      // The project list changed elsewhere (an agent created/removed a project
      // via the tool bridge). Refetch so the navigation pane reflects it without
      // a manual reload. Idempotent for the client that made the change locally.
      ws.on('project:created', () => {
        void get().fetchProjects()
      }),
      ws.on('project:deleted', () => {
        void get().fetchProjects()
      }),
      ws.on('project:idle', ({ projectId }) => {
        set((s) => {
          const next = s.executingProjectIds.filter((id) => id !== projectId)
          if (next.length === 0) {
            queueMicrotask(() => {
              cancelDeferredProjectSwitchOutputRefresh()
              void usePipelineStore.getState().refreshConnectedOutputs('project-switch')
            })
          }
          return { executingProjectIds: next }
        })
      }),
    ]
    return () => unsubs.forEach((u) => u())
  },

  createProject: async (input: CreateProjectRequest) => {
    const { api } = getEditorTransport()
    const meta = await api.createProject(input)
    set((s) => ({ projects: [...s.projects, meta] }))
    await get().switchProject(meta.id)
    return meta
  },

  deleteProject: async (id: string, assetPolicy?: 'detach' | 'delete') => {
    const { api } = getEditorTransport()
    const wasViewing = get().viewingProjectId === id
    const res = await api.deleteProject(id, assetPolicy ? { assetPolicy } : undefined)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      recentProjectIds: s.recentProjectIds.filter((rid) => rid !== id),
      executingProjectIds: s.executingProjectIds.filter((eid) => eid !== id),
    }))
    const nextViewing = viewingIdFromWorkspace(res.workspace)
    if (wasViewing && nextViewing) {
      await get().switchProject(nextViewing)
    } else {
      await get().fetchProjects()
    }
  },

  renameProject: async (id: string, name: string) => {
    const { api } = getEditorTransport()
    const meta = await api.updateProject(id, { name })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? meta : p)) }))
  },
}))
