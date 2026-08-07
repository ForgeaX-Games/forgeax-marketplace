/**
 * ComponentLibrary —— 界面 tab 底部的工作区组件库。
 * 直接读取 components/new 的唯一注册清单，
 * 渲染成可拖拽 chip；拖到画布（OverlayCatalogPreview 的 stage）落地为一个 child。
 * 纯展示：不持有方案数据，落地逻辑在 stage 的 onDrop 里（读 dataTransfer 的组件 id）。
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type JSX,
} from 'react'
import newComponents from '../../runtime/component-host/components/new'
import { injectStyleOnce } from '../../styles/injectStyle'
import { overlayContentAndHitTargets } from './overlay-fit-targets'
import { AiParameterFillButton } from './AiParameterFillButton'

/** 拖拽 MIME：库 chip → 画布落地时用它取组件 id。 */
export const OVERLAY_PRESET_MIME = 'application/x-overlay-preset'
const DRAG_POINTER_OFFSET_X_PX = 20
const DRAG_POINTER_OFFSET_Y_PX = 12

const LIB_CSS = `
.ocl-root {
  display:flex; flex-direction:column; min-width:0; height:100%; color:#d5d5d5;
}
.ocl-toolbar {
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  min-height:42px; padding:0 14px; border-top:1px solid #3a3a3a;
  border-bottom:1px solid #3a3a3a; box-sizing:border-box;
}
.ocl-breadcrumb {
  display:flex; align-items:center; gap:7px; min-width:0; font-size:12px; white-space:nowrap;
}
.ocl-breadcrumb strong { color:#ff9c2a; font-weight:500; }
.ocl-count { color:#777; }
.ocl-breadcrumb span { color:#777; }
.ocl-search {
  flex:0 1 244px; width:244px; height:31px; box-sizing:border-box; border:0; border-radius:5px;
  padding:0 11px 0 31px; color:#d8d8d8; background:#454545;
  font:inherit; outline:none;
  background-image:radial-gradient(circle at 17px 14px, transparent 4px, #969696 4.5px, #969696 5.5px, transparent 6px),
    linear-gradient(45deg, transparent 47%, #969696 48%, #969696 56%, transparent 57%);
  background-size:auto, 7px 7px; background-position:0 0, 19px 18px; background-repeat:no-repeat;
}
.ocl-search::placeholder { color:#8f8f8f; }
.ocl-search:focus { box-shadow:0 0 0 1px #ff9c2a; }
.ocl-grid {
  display:grid; grid-template-columns:repeat(auto-fill, 134px); grid-auto-rows:139px;
  align-content:start; gap:0 12px; min-height:0; padding:8px 14px 16px; overflow:auto;
}
.ocl-card {
  display:flex; flex-direction:column; min-width:0; width:134px; height:139px; padding:7px 0 0; overflow:hidden;
  box-sizing:border-box; border:0; cursor:grab; user-select:none;
  background:transparent; color:#d2d2d2; font:inherit; text-align:center;
  transition:background .12s;
}
.ocl-card:hover { background:transparent; color:#ffc066; }
.ocl-card:active { cursor:grabbing; }
.ocl-preview {
  position:relative; flex:none; width:134px; height:108px; overflow:hidden;
  border-radius:6px; background:rgba(255,255,255,.1);
  transition:background .12s;
}
.ocl-card:hover .ocl-preview { background:rgba(255,255,255,.2); }
.ocl-card[data-library-kind="folder"] .ocl-preview {
  border-radius:0 6px 6px; clip-path:polygon(0 12%,32% 12%,39% 0,100% 0,100% 100%,0 100%);
}
.ocl-ai-slot {
  position:absolute; z-index:2; top:4px; right:4px; display:block;
  width:18px; height:18px; visibility:hidden;
}
.ocl-preview:hover .ocl-ai-slot { visibility:visible; }
.ocl-ai-quick { pointer-events:auto; }
.ocl-ai-quick img { display:block; width:18px; height:18px; }
.ocl-render-stage {
  position:absolute; left:0; top:0; width:640px; height:360px; container-type:size;
  transform-origin:0 0; pointer-events:none;
}
.ocl-render-stage, .ocl-render-stage * {
  pointer-events:none !important;
}
.ocl-name {
  flex:none; height:24px; padding:0 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:10px; line-height:24px;
}
.ocl-empty { padding:24px 14px; color:#888; font-size:11px; }
.ocl-drag-image {
  position:fixed; left:0; top:0; z-index:2147483647; overflow:hidden;
  background:transparent; pointer-events:none;
}
`

const PREVIEW_INPUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  Dialogue: { speaker: '角色', text: '示例对白' },
}

function previewProps(
  componentId: string,
  inputs: readonly { key: string; default?: unknown }[],
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
    inputs
      .filter((input) => input.default !== undefined)
      .map((input) => [input.key, input.default]),
    ),
    ...PREVIEW_INPUT_OVERRIDES[componentId],
  }
}

type PreviewBox = {
  left: number
  top: number
  width: number
  height: number
  previewWidth: number
  previewHeight: number
}

function ComponentCard({
  component,
  id,
  label,
  inputs,
}: {
  component: ComponentType<Record<string, unknown>>
  id: string
  label: string
  inputs: readonly { key: string; default?: unknown }[]
}): JSX.Element {
  const previewRef = useRef<HTMLSpanElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const dragImageRef = useRef<HTMLElement | null>(null)
  const nativeDragImageRef = useRef<HTMLCanvasElement | null>(null)
  const [box, setBox] = useState<PreviewBox | null>(null)
  const props = useMemo(() => previewProps(id, inputs), [id, inputs])
  const Preview = component

  useLayoutEffect(() => {
    const preview = previewRef.current
    const stage = stageRef.current
    if (!preview || !stage) return
    const measure = (): void => {
      const stageRect = stage.getBoundingClientRect()
      const previewRect = preview.getBoundingClientRect()
      const scaleX = stageRect.width / 640 || 1
      const scaleY = stageRect.height / 360 || scaleX
      const targets = overlayContentAndHitTargets(stage)
      const rects = targets.map((target) => target.getBoundingClientRect()).filter((rect) => rect.width && rect.height)
      if (!rects.length) return
      const left = (Math.min(...rects.map((rect) => rect.left)) - stageRect.left) / scaleX
      const top = (Math.min(...rects.map((rect) => rect.top)) - stageRect.top) / scaleY
      const right = (Math.max(...rects.map((rect) => rect.right)) - stageRect.left) / scaleX
      const bottom = (Math.max(...rects.map((rect) => rect.bottom)) - stageRect.top) / scaleY
      const next = {
        left,
        top,
        width: right - left,
        height: bottom - top,
        previewWidth: previewRect.width,
        previewHeight: previewRect.height,
      }
      setBox((current) =>
        current
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.top - next.top) < 0.5
        && Math.abs(current.width - next.width) < 0.5
        && Math.abs(current.height - next.height) < 0.5
        && Math.abs(current.previewWidth - next.previewWidth) < 0.5
        && Math.abs(current.previewHeight - next.previewHeight) < 0.5
          ? current
          : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(preview)
    stage.addEventListener('load', measure, true)
    return () => {
      observer?.disconnect()
      stage.removeEventListener('load', measure, true)
    }
  }, [])

  const scale = box
    ? Math.min((box.previewWidth - 8) / box.width, (box.previewHeight - 6) / box.height)
    : 0.2
  const transform = box
    ? `translate(${box.previewWidth / 2 - (box.left + box.width / 2) * scale}px, ${box.previewHeight / 2 - (box.top + box.height / 2) * scale}px) scale(${scale})`
    : 'translate(-274px, -150px) scale(.2)'

  const clearDragImage = (): void => {
    dragImageRef.current?.remove()
    nativeDragImageRef.current?.remove()
    dragImageRef.current = null
    nativeDragImageRef.current = null
  }

  const moveDragImage = (clientX: number, clientY: number): void => {
    const ghost = dragImageRef.current
    if (!ghost || (clientX === 0 && clientY === 0)) return
    ghost.style.left = `${Math.round(clientX + DRAG_POINTER_OFFSET_X_PX)}px`
    ghost.style.top = `${Math.round(clientY + DRAG_POINTER_OFFSET_Y_PX)}px`
  }

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(OVERLAY_PRESET_MIME, id)
    event.dataTransfer.setData('text/plain', label)
    event.dataTransfer.effectAllowed = 'copy'
    const stage = stageRef.current
    if (!stage || !box) return
    clearDragImage()
    const ghost = document.createElement('div')
    ghost.className = 'ocl-drag-image'
    ghost.style.width = `${Math.max(1, Math.round(box.width))}px`
    ghost.style.height = `${Math.max(1, Math.round(box.height))}px`
    const clone = stage.cloneNode(true) as HTMLElement
    clone.style.transform = `translate(${-box.left}px, ${-box.top}px)`
    ghost.appendChild(clone)
    document.body.appendChild(ghost)
    dragImageRef.current = ghost
    moveDragImage(event.clientX, event.clientY)
    const transparentDragImage = document.createElement('canvas')
    transparentDragImage.width = 1
    transparentDragImage.height = 1
    transparentDragImage.style.position = 'fixed'
    transparentDragImage.style.left = '0'
    transparentDragImage.style.top = '0'
    transparentDragImage.style.pointerEvents = 'none'
    transparentDragImage.getContext('2d')?.fillRect(0, 0, 1, 1)
    document.body.appendChild(transparentDragImage)
    nativeDragImageRef.current = transparentDragImage
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0)
  }

  return (
    <div
      className="ocl-card"
      draggable
      onDragStart={onDragStart}
      onDrag={(event) => moveDragImage(event.clientX, event.clientY)}
      onDragEnd={clearDragImage}
      title={`拖到画布添加：${label}（${id}）`}
      data-component-id={id}
    >
      <span ref={previewRef} className="ocl-preview" aria-hidden>
        <span
          ref={stageRef}
          className="ocl-render-stage"
          style={{ transform, visibility: box ? 'visible' : 'hidden' }}
        >
          <Preview {...props} preview previewTimeMs={400} />
        </span>
        <span className="ocl-ai-slot">
          <AiParameterFillButton className="ocl-ai-quick" />
        </span>
      </span>
      <span className="ocl-name">{label}</span>
    </div>
  )
}

export function ComponentLibrary(): JSX.Element {
  injectStyleOnce('overlay-component-library', LIB_CSS)
  const [query, setQuery] = useState('')
  const components = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return newComponents
    return newComponents.filter(({ manifest }) => {
      const id = manifest.id
      const label = manifest.label ?? id
      return `${label} ${id}`.toLocaleLowerCase().includes(needle)
    })
  }, [query])

  return (
    <div className="ocl-root" data-testid="component-library">
      <div className="ocl-toolbar">
        <div className="ocl-breadcrumb" aria-label="组件库路径">
          <strong>控件库</strong>
          <span className="ocl-count">（{newComponents.length}）</span>
          <span aria-hidden>›</span>
          <span>游戏组件</span>
        </div>
        <input
          className="ocl-search"
          type="search"
          aria-label="搜索控件"
          placeholder="搜索控件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="ocl-grid">
        {components.map(({ component, manifest }) => {
          const id = manifest.id
          const label = manifest.label ?? id
          return (
            <ComponentCard
              key={id}
              component={component as ComponentType<Record<string, unknown>>}
              id={id}
              label={label}
              inputs={manifest.inputs ?? []}
            />
          )
        })}
        {components.length === 0 ? <div className="ocl-empty">没有匹配的组件</div> : null}
      </div>
    </div>
  )
}
