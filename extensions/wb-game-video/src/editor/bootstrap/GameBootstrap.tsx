import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { WorkbenchClientError } from '@forgeax/workbench-host/extension'
import { useT } from '../../i18n'
import { getWorkbenchHost } from '../../lib/workbench-host'

type PackageState = 'uninitialized' | 'initialized' | 'inconsistent'
type PackageStatus = { state: PackageState; missing?: string[] }
type PackageError = { code?: string; target?: string; hint?: string; retryable?: boolean }

export interface GameBootstrapProps {
  onBoot: (gameId: string) => void | Promise<void>
  children: ReactNode
}

type BootstrapState =
  | { kind: 'loading' }
  | { kind: 'guide' }
  | { kind: 'dismissed' }
  | { kind: 'ready' }
  | { kind: 'inconsistent'; missing: string[] }
  | { kind: 'error'; error: PackageError; retry: 'status' | 'initialize' }

function statusOf(value: unknown): PackageStatus | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { state?: unknown; missing?: unknown }
  if (
    candidate.state !== 'uninitialized'
    && candidate.state !== 'initialized'
    && candidate.state !== 'inconsistent'
  ) return null
  return {
    state: candidate.state,
    missing: Array.isArray(candidate.missing)
      ? candidate.missing.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}

function packageError(cause: unknown, target: string): PackageError {
  if (cause instanceof WorkbenchClientError) {
    return {
      code: cause.code,
      target: cause.target,
      hint: cause.message,
      retryable: cause.retryable,
    }
  }
  return {
    target,
    hint: cause instanceof Error ? cause.message : String(cause),
    retryable: true,
  }
}

export function GameBootstrap({ onBoot, children }: GameBootstrapProps): JSX.Element | null {
  const t = useT()
  const [state, setState] = useState<BootstrapState>({ kind: 'loading' })
  const onBootRef = useRef(onBoot)
  const mountedRef = useRef(true)
  const statusRunRef = useRef(0)

  useEffect(() => {
    onBootRef.current = onBoot
  }, [onBoot])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const bootExisting = useCallback(async (
    gameId: string,
    isCurrent: () => boolean = () => mountedRef.current,
  ) => {
    await onBootRef.current(gameId)
    if (isCurrent()) setState({ kind: 'ready' })
  }, [])

  const readStatus = useCallback(async () => {
    if (!mountedRef.current) return
    const statusRun = ++statusRunRef.current
    const isCurrentRun = () => mountedRef.current && statusRunRef.current === statusRun
    setState({ kind: 'loading' })
    let errorTarget = 'package status'
    try {
      const host = getWorkbenchHost()
      const context = await host.ready()
      if (!isCurrentRun()) return
      const status = statusOf(await host.gamePackage.status())
      if (!isCurrentRun()) return
      if (status?.state === 'initialized') {
        errorTarget = 'package'
        await bootExisting(context.gameId, isCurrentRun)
      }
      else if (status?.state === 'inconsistent') setState({ kind: 'inconsistent', missing: status.missing ?? [] })
      else if (status?.state === 'uninitialized') setState({ kind: 'guide' })
      else setState({ kind: 'error', retry: 'status', error: { target: 'package status', hint: 'Invalid package status', retryable: true } })
    } catch (cause) {
      if (!isCurrentRun()) return
      setState({ kind: 'error', retry: 'status', error: packageError(cause, errorTarget) })
    }
  }, [bootExisting])

  useEffect(() => { void readStatus() }, [readStatus])

  const initialize = async () => {
    if (!mountedRef.current) return
    setState({ kind: 'loading' })
    try {
      const host = getWorkbenchHost()
      const context = await host.ready()
      const status = statusOf(await host.gamePackage.initialize())
      if (!mountedRef.current) return
      if (status?.state === 'initialized') await bootExisting(context.gameId)
      else if (status?.state === 'inconsistent') setState({ kind: 'inconsistent', missing: status.missing ?? [] })
      else setState({ kind: 'error', retry: 'initialize', error: { target: 'package', hint: 'Invalid package status', retryable: true } })
    } catch (cause) {
      if (!mountedRef.current) return
      setState({ kind: 'error', retry: 'initialize', error: packageError(cause, 'package') })
    }
  }

  if (state.kind === 'ready') return <>{children}</>
  if (state.kind === 'loading') return <section className="ga-bootstrap" aria-live="polite"><p>{t('bootstrap.checking')}</p></section>
  if (state.kind === 'dismissed') return null
  if (state.kind === 'inconsistent') {
    return <section className="ga-bootstrap" role="alert"><h1>{t('bootstrap.inconsistent.title')}</h1><p>{t('bootstrap.inconsistent.missing')} {state.missing.join(', ') || t('bootstrap.inconsistent.requiredFiles')}</p><p>{t('bootstrap.inconsistent.fix')}</p></section>
  }
  if (state.kind === 'error') {
    const { error } = state
    return <section className="ga-bootstrap" role="alert"><h1>{t('bootstrap.failed.title')}</h1><p>{t('bootstrap.failed.target')} {error.target ?? t('bootstrap.failed.workspace')}</p><p>{error.hint ?? t('bootstrap.failed.noDetails')}</p>{error.retryable !== false && <button type="button" onClick={() => void (state.retry === 'status' ? readStatus() : initialize())}>{t('bootstrap.retry')}</button>}</section>
  }
  return <section className="ga-bootstrap" aria-labelledby="ga-bootstrap-title">
    <h1 id="ga-bootstrap-title">{t('bootstrap.guide.title')}</h1>
    <p>{t('bootstrap.guide.description')}</p>
    <div className="ga-bootstrap-actions">
      <button type="button" onClick={() => void initialize()}>{t('bootstrap.guide.yes')}</button>
      <button type="button" onClick={() => setState({ kind: 'dismissed' })}>{t('bootstrap.guide.no')}</button>
    </div>
  </section>
}
