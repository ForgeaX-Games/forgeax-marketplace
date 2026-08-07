import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkbenchFrame } from '@forgeax/workbench-host/react'
import type { WorkbenchSessionContext } from '@forgeax/workbench-host/contracts'
import {
  createDevSessionContext,
  DEFAULT_DEV_GAME_ID,
  DEV_WORKBENCH_BASE,
  normalizeDevGameId,
  selectDevRuntime,
} from './dev-host-session'
import './dev-host-shell.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; context: WorkbenchSessionContext }
  | { kind: 'error'; message: string }

function initialGameId(): string {
  try {
    return normalizeDevGameId(new URLSearchParams(location.search).get('gameId') ?? DEFAULT_DEV_GAME_ID)
  } catch {
    return DEFAULT_DEV_GAME_ID
  }
}

function preferredTheme(): 'light' | 'dark' {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

async function loadContext(gameId: string, signal: AbortSignal): Promise<WorkbenchSessionContext> {
  const response = await fetch(`${DEV_WORKBENCH_BASE}/catalog?gameId=${encodeURIComponent(gameId)}`, { signal })
  if (!response.ok) throw new Error(`Development host catalog failed (${response.status})`)
  const entry = selectDevRuntime(await response.json())
  return createDevSessionContext(entry, gameId, {
    locale: navigator.language,
    theme: preferredTheme(),
  })
}

function DevHostShell(): JSX.Element {
  const [draftGameId, setDraftGameId] = useState(initialGameId)
  const [gameId, setGameId] = useState(initialGameId)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const runtimeUrl = useMemo(() => '/?devRuntime=1', [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void loadContext(gameId, controller.signal).then(
      (context) => setState({ kind: 'ready', context }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      },
    )
    return () => controller.abort()
  }, [gameId, frameEpoch])

  const openGame = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const nextGameId = normalizeDevGameId(draftGameId)
      const url = new URL(location.href)
      url.searchParams.set('gameId', nextGameId)
      history.replaceState(null, '', url)
      setDraftGameId(nextGameId)
      if (nextGameId === gameId) setFrameEpoch((value) => value + 1)
      else setGameId(nextGameId)
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <main className="dev-host-shell">
      <header className="dev-host-toolbar">
        <strong className="dev-host-brand">wb-game-video</strong>
        <span className="dev-host-separator" aria-hidden="true" />
        <form className="dev-host-game-form" onSubmit={openGame}>
          <label htmlFor="dev-host-game-id">Game</label>
          <input
            id="dev-host-game-id"
            value={draftGameId}
            onChange={(event) => setDraftGameId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit">Open</button>
        </form>
        <span className="dev-host-mode">Local host</span>
      </header>
      <section className="dev-host-runtime" aria-live="polite">
        {state.kind === 'loading' && <p className="dev-host-status">Loading...</p>}
        {state.kind === 'error' && <p className="dev-host-status is-error" role="alert">{state.message}</p>}
        {state.kind === 'ready' && (
          <WorkbenchFrame
            key={`${state.context.runtimeId}:${state.context.gameId}:${frameEpoch}`}
            className="dev-host-frame"
            title={`wb-game-video - ${state.context.gameId}`}
            runtimeUrl={runtimeUrl}
            context={state.context}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
            allow="autoplay; clipboard-read; clipboard-write; fullscreen"
          />
        )}
      </section>
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount point')
createRoot(root).render(<DevHostShell />)
