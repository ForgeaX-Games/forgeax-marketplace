/**
 * 同一 clip 只触发一次 performanceEnd。
 *
 * durationMs 作上限时，`<video onTimeUpdate>` 在 cap 之后仍会连打；若不闸门，
 * 每次 setSnap 都会重渲染，叠层内联 emit 换身份，限时默认选项计时被反复重置。
 */
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { GraphSession, SessionSnapshot } from '../../runtime/engine/session'

export function useClipPerformanceEnd(
  sessionRef: RefObject<GraphSession | null>,
  setSnap: Dispatch<SetStateAction<SessionSnapshot | null>> | Dispatch<SetStateAction<SessionSnapshot>>,
  clipNodeId: string | undefined,
  /** session 重建（重开）时清闸，避免同 nodeId 二次开演被误拦。 */
  resetKey?: number | string,
): () => void {
  const endedForRef = useRef<string | null>(null)
  useEffect(() => {
    endedForRef.current = null
  }, [clipNodeId, resetKey])

  return useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    const nodeId = session.runtime.state.currentNodeId
    if (!nodeId || endedForRef.current === nodeId) return
    endedForRef.current = nodeId
    setSnap(session.performanceEnd())
  }, [sessionRef, setSnap])
}
