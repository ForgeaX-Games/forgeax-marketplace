import { useSyncExternalStore } from 'react'

import type {
  SceneScriptDiagnostic,
  SceneScriptSourceMapEntry,
} from '../api/HttpApiClient.js'

const STORAGE_KEY = 'wb-scene-generator.scene-script-diagnostics'
const CHANGE_EVENT = 'wb-scene-generator:scene-script-diagnostics'

export interface SceneScriptDiagnosticIndex {
  projectId: string
  entries: Array<{
    statementId: string
    entityIds: string[]
    codes: string[]
  }>
}

const EMPTY_INDEX: SceneScriptDiagnosticIndex = { projectId: '', entries: [] }

function readStoredIndex(): SceneScriptDiagnosticIndex {
  if (typeof localStorage === 'undefined') return EMPTY_INDEX
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SceneScriptDiagnosticIndex | null
    return parsed?.projectId && Array.isArray(parsed.entries) ? parsed : EMPTY_INDEX
  } catch {
    return EMPTY_INDEX
  }
}

let currentIndex = readStoredIndex()

export function publishSceneScriptDiagnostics(
  projectId: string,
  diagnostics: readonly SceneScriptDiagnostic[],
  sourceMap: readonly SceneScriptSourceMapEntry[],
): void {
  const codesByStatement = new Map<string, string[]>()
  for (const diagnostic of diagnostics.slice(0, 3)) {
    const statementId =
      diagnostic.graph?.authoringNodeId ??
      diagnostic.source?.statementId ??
      diagnostic.statementId
    if (!statementId) continue
    const codes = codesByStatement.get(statementId) ?? []
    if (!codes.includes(diagnostic.code)) codes.push(diagnostic.code)
    codesByStatement.set(statementId, codes)
  }
  currentIndex = {
    projectId,
    entries: [...codesByStatement].map(([statementId, codes]) => {
      const sourceEntry = sourceMap.find((entry) => entry.statementId === statementId)
      return {
        statementId,
        codes,
        entityIds: sourceEntry
          ? [...new Set([sourceEntry.entityId, ...sourceEntry.runtimeNodeIds])]
          : [],
      }
    }),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIndex))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Diagnostics remain available in this frame even when storage is disabled.
  }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const refresh = (): void => {
    currentIndex = readStoredIndex()
    listener()
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener('storage', refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener('storage', refresh)
  }
}

function getSnapshot(): SceneScriptDiagnosticIndex {
  return currentIndex
}

export function useSceneScriptDiagnosticCodes(
  projectId: string | null,
  entityId: string | null,
): string[] {
  const index = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_INDEX)
  if (!projectId || !entityId || index.projectId !== projectId) return []
  return index.entries.find((entry) => entry.entityIds.includes(entityId))?.codes ?? []
}
