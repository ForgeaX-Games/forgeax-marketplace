import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useT } from '../../../i18n'
import { injectStyleOnce } from '../../../styles/injectStyle'
import type { ClipGenState } from './useClipGeneration'
import type {
  ClipGenerationRequest,
  KinoVideoResolution,
  KinoVideoSize,
  VideoGenerationTask,
} from './generation-api'
import {
  VgenImagePicker,
  type VgenImageAsset,
} from './VgenImagePicker'
import { VGEN_CSS } from './vgenStyles'

injectStyleOnce('wb-game-video-vgen', VGEN_CSS)

export type VideoGenerationMode = ClipGenerationRequest['mode']

export interface RecentGeneratedClip {
  id: string
  label: string
  createdAt: number
  status: 'generating' | 'ready' | 'failed'
  posterUrl?: string
  playbackUrl?: string
}

export interface VideoGenSheetProps {
  open: boolean
  /** `sheet` keeps the existing overlay; `page` renders the same form in a route view. */
  variant?: 'sheet' | 'page'
  gameSlug: string
  imageAssets: readonly VgenImageAsset[]
  recentClips: readonly RecentGeneratedClip[]
  genState: ClipGenState
  availableModels?: readonly string[]
  onSubmit: (request: ClipGenerationRequest) => void
  onCancel: () => void
  onTrack: (generationId: string) => void
  onClose: () => void
  onLocateAsset: (assetId: string) => void
}

type PickerTarget = 'first' | 'last' | 'reference'
type ValidationErrors = Partial<Record<'prompt' | 'frames' | 'first' | 'references', string>>

const RUNNING_PHASES = new Set<ClipGenState['phase']>(['submitting', 'generating'])
const EMPTY_MODELS: readonly string[] = []
const DEFAULT_SIZE: KinoVideoSize = '2560x1440'
const DEFAULT_RESOLUTION: KinoVideoResolution = '720p'
const SIZE_OPTIONS: readonly {
  value: KinoVideoSize
  labelKey: string
  pixels: string
}[] = [
  { value: '2560x1440', labelKey: 'videoAssets.generate.ratio16x9', pixels: '2560×1440' },
  { value: '1440x2560', labelKey: 'videoAssets.generate.ratio9x16', pixels: '1440×2560' },
  { value: '2496x1664', labelKey: 'videoAssets.generate.ratio3x2', pixels: '2496×1664' },
  { value: '1664x2496', labelKey: 'videoAssets.generate.ratio2x3', pixels: '1664×2496' },
]

export function VideoGenSheet({
  open,
  variant = 'sheet',
  gameSlug,
  imageAssets,
  recentClips,
  genState,
  availableModels = EMPTY_MODELS,
  onSubmit,
  onCancel,
  onTrack,
  onClose,
  onLocateAsset,
}: VideoGenSheetProps): JSX.Element | null {
  const t = useT()
  const titleId = useId()
  const subtitleId = useId()
  const promptId = useId()
  const modeId = useId()
  const durationId = useId()
  const ratioId = useId()
  const resolutionId = useId()
  const outputPxId = useId()
  const audioId = useId()
  const modelId = useId()
  const [mode, setMode] = useState<VideoGenerationMode>('strict')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(8)
  const [generateAudio, setGenerateAudio] = useState(false)
  const [size, setSize] = useState<KinoVideoSize>(DEFAULT_SIZE)
  const [resolution, setResolution] = useState<KinoVideoResolution>(DEFAULT_RESOLUTION)
  const [model, setModel] = useState('')
  const [firstFrame, setFirstFrame] = useState<VgenImageAsset | null>(null)
  const [lastFrame, setLastFrame] = useState<VgenImageAsset | null>(null)
  const [references, setReferences] = useState<VgenImageAsset[]>([])
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [closeNotice, setCloseNotice] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const running = RUNNING_PHASES.has(genState.phase)
  const hostManaged = true
  const durationMax = 15
  const modelOptions = useMemo(
    () => [...new Set(availableModels.map((value) => value.trim()).filter(Boolean))],
    [availableModels],
  )
  const defaultModel = modelOptions[0] ?? ''

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setMode('strict')
    setDuration(8)
    setGenerateAudio(false)
    setSize(DEFAULT_SIZE)
    setResolution(DEFAULT_RESOLUTION)
    setModel(defaultModel)
    setErrors({})
    setPickerTarget(null)
    setCloseNotice(null)
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [defaultModel, open])

  useEffect(() => {
    setDuration((current) => Math.min(15, current))
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || pickerTarget !== null) return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const selectedResult = useMemo(
    () => {
      const resultId = genState.assetId ?? genState.resourceId
      return resultId ? recentClips.find((clip) => clip.id === resultId) : undefined
    },
    [genState.assetId, genState.resourceId, recentClips],
  )
  const recent = useMemo(
    () => [...recentClips].sort((left, right) => right.createdAt - left.createdAt).slice(0, 5),
    [recentClips],
  )
  const otherActiveTasks = useMemo(
    () => (genState.activeTasks ?? []).filter(
      (task) => task.generationId !== genState.generationId,
    ),
    [genState.activeTasks, genState.generationId],
  )

  function requestClose(): void {
    if (running) {
      setCloseNotice(t('videoAssets.generate.subtitleRunning'))
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = window.setTimeout(() => setCloseNotice(null), 3500)
    }
    onClose()
  }

  if (!open) {
    return closeNotice ? <div className="vgen-toast" role="status">{closeNotice}</div> : null
  }

  const onPickImage = (asset: VgenImageAsset): void => {
    if (pickerTarget === 'first') {
      setFirstFrame(asset)
      setErrors((current) => ({ ...current, frames: undefined, first: undefined }))
    } else if (pickerTarget === 'last') {
      setLastFrame(asset)
      setErrors((current) => ({ ...current, frames: undefined }))
    } else if (pickerTarget === 'reference') {
      setReferences((current) => {
        if (current.length >= 9 || current.some((item) => item.id === asset.id)) return current
        return [...current, asset]
      })
      setErrors((current) => ({ ...current, references: undefined }))
    }
    setPickerTarget(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (running) return
    const nextErrors: ValidationErrors = {}
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) nextErrors.prompt = t('videoAssets.generate.validation.needPrompt')
    if (mode === 'strict' && (!firstFrame || !lastFrame)) {
      nextErrors.frames = t('videoAssets.generate.validation.needFirstLast')
    }
    if (mode === 'firstref' && !firstFrame) {
      nextErrors.first = t('videoAssets.generate.validation.needFirst')
    }
    if (mode === 'ref' && references.length === 0) {
      nextErrors.references = t('videoAssets.generate.validation.needRefs')
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const request: ClipGenerationRequest = {
      gameSlug,
      prompt: trimmedPrompt,
      durationSeconds: Math.min(durationMax, Math.max(1, duration)),
      generateAudio,
      mode,
      size,
      resolution,
      ...(model ? { model } : {}),
    }
    if ((mode === 'strict' || mode === 'firstref') && firstFrame) {
      request.firstFrameAssetId = firstFrame.id
    }
    if (mode === 'strict' && lastFrame) {
      request.lastFrameAssetId = lastFrame.id
    }
    if (mode === 'ref') {
      request.referenceImageAssetIds = references.map((asset) => asset.id)
    }
    onSubmit(request)
  }

  const modeTipKey = `videoAssets.generate.tip.${mode}`
  const subtitle = running
    ? t('videoAssets.generate.subtitleRunning')
    : t('videoAssets.generate.subtitleIdle')
  const fixedByServer = t('videoAssets.generate.fixedByServer')
  const modelServerManaged = t('videoAssets.generate.modelServerManaged')
  const status = generationStatus(genState, t)
  const footHint = genState.phase === 'succeeded'
    ? t('videoAssets.generate.footHintDone')
    : running
      ? t('videoAssets.generate.cancelNote')
      : hostManaged
        ? t('videoAssets.generate.fallbackNote')
      : t('videoAssets.generate.footHintIdle')
  const submitLabel = running
    ? t('videoAssets.generate.submitRunning')
    : genState.phase === 'succeeded'
      ? t('videoAssets.generate.submitAgain')
      : t('videoAssets.generate.submit')

  return (
    <div className={`vgen-sheet vgen-${variant} on`}>
      {variant === 'sheet' ? <div className="vgen-backdrop" role="presentation" onClick={requestClose} /> : null}
      <form
        className={`vgen-panel${variant === 'page' ? ' is-page' : ''}`}
        role={variant === 'page' ? 'main' : 'dialog'}
        aria-modal={variant === 'page' ? undefined : 'true'}
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (variant === 'sheet') trapFocus(event, event.currentTarget)
        }}
        onSubmit={submit}
      >
        <header className="vgen-head">
          <div>
            <h2 id={titleId} className="vgen-title">{t('videoAssets.generate.title')}</h2>
            <p id={subtitleId} className="vgen-sub">{subtitle}</p>
          </div>
          {variant === 'sheet' ? <button
            ref={closeButtonRef}
            type="button"
            className="vgen-close"
            aria-label={t('videoAssets.generate.close')}
            onClick={requestClose}
          >
            ✕
          </button> : null}
        </header>

        <div className="vgen-body">
          <div className={`vgen-column${variant === 'page' ? ' vgen-page-composer' : ''}`}>
            <section className="vgen-card" aria-labelledby={`${titleId}-inputs`}>
              <h3 id={`${titleId}-inputs`} className="vgen-card-title">{t('videoAssets.generate.inputs')}</h3>
              <label className="vgen-label" htmlFor={modeId}>{t('videoAssets.generate.modeLabel')}</label>
              <select
                id={modeId}
                className="vgen-select"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as VideoGenerationMode)
                  setErrors({})
                }}
              >
                <option value="strict">{t('videoAssets.generate.mode.strict')}</option>
                <option value="firstref">{t('videoAssets.generate.mode.firstref')}</option>
                <option value="ref">{t('videoAssets.generate.mode.ref')}</option>
                <option value="t2v">{t('videoAssets.generate.mode.t2v')}</option>
              </select>

              {mode === 'strict' || mode === 'firstref' ? (
                <div className={mode === 'strict' ? 'vgen-frame-grid' : undefined}>
                  <FrameButton
                    asset={firstFrame}
                    roleLabel="first_frame"
                    accessibleLabel={t('videoAssets.generate.pickFirstFrame')}
                    emptyLabel={t('videoAssets.generate.firstFrame')}
                    onClick={() => setPickerTarget('first')}
                  />
                  {mode === 'strict' ? (
                    <FrameButton
                      asset={lastFrame}
                      roleLabel="last_frame"
                      accessibleLabel={t('videoAssets.generate.pickLastFrame')}
                      emptyLabel={t('videoAssets.generate.lastFrame')}
                      onClick={() => setPickerTarget('last')}
                    />
                  ) : null}
                </div>
              ) : null}
              {errors.frames ? <div className="vgen-tip error" role="alert">{errors.frames}</div> : null}
              {errors.first ? <div className="vgen-tip error" role="alert">{errors.first}</div> : null}

              {mode === 'ref' ? (
                <div>
                  <span className="vgen-label">{t('videoAssets.generate.refs')}</span>
                  <div className="vgen-refs">
                    {references.map((asset) => (
                      <div
                        key={asset.id}
                        className="vgen-ref"
                        title={asset.label}
                        style={imageBackground(asset.thumbUrl)}
                      >
                        <button
                          type="button"
                          className="vgen-ref-del"
                          aria-label={`${t('videoAssets.generate.removeRef')} ${asset.label}`}
                          onClick={() => setReferences((current) => current.filter((item) => item.id !== asset.id))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {references.length < 9 ? (
                      <button
                        type="button"
                        className="vgen-ref-add"
                        aria-label={t('videoAssets.generate.addRef')}
                        onClick={() => setPickerTarget('reference')}
                      >
                        ＋
                      </button>
                    ) : null}
                  </div>
                  {errors.references ? <div className="vgen-tip error" role="alert">{errors.references}</div> : null}
                </div>
              ) : null}

              <div className="vgen-tip">{t(modeTipKey)}</div>
            </section>

            <section className="vgen-card">
              <h3 id={`${titleId}-prompt`} className="vgen-card-title">{t('videoAssets.generate.promptCard')}</h3>
              <label className="vgen-label" htmlFor={promptId}>{t('videoAssets.generate.prompt')}</label>
              <textarea
                id={promptId}
                className="vgen-textarea"
                value={prompt}
                placeholder={t('videoAssets.generate.promptPlaceholder')}
                aria-invalid={errors.prompt ? 'true' : undefined}
                onChange={(event) => {
                  setPrompt(event.target.value)
                  if (event.target.value.trim()) setErrors((current) => ({ ...current, prompt: undefined }))
                }}
              />
              {errors.prompt ? <div className="vgen-tip error" role="alert">{errors.prompt}</div> : null}

              <div className="vgen-grid2">
                <div>
                  <label className="vgen-label" htmlFor={durationId}>{t('videoAssets.generate.duration')}</label>
                  <input
                    id={durationId}
                    className="vgen-input"
                    type="number"
                    min={1}
                    max={durationMax}
                    value={duration}
                    onChange={(event) => setDuration(clampDuration(event.target.valueAsNumber, durationMax))}
                  />
                </div>
                <div>
                  <label className="vgen-label" htmlFor={ratioId}>{t('videoAssets.generate.ratio')}</label>
                  <select
                    id={ratioId}
                    className="vgen-select"
                    value={size}
                    disabled={hostManaged}
                    title={hostManaged ? fixedByServer : undefined}
                    onChange={(event) => setSize(event.target.value as KinoVideoSize)}
                  >
                    {SIZE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="vgen-label" htmlFor={resolutionId}>{t('videoAssets.generate.resolution')}</label>
                  <select
                    id={resolutionId}
                    className="vgen-select"
                    value={resolution}
                    disabled={hostManaged}
                    title={hostManaged ? fixedByServer : undefined}
                    onChange={(event) => setResolution(event.target.value as KinoVideoResolution)}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                <div>
                  <span id={outputPxId} className="vgen-label">{t('videoAssets.generate.outputPx')}</span>
                  <div className="vgen-readonly" aria-labelledby={outputPxId}>
                    {SIZE_OPTIONS.find((option) => option.value === size)?.pixels}
                  </div>
                </div>
              </div>

              <label className="vgen-check" htmlFor={audioId}>
                <input
                  id={audioId}
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                />
                {t('videoAssets.generate.audio')}
              </label>
              <div className="vgen-check-hint">{t('videoAssets.generate.audioHint')}</div>

              <details className="vgen-advanced">
                <summary>{t('videoAssets.generate.advanced')}</summary>
                <label className="vgen-label" htmlFor={modelId}>{t('videoAssets.generate.model')}</label>
                <select
                  id={modelId}
                  className="vgen-select"
                  value={model}
                  disabled={hostManaged || modelOptions.length <= 1}
                  title={hostManaged ? fixedByServer : modelOptions.length <= 1 ? modelServerManaged : undefined}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {modelOptions.length === 0 ? (
                    <option value="">{t('videoAssets.generate.modelServerDefault')}</option>
                  ) : modelOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                {modelOptions.length === 0 ? (
                  <div className="vgen-check-hint">{modelServerManaged}</div>
                ) : null}
              </details>
            </section>
          </div>

          <div className={`vgen-column vgen-column-output${variant === 'page' ? ' vgen-page-results' : ''}`}>
            <section className="vgen-card" aria-labelledby={`${titleId}-output`}>
              <div className="vgen-card-head">
                <h3 id={`${titleId}-output`} className="vgen-card-title">{t('videoAssets.generate.output')}</h3>
                <span className={`vgen-status ${status.className}`} data-testid="generation-status">{status.label}</span>
              </div>
              <div className="vgen-out-stage">
                {genState.phase === 'succeeded' && (genState.resultUrl || selectedResult?.playbackUrl) ? (
                  <video
                    data-testid="generation-preview"
                    src={genState.resultUrl ?? selectedResult?.playbackUrl}
                    poster={selectedResult?.posterUrl}
                    controls
                    preload="metadata"
                  />
                ) : (
                  <span>{outputPlaceholder(genState, t)}</span>
                )}
              </div>
              {running ? (
                <div
                  className="vgen-out-progress"
                  role="progressbar"
                  aria-label={t('videoAssets.generate.submitRunning')}
                  data-testid="generation-progress"
                >
                  <div className="fill" />
                </div>
              ) : null}
              {genState.phase === 'failed' ? (
                <div className="vgen-output-error vgen-error" role="alert">
                  {genState.error || t('videoAssets.generate.statusFailed')}
                </div>
              ) : null}

              {otherActiveTasks.length > 0 ? (
                <ActiveGenerationTasks tasks={otherActiveTasks} onTrack={onTrack} t={t} />
              ) : null}

              <section className="vgen-history" role="region" aria-label={t('videoAssets.generate.history')}>
                <h4 className="vgen-history-title">{t('videoAssets.generate.history')}</h4>
                <div className="vgen-hist-list">
                  {recent.length === 0 ? (
                    <div className="vgen-picker-empty">{t('videoAssets.generate.noHistory')}</div>
                  ) : recent.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      className="vgen-hist-item"
                      aria-label={`${clip.label} · ${t('videoAssets.generate.locateInLibrary')}`}
                      onClick={() => onLocateAsset(clip.id)}
                    >
                      <span className="vgen-hist-thumb" style={imageBackground(clip.posterUrl)} />
                      <span className="vgen-hist-copy">
                        <span className="vgen-hist-label">{clip.label}</span>
                        <span className="vgen-hist-time">{formatCreatedAt(clip.createdAt)}</span>
                      </span>
                      <span className={`vgen-status ${historyStatusClass(clip.status)}`}>
                        {historyStatusLabel(clip.status, t)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </section>
          </div>
        </div>

        <footer className="vgen-foot">
          <span className="vgen-foot-hint">{footHint}</span>
          {running ? (
            <button type="button" className="vgen-btn-ghost" onClick={onCancel}>
              {t('videoAssets.generate.cancel')}
            </button>
          ) : null}
          <button
            type="submit"
            className={`vgen-btn-primary${running ? ' running' : ''}`}
            disabled={running || prompt.trim().length === 0}
          >
            {submitLabel}
          </button>
        </footer>
      </form>

      <VgenImagePicker
        open={pickerTarget !== null}
        gameSlug={gameSlug}
        imageAssets={imageAssets}
        requireResourceId={!hostManaged}
        onPick={onPickImage}
        onClose={() => setPickerTarget(null)}
      />
      {closeNotice ? <div className="vgen-toast" role="status">{closeNotice}</div> : null}
    </div>
  )
}

function ActiveGenerationTasks({
  tasks,
  onTrack,
  t,
}: {
  tasks: readonly VideoGenerationTask[]
  onTrack: (generationId: string) => void
  t: (key: string) => string
}): JSX.Element {
  return (
    <section
      className="vgen-active-tasks"
      role="region"
      aria-label={t('videoAssets.generate.activeTasksTitle')}
    >
      <h4 className="vgen-history-title">{t('videoAssets.generate.activeTasksTitle')}</h4>
      <div className="vgen-hist-list">
        {tasks.map((task) => (
          <button
            key={task.generationId}
            type="button"
            className="vgen-hist-item"
            aria-label={`${t('videoAssets.generate.trackTask')} ${task.generationId}`}
            onClick={() => onTrack(task.generationId)}
          >
            <span className="vgen-hist-copy">
              <span className="vgen-hist-label">{shortGenerationId(task.generationId)}</span>
              <span className="vgen-hist-time">
                {task.createdAt === undefined ? '—' : formatCreatedAt(task.createdAt)}
              </span>
            </span>
            <span className="vgen-status running">{t('videoAssets.generate.statusRunning')}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function FrameButton({
  asset,
  roleLabel,
  accessibleLabel,
  emptyLabel,
  onClick,
}: {
  asset: VgenImageAsset | null
  roleLabel: 'first_frame' | 'last_frame'
  accessibleLabel: string
  emptyLabel: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`vgen-frame${asset ? ' has-image' : ''}`}
      style={imageBackground(asset?.thumbUrl)}
      aria-label={accessibleLabel}
      onClick={onClick}
    >
      <span className="vgen-role">role: {roleLabel}</span>
      <span className="vgen-frame-label">{asset?.label ?? `＋ ${emptyLabel}`}</span>
    </button>
  )
}

function clampDuration(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(maximum, Math.max(1, Math.round(value)))
}

function imageBackground(url: string | undefined): { backgroundImage: string } | undefined {
  return url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined
}

function generationStatus(state: ClipGenState, t: (key: string) => string): { label: string, className: string } {
  if (state.phase === 'submitting' || state.phase === 'generating') {
    return { label: t('videoAssets.generate.statusRunning'), className: 'running' }
  }
  if (state.phase === 'succeeded') {
    return { label: t('videoAssets.generate.statusDone'), className: 'done' }
  }
  if (state.phase === 'failed') {
    return { label: t('videoAssets.generate.statusFailed'), className: 'failed' }
  }
  return { label: t('videoAssets.generate.statusIdle'), className: '' }
}

function outputPlaceholder(state: ClipGenState, t: (key: string) => string): string {
  if (state.phase === 'submitting' || state.phase === 'generating') {
    return t('videoAssets.generate.outputRunning')
  }
  if (state.phase === 'succeeded') return t('videoAssets.generate.outputDone')
  if (state.phase === 'failed') return t('videoAssets.generate.outputFailed')
  return t('videoAssets.generate.outputIdle')
}

function historyStatusClass(status: RecentGeneratedClip['status']): string {
  if (status === 'generating') return 'running'
  if (status === 'ready') return 'done'
  return 'failed'
}

function historyStatusLabel(status: RecentGeneratedClip['status'], t: (key: string) => string): string {
  if (status === 'generating') return t('videoAssets.generate.statusRunning')
  if (status === 'ready') return t('videoAssets.generate.statusDone')
  return t('videoAssets.generate.statusFailed')
}

function formatCreatedAt(createdAt: number): string {
  const milliseconds = createdAt < 1_000_000_000_000 ? createdAt * 1000 : createdAt
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function shortGenerationId(generationId: string): string {
  if (generationId.length <= 16) return generationId
  return `${generationId.slice(0, 8)}…${generationId.slice(-4)}`
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement): void {
  if (event.key !== 'Tab') return
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute('hidden'))
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
