import { useRef, useState } from 'react'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 通用 Media Dropzone —— 把外部生成（midjourney / sora / kling）的图像/视频拖回工程。
 *
 * 用法：
 *   <MediaDropzone accept="image" onFile={(f) => ...} />
 *   <MediaDropzone accept="video" />
 *   <MediaDropzone accept="any" />
 *
 * 设计：
 *   - 极薄 dashed 边框，hover 金色发光
 *   - 把文件 + base64 dataUrl 同时回调，调用方决定怎么入仓
 */

export type DropzoneAccept = 'image' | 'video' | 'any'

interface Props {
  accept: DropzoneAccept
  /** 文件接收回调；可选拿到 dataUrl（异步读完后再触发；图像/小视频可用） */
  onFile: (info: { file: File; dataUrl?: string }) => void
  /** UI 文案 */
  hint?: string
  compact?: boolean
}

export function MediaDropzone({ accept, onFile, hint, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [last, setLast] = useState<string | null>(null)

  const acceptAttr =
    accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : 'image/*,video/*'

  async function handleFile(file: File): Promise<void> {
    setLast(`${file.name} · ${formatBytes(file.size)}`)

    const isImage = file.type.startsWith('image/')
    const isVideoSmall = file.type.startsWith('video/') && file.size <= 32 * 1024 * 1024
    let dataUrl: string | undefined
    if (isImage || isVideoSmall) {
      dataUrl = await new Promise<string | undefined>((resolve) => {
        const fr = new FileReader()
        fr.onerror = () => resolve(undefined)
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : undefined)
        fr.readAsDataURL(file)
      })
    }
    onFile({ file, dataUrl })
  }

  return (
    <>
      <div
        className={`ks-mdz ${over ? 'is-over' : ''} ${compact ? 'is-compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) void handleFile(f)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="ks-mdz-icon">
          {accept === 'video' ? '▶' : accept === 'image' ? '◧' : '⌖'}
        </div>
        <div className="ks-mdz-title">
          {hint ?? (accept === 'video' ? '拖入视频 / 点击选择' : '拖入图像 / 点击选择')}
        </div>
        <div className="ks-mdz-hint ks-mono">
          {accept === 'video' ? 'MP4 · MOV · WEBM' :
           accept === 'image' ? 'PNG · JPG · WEBP' :
           '图像 / 视频'}
        </div>
        {last && <div className="ks-mdz-last ks-mono">已加载 · {last}</div>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />

    </>
  )
}

const mdzCss = `
.ks-mdz {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px;
  height: 104px;
  border: 1.5px dashed var(--ks-border-strong);
  border-radius: var(--ks-radius-lg);
  background:
    repeating-linear-gradient(45deg, transparent 0 8px, rgba(255, 123, 61, 0.04) 8px 9px),
    var(--ks-panel-elev);
  cursor: pointer;
  color: var(--ks-text-soft);
  font-family: var(--ks-font-ui);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-mdz.is-compact { height: 80px; }
.ks-mdz:hover, .ks-mdz.is-over {
  border-color: var(--ks-amber);
  color: var(--ks-amber);
  background:
    repeating-linear-gradient(45deg, transparent 0 8px, rgba(255, 123, 61, 0.1) 8px 9px),
    var(--ks-amber-soft);
  box-shadow: var(--ks-shadow-soft);
}
.ks-mdz-icon {
  font-size: 22px;
  line-height: 1;
  color: currentColor;
}
.ks-mdz-title { font-size: 13px; font-weight: 500; }
.ks-mdz-hint { font-size: 10.5px; letter-spacing: 0.04em; font-weight: 500; }
.ks-mdz-last {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.02em;
  color: var(--ks-mint);
  word-break: break-all;
  padding: 0 10px;
  text-align: center;
  font-weight: 600;
}
`
injectStyleOnce('media-dropzone', mdzCss)

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
