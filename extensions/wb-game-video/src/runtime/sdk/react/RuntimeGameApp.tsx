import { useEffect, useMemo, useState } from 'react'
import { loadGameComponents, registerBuiltins } from '../../component-host'
import { GamePlayer } from '../../play'
import { createAssetResolver } from '../client/asset-resolver'
import {
  fetchGamePackage,
  GamePackageError,
  readGameId,
  type RuntimeGamePackage,
} from '../client/game-package-client'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; gameId: string; gamePackage: RuntimeGamePackage }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  if (error instanceof GamePackageError) return error.message
  if (error instanceof Error) return error.message
  return 'Unable to start game'
}

async function bootRuntimeComponents(gameId: string, signal: AbortSignal): Promise<void> {
  registerBuiltins()
  try {
    const response = await fetch(`/__gva__/components-status?game=${encodeURIComponent(gameId)}`, { signal })
    const status = response.ok ? await response.json() as { available?: boolean } : null
    if (status?.available) await loadGameComponents(gameId)
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error
  }
}

export function RuntimeGameApp(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const gameId = readGameId()
        const gamePackage = await fetchGamePackage(gameId, controller.signal)
        await bootRuntimeComponents(gameId, controller.signal)
        if (!controller.signal.aborted) setState({ status: 'ready', gameId, gamePackage })
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
      }
    })()
    return () => controller.abort()
  }, [])

  const resolveAsset = useMemo(
    () => state.status === 'ready' ? createAssetResolver(state.gamePackage.assetsManifest) : undefined,
    [state],
  )

  if (state.status === 'loading') {
    return <main className="sdk-status" aria-live="polite">Loading game...</main>
  }
  if (state.status === 'error') {
    return <main className="sdk-status sdk-status--error" role="alert">{state.message}</main>
  }

  return (
    <main className="sdk-player">
      <GamePlayer
        scenario={state.gamePackage.blueprint}
        game={state.gameId}
        resolveAsset={resolveAsset!}
      />
    </main>
  )
}
