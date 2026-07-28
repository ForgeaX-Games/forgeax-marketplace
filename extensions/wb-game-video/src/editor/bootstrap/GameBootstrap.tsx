import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { pluginFetch } from '../../lib/plugin-http'

type PackageState = 'uninitialized' | 'initialized' | 'inconsistent'
type PackageStatus = { state: PackageState; missing?: string[] }
type PackageError = { code?: string; target?: string; hint?: string; retryable?: boolean }

export interface GameBootstrapProps {
  slug: string
  onBoot: () => void
  children: ReactNode
}

type BootstrapState =
  | { kind: 'loading' }
  | { kind: 'guide' }
  | { kind: 'dismissed' }
  | { kind: 'ready' }
  | { kind: 'inconsistent'; missing: string[] }
  | { kind: 'error'; error: PackageError }

function statusUrl(slug: string): string {
  return `/api/game-host/games/${encodeURIComponent(slug)}/package/status`
}

function initializeUrl(slug: string): string {
  return `/api/game-host/games/${encodeURIComponent(slug)}/package/initialize`
}

export function GameBootstrap({ slug, onBoot, children }: GameBootstrapProps): JSX.Element | null {
  const t = useT()
  const [state, setState] = useState<BootstrapState>({ kind: 'loading' })

  const bootExisting = useCallback(() => {
    setState({ kind: 'ready' })
    onBoot()
  }, [onBoot])

  const readStatus = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await pluginFetch(statusUrl(slug))
      const body = (await response.json()) as PackageStatus & { error?: PackageError }
      if (body.state === 'initialized') bootExisting()
      else if (body.state === 'inconsistent') setState({ kind: 'inconsistent', missing: body.missing ?? [] })
      else if (body.state === 'uninitialized') setState({ kind: 'guide' })
      else setState({ kind: 'error', error: body.error ?? { target: 'package', hint: `HTTP ${response.status}`, retryable: true } })
    } catch (cause) {
      setState({ kind: 'error', error: { target: 'package status', hint: String(cause), retryable: true } })
    }
  }, [bootExisting, slug])

  useEffect(() => { void readStatus() }, [readStatus])

  const initialize = async () => {
    setState({ kind: 'loading' })
    try {
      const response = await pluginFetch(initializeUrl(slug), { method: 'POST' })
      const body = (await response.json()) as PackageStatus & { error?: PackageError }
      if (body.state === 'initialized') bootExisting()
      else if (body.state === 'inconsistent') setState({ kind: 'inconsistent', missing: body.missing ?? [] })
      else setState({ kind: 'error', error: body.error ?? { target: 'package', hint: `HTTP ${response.status}`, retryable: true } })
    } catch (cause) {
      setState({ kind: 'error', error: { target: 'package', hint: String(cause), retryable: true } })
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
    return <section className="ga-bootstrap" role="alert"><h1>{t('bootstrap.failed.title')}</h1><p>{t('bootstrap.failed.target')} {error.target ?? t('bootstrap.failed.workspace')}</p><p>{error.hint ?? t('bootstrap.failed.noDetails')}</p>{error.retryable !== false && <button type="button" onClick={() => void initialize()}>{t('bootstrap.retry')}</button>}</section>
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
