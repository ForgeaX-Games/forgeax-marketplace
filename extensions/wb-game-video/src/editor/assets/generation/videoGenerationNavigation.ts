const PENDING_SELECTION_KEY = 'wb-game-video:pending-video-selection:v1'

export function requestVideoAssetSelection(assetId: string): void {
  if (!assetId || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PENDING_SELECTION_KEY, assetId)
  } catch {
    // Session storage is optional; the generation task itself remains persisted remotely.
  }
}

export function consumeVideoAssetSelection(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const assetId = window.sessionStorage.getItem(PENDING_SELECTION_KEY) ?? undefined
    window.sessionStorage.removeItem(PENDING_SELECTION_KEY)
    return assetId
  } catch {
    return undefined
  }
}
