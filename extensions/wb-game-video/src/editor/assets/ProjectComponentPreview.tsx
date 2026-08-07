import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import type { ProjectComponentAsset } from './project-component-assets'

function defaultInputs(component: ProjectComponentAsset): Record<string, unknown> {
  return Object.fromEntries(
    (component.manifest.inputs ?? [])
      .filter((input) => input.default !== undefined)
      .map((input) => [input.key, input.default]),
  )
}

function previewTimeFor(component: ProjectComponentAsset): number {
  const duration = component.manifest.inputs?.find((input) => input.key === 'durationMs')?.default
  return typeof duration === 'number' && duration > 0 ? Math.round(duration * 0.4) : 500
}

class PreviewErrorBoundary extends Component<{ fallback: ReactNode, children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function ProjectComponentPreview({
  component,
  variant,
}: {
  component: ProjectComponentAsset
  variant: 'card' | 'folder' | 'detail'
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(variant === 'detail')
  const inputs = useMemo(() => defaultInputs(component), [component])
  const previewTimeMs = useMemo(() => previewTimeFor(component), [component])
  useEffect(() => {
    if (visible || variant === 'detail' || !hostRef.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(hostRef.current)
    return () => observer.disconnect()
  }, [variant, visible])

  const Renderer = component.renderer
  return <div ref={hostRef} className={`alx-component-preview is-${variant}`} aria-label={`${component.manifest.label ?? component.componentId} 预览`}>
    <div className="alx-component-preview-stage">
      {visible ? <PreviewErrorBoundary fallback={<span className="alx-component-preview-fallback">◇</span>}>
        <Renderer {...inputs} preview previewTimeMs={previewTimeMs} previewPlaying={false} emit={() => {}} />
      </PreviewErrorBoundary> : <span className="alx-component-preview-fallback">◇</span>}
    </div>
  </div>
}
