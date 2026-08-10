import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useT } from '../../../i18n'
import { injectStyleOnce } from '../../../styles/injectStyle'
import generationEmptyIcon from '../../../assets/video-generation-empty.svg?url'
import generationFrameIcon from '../../../assets/video-generation-frame.svg?url'
import generationStyleSwapIcon from '../../../assets/video-generation-style-swap.svg?url'
import generationSwapIcon from '../../../assets/video-generation-swap.svg?url'
import generationUndoIcon from '../../../assets/video-generation-undo.svg?url'
import generationSendIcon from '../../../assets/video-generation-send.svg?url'
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
import {
  listVideoVisualStyles,
  type KinoVisualStylePreset,
} from './visual-style-api'

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
  loadVisualStyles?: () => Promise<readonly KinoVisualStylePreset[]>
}

type PickerTarget = 'first' | 'last' | 'reference'
type ValidationErrors = Partial<Record<'prompt' | 'frames' | 'first' | 'references', string>>

const RUNNING_PHASES = new Set<ClipGenState['phase']>(['submitting', 'generating'])
const DURATION_MAX_SECONDS = 15
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
  loadVisualStyles = listVideoVisualStyles,
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
  const [mode, setMode] = useState<VideoGenerationMode>(variant === 'page' ? 't2v' : 'strict')
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
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [visualStyles, setVisualStyles] = useState<readonly KinoVisualStylePreset[]>([])
  const [visualStylesLoading, setVisualStylesLoading] = useState(false)
  const [visualStylesError, setVisualStylesError] = useState<string | null>(null)
  const [selectedVisualStyle, setSelectedVisualStyle] = useState<KinoVisualStylePreset | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const running = RUNNING_PHASES.has(genState.phase)
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
    setMode(variant === 'page' ? 't2v' : 'strict')
    setDuration(variant === 'page' ? 5 : 8)
    setGenerateAudio(variant === 'page')
    setSize(DEFAULT_SIZE)
    setResolution(DEFAULT_RESOLUTION)
    setModel(defaultModel)
    setErrors({})
    setPickerTarget(null)
    setCloseNotice(null)
    setStylePickerOpen(false)
    closeButtonRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [defaultModel, open, variant])

  useEffect(() => {
    if (!open || !genState.generationId || genState.prompt === undefined) return
    setPrompt(genState.prompt)
  }, [genState.generationId, genState.prompt, open])

  useEffect(() => {
    setDuration((current) => Math.min(15, current))
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || pickerTarget !== null) return
      event.preventDefault()
      if (stylePickerOpen) {
        setStylePickerOpen(false)
        return
      }
      requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pickerTarget, stylePickerOpen])

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

  const openStylePicker = (): void => {
    setStylePickerOpen(true)
    if (visualStyles.length > 0 || visualStylesLoading) return
    setVisualStylesLoading(true)
    setVisualStylesError(null)
    void loadVisualStyles().then(
      (items) => setVisualStyles(items),
      (error: unknown) => setVisualStylesError(error instanceof Error ? error.message : String(error)),
    ).finally(() => setVisualStylesLoading(false))
  }

  const submit = (): void => {
    if (running) return
    const nextErrors: ValidationErrors = {}
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) nextErrors.prompt = t('videoAssets.generate.validation.needPrompt')
    if (mode === 'strict' && (!firstFrame?.resourceId || !lastFrame?.resourceId)) {
      nextErrors.frames = t('videoAssets.generate.validation.needFirstLast')
    }
    if (mode === 'firstref' && !firstFrame?.resourceId) {
      nextErrors.first = t('videoAssets.generate.validation.needFirst')
    }
    if (mode === 'ref' && references.every((asset) => !asset.resourceId)) {
      nextErrors.references = t('videoAssets.generate.validation.needRefs')
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const request: ClipGenerationRequest = {
      gameSlug,
      prompt: trimmedPrompt,
      durationSeconds: Math.min(DURATION_MAX_SECONDS, Math.max(1, duration)),
      generateAudio,
      mode,
      size,
      resolution,
      ...(model ? { model } : {}),
      ...(selectedVisualStyle ? { visualStyleKey: selectedVisualStyle.key } : {}),
    }
    if ((mode === 'strict' || mode === 'firstref') && firstFrame?.resourceId) {
      request.firstFrameResourceId = firstFrame.resourceId
    }
    if (mode === 'strict' && lastFrame?.resourceId) {
      request.lastFrameResourceId = lastFrame.resourceId
    }
    if (mode === 'ref') {
      request.referenceImageResourceIds = references
        .map((asset) => asset.resourceId)
        .filter((resourceId): resourceId is string => Boolean(resourceId))
    }
    onSubmit(request)
  }

  const modeTipKey = `videoAssets.generate.tip.${mode}`
  const subtitle = running
    ? t('videoAssets.generate.subtitleRunning')
    : t('videoAssets.generate.subtitleIdle')
  const modelServerManaged = t('videoAssets.generate.modelServerManaged')
  const status = generationStatus(genState, t)
  const footHint = genState.phase === 'succeeded'
    ? t('videoAssets.generate.footHintDone')
    : running
      ? t('videoAssets.generate.cancelNote')
      : t('videoAssets.generate.footHintIdle')
  const submitLabel = running
    ? t('videoAssets.generate.submitRunning')
    : genState.phase === 'succeeded'
      ? t('videoAssets.generate.submitAgain')
      : t('videoAssets.generate.submit')

  if (variant === 'page') {
    const resultUrl = genState.resultUrl ?? selectedResult?.playbackUrl
    const resultAssetId = genState.assetId ?? genState.resourceId ?? selectedResult?.id
    const pageModes: readonly { value: VideoGenerationMode, label: string }[] = [
      { value: 't2v', label: t('videoAssets.generate.mode.t2v') },
      { value: 'ref', label: t('videoAssets.generate.mode.ref') },
      { value: 'firstref', label: t('videoAssets.generate.mode.firstref') },
      { value: 'strict', label: t('videoAssets.generate.mode.strict') },
    ]
    const durationOptions = [5, 10, 15] as const
    const setPageMode = (nextMode: VideoGenerationMode): void => {
      setMode(nextMode)
      setErrors({})
    }

    return (
      <div className="vgen-sheet vgen-page on">
        <div
          className="vgen-panel is-page vgen-design-panel"
          role="main"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
        >
          <h2 id={titleId} className="vgen-visually-hidden">{t('videoAssets.generate.title')}</h2>
          <p id={subtitleId} className="vgen-visually-hidden">{subtitle}</p>

          <div className="vgen-design-workspace">
            <aside className="vgen-settings" aria-label={t('videoAssets.generate.settingsAria')}>
              <GenerationSetting title={t('videoAssets.generate.model')}>
                <select
                  id={modelId}
                  className="vgen-setting-select"
                  value={model}
                  disabled={modelOptions.length <= 1}
                  aria-label={t('videoAssets.generate.model')}
                  title={modelOptions.length <= 1 ? modelServerManaged : undefined}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {modelOptions.length === 0 ? (
                    <option value="">{t('videoAssets.generate.modelServerDefault')}</option>
                  ) : modelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </GenerationSetting>

              <GenerationSetting title={t('videoAssets.generate.resolution')}>
                <div className="vgen-setting-pills" role="group" aria-label={t('videoAssets.generate.resolution')}>
                  {(['720p', '1080p'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={resolution === option ? 'is-on' : ''}
                      aria-pressed={resolution === option}
                      onClick={() => setResolution(option)}
                    >
                      {option}
                    </button>
                  ))}
                  {['2k', '4k'].map((option) => (
                    <button key={option} type="button" disabled title={t('videoAssets.generate.unsupportedResolution')}>{option}</button>
                  ))}
                </div>
              </GenerationSetting>

              <GenerationSetting title={t('videoAssets.generate.durationShort')}>
                <div className="vgen-setting-pills" role="group" aria-label={t('videoAssets.generate.duration')}>
                  {durationOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={duration === option ? 'is-on' : ''}
                      aria-pressed={duration === option}
                      onClick={() => setDuration(option)}
                    >
                      {option}s
                    </button>
                  ))}
                  <button
                    type="button"
                    className={!durationOptions.includes(duration as 5 | 10 | 15) ? 'is-on' : ''}
                    aria-pressed={!durationOptions.includes(duration as 5 | 10 | 15)}
                    onClick={() => setDuration(8)}
                  >
                    {t('videoAssets.generate.custom')}
                  </button>
                </div>
                {!durationOptions.includes(duration as 5 | 10 | 15) ? (
                  <input
                    className="vgen-custom-duration"
                    type="number"
                    min={1}
                    max={DURATION_MAX_SECONDS}
                    value={duration}
                    aria-label={t('videoAssets.generate.duration')}
                    onChange={(event) => setDuration(clampDuration(event.target.valueAsNumber, DURATION_MAX_SECONDS))}
                  />
                ) : null}
              </GenerationSetting>

              <GenerationSetting title={t('videoAssets.generate.ratioShort')}>
                <select
                  id={ratioId}
                  className="vgen-setting-select"
                  value={size}
                  aria-label={t('videoAssets.generate.ratio')}
                  onChange={(event) => setSize(event.target.value as KinoVideoSize)}
                >
                  {SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
                </select>
              </GenerationSetting>

              <GenerationSetting title={t('videoAssets.generate.cameraSpeed')}>
                <div className="vgen-setting-pills vgen-static-pills" role="group" aria-label={t('videoAssets.generate.cameraSpeed')}>
                  {(['static', 'slow', 'medium', 'fast'] as const).map((option, index) => (
                    <button key={option} type="button" className={index === 0 ? 'is-on' : ''} disabled title={t('videoAssets.generate.unsupportedCamera')}>{t(`videoAssets.generate.cameraSpeed.${option}`)}</button>
                  ))}
                </div>
              </GenerationSetting>

              <GenerationSetting title={t('videoAssets.generate.cameraMotion')}>
                <div className="vgen-setting-pills vgen-camera-pills" role="group" aria-label={t('videoAssets.generate.cameraMotion')}>
                  {(['fixed', 'push', 'pull', 'pan', 'crane', 'rotate'] as const).map((option, index) => (
                    <button key={option} type="button" className={index === 0 ? 'is-on' : ''} disabled title={t('videoAssets.generate.unsupportedCamera')}>{t(`videoAssets.generate.cameraMotion.${option}`)}</button>
                  ))}
                </div>
              </GenerationSetting>
            </aside>

            <section className="vgen-preview-stage" aria-label={t('videoAssets.generate.output')}>
              {genState.phase === 'succeeded' && resultUrl ? (
                <GeneratedVideoPreview
                  src={resultUrl}
                  poster={selectedResult?.posterUrl}
                  onClose={onCancel}
                  onApply={resultAssetId ? () => onLocateAsset(resultAssetId) : undefined}
                />
              ) : (
                <div className={`vgen-preview-empty${running ? ' is-running' : ''}`}>
                  <img src={generationEmptyIcon} alt="" />
                  <p>{outputPlaceholder(genState, t)}</p>
                  <span>{t('videoAssets.generate.outputSubtitle')}</span>
                  {running ? <div className="vgen-preview-progress" role="progressbar" aria-label={t('videoAssets.generate.submitRunning')} data-testid="generation-progress"><i /></div> : null}
                  {genState.phase === 'failed' ? <div className="vgen-design-error" role="alert">{genState.error || t('videoAssets.generate.statusFailed')}</div> : null}
                </div>
              )}
              <span className={`vgen-design-status ${status.className}`} data-testid="generation-status">{status.label}</span>
            </section>

            <section className="vgen-composer" aria-label={t('videoAssets.generate.composerAria')}>
              <div className="vgen-mode-tabs" role="tablist" aria-label={t('videoAssets.generate.modeLabel')}>
                {pageModes.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={mode === option.value}
                    className={mode === option.value ? 'is-on' : ''}
                    onClick={() => setPageMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {mode !== 't2v' ? <div className="vgen-media-row">
                {mode === 'strict' || mode === 'firstref' ? (
                  <>
                    <FrameTile
                      asset={firstFrame}
                      label={t('videoAssets.generate.firstFrame')}
                      accessibleLabel={t('videoAssets.generate.pickFirstFrame')}
                      onClick={() => setPickerTarget('first')}
                    />
                    {mode === 'strict' ? (
                      <>
                        <span className="vgen-frame-swap" aria-hidden><img src={generationSwapIcon} alt="" /></span>
                        <FrameTile
                          asset={lastFrame}
                          label={t('videoAssets.generate.lastFrame')}
                          accessibleLabel={t('videoAssets.generate.pickLastFrame')}
                          onClick={() => setPickerTarget('last')}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                {mode === 'ref' ? (
                  <div className="vgen-page-refs">
                    {references.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="vgen-page-ref"
                        style={imageBackground(asset.thumbUrl)}
                        aria-label={`${t('videoAssets.generate.removeRef')} ${asset.label}`}
                        onClick={() => setReferences((current) => current.filter((item) => item.id !== asset.id))}
                      >
                        <span aria-hidden>×</span>
                      </button>
                    ))}
                    {references.length < 9 ? (
                      <button type="button" className="vgen-page-ref-add" aria-label={t('videoAssets.generate.addRef')} onClick={() => setPickerTarget('reference')}>
                        <img src={generationFrameIcon} alt="" /><span>{t('videoAssets.generate.addRef')}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div> : null}

              {errors.frames ? <div className="vgen-design-error" role="alert">{errors.frames}</div> : null}
              {errors.first ? <div className="vgen-design-error" role="alert">{errors.first}</div> : null}
              {errors.references ? <div className="vgen-design-error" role="alert">{errors.references}</div> : null}

              <div className="vgen-prompt-box">
                <textarea
                  id={promptId}
                  value={prompt}
                  aria-label={t('videoAssets.generate.prompt')}
                  aria-invalid={errors.prompt ? 'true' : undefined}
                  placeholder={t('videoAssets.generate.promptPlaceholder')}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                    if (event.target.value.trim()) setErrors((current) => ({ ...current, prompt: undefined }))
                  }}
                />
                {errors.prompt ? <div className="vgen-design-error" role="alert">{errors.prompt}</div> : null}
                <div className="vgen-prompt-tools">
                  <div className="vgen-prompt-options">
                    <button
                      type="button"
                      className={`vgen-style-button${selectedVisualStyle ? ' has-style' : ''}`}
                      aria-label={selectedVisualStyle
                        ? `${t('videoAssets.generate.style')}: ${selectedVisualStyle.label}`
                        : t('videoAssets.generate.style')}
                      onClick={openStylePicker}
                    >
                      <span className="vgen-style-label">
                        {selectedVisualStyle?.label ?? t('videoAssets.generate.style')}
                      </span>
                      <span className="vgen-style-swap" aria-hidden>
                        <img src={generationStyleSwapIcon} alt="" />
                      </span>
                    </button>
                    <label className="vgen-audio-toggle">
                      <span className="vgen-audio-label">{t('videoAssets.generate.audio')}</span>
                      <input id={audioId} type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} />
                      <span className="vgen-audio-switch" aria-hidden />
                    </label>
                  </div>
                  <div className="vgen-prompt-actions">
                    {running ? (
                      <button type="button" className="vgen-prompt-undo" aria-label={t('videoAssets.generate.cancel')} onClick={onCancel}>
                        <img src={generationUndoIcon} alt="" />
                      </button>
                    ) : (
                      <button type="button" className="vgen-prompt-undo" aria-label={t('videoAssets.generate.clearPrompt')} disabled={!prompt} onClick={() => setPrompt('')}>
                        <img src={generationUndoIcon} alt="" />
                      </button>
                    )}
                    <button type="button" className="vgen-prompt-helper" disabled title={t('videoAssets.generate.promptHelperComing')}>
                      {t('videoAssets.generate.promptHelper')}
                      <span className="vgen-prompt-helper-chevron" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`vgen-send${running ? ' running' : ''}`}
                      aria-label={submitLabel}
                      disabled={running}
                      onClick={submit}
                    >
                      <img src={generationSendIcon} alt="" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <VgenImagePicker
          open={pickerTarget !== null}
          gameSlug={gameSlug}
          imageAssets={imageAssets}
          requireResourceId
          onPick={onPickImage}
          onClose={() => setPickerTarget(null)}
        />
        <VisualStylePicker
          open={stylePickerOpen}
          styles={visualStyles}
          loading={visualStylesLoading}
          error={visualStylesError}
          selectedKey={selectedVisualStyle?.key}
          onSelect={(style) => { setSelectedVisualStyle(style); setStylePickerOpen(false) }}
          onClose={() => setStylePickerOpen(false)}
          t={t}
        />
      </div>
    )
  }

  return (
    <div className="vgen-sheet on">
      <div className="vgen-backdrop" role="presentation" onClick={requestClose} />
      <div
        className="vgen-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => trapFocus(event, event.currentTarget)}
      >
        <header className="vgen-head">
          <div>
            <h2 id={titleId} className="vgen-title">{t('videoAssets.generate.title')}</h2>
            <p id={subtitleId} className="vgen-sub">{subtitle}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="vgen-close"
            aria-label={t('videoAssets.generate.close')}
            onClick={requestClose}
          >
            ✕
          </button>
        </header>

        <div className="vgen-body">
          <div className="vgen-column">
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
                    max={DURATION_MAX_SECONDS}
                    value={duration}
                    onChange={(event) => setDuration(clampDuration(event.target.valueAsNumber, DURATION_MAX_SECONDS))}
                  />
                </div>
                <div>
                  <label className="vgen-label" htmlFor={ratioId}>{t('videoAssets.generate.ratio')}</label>
                  <select
                    id={ratioId}
                    className="vgen-select"
                    value={size}
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
                  disabled={modelOptions.length <= 1}
                  title={modelOptions.length <= 1 ? modelServerManaged : undefined}
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

          <div className="vgen-column vgen-column-output">
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
            type="button"
            className={`vgen-btn-primary${running ? ' running' : ''}`}
            disabled={running || prompt.trim().length === 0}
            onClick={submit}
          >
            {submitLabel}
          </button>
        </footer>
      </div>

      <VgenImagePicker
        open={pickerTarget !== null}
        gameSlug={gameSlug}
        imageAssets={imageAssets}
        requireResourceId
        onPick={onPickImage}
        onClose={() => setPickerTarget(null)}
      />
      {closeNotice ? <div className="vgen-toast" role="status">{closeNotice}</div> : null}
    </div>
  )
}

function GenerationSetting({ title, children }: { title: string, children: ReactNode }): JSX.Element {
  return (
    <section className="vgen-setting-group">
      <h3><span aria-hidden />{title}</h3>
      {children}
    </section>
  )
}

function VisualStylePicker({
  open,
  styles,
  loading,
  error,
  selectedKey,
  onSelect,
  onClose,
  t,
}: {
  open: boolean
  styles: readonly KinoVisualStylePreset[]
  loading: boolean
  error: string | null
  selectedKey?: string
  onSelect: (style: KinoVisualStylePreset) => void
  onClose: () => void
  t: (key: string) => string
}): JSX.Element | null {
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const categories = useMemo(
    () => [...new Set(styles.flatMap((style) => style.tags).filter(Boolean))],
    [styles],
  )
  const visibleStyles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return styles.filter((style) => (
      (!category || style.tags.includes(category))
      && (!normalizedQuery || style.label.toLocaleLowerCase().includes(normalizedQuery)
        || style.key.toLocaleLowerCase().includes(normalizedQuery))
    ))
  }, [category, query, styles])

  if (!open) return null
  return (
    <div className="vgen-style-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="vgen-style-dialog" role="dialog" aria-modal="true" aria-label={t('videoAssets.generate.stylePicker.title')}>
        <header className="vgen-style-head">
          <h3>{t('videoAssets.generate.stylePicker.title')}</h3>
          <button type="button" aria-label={t('videoAssets.generate.stylePicker.close')} onClick={onClose}>×</button>
        </header>
        <div className="vgen-style-toolbar">
          <div className="vgen-style-categories" role="tablist" aria-label={t('videoAssets.generate.stylePicker.categories')}>
            <button type="button" role="tab" aria-selected={!category} className={!category ? 'is-on' : ''} onClick={() => setCategory('')}>{t('videoAssets.generate.stylePicker.all')}</button>
            {categories.map((tag) => (
              <button key={tag} type="button" role="tab" aria-selected={category === tag} className={category === tag ? 'is-on' : ''} onClick={() => setCategory(tag)}>{tag}</button>
            ))}
          </div>
          <input value={query} aria-label={t('videoAssets.generate.stylePicker.search')} placeholder={t('videoAssets.generate.stylePicker.search')} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="vgen-style-grid">
          {loading ? <p className="vgen-style-message" role="status">{t('videoAssets.generate.stylePicker.loading')}</p> : null}
          {!loading && error ? <p className="vgen-style-message error" role="alert">{t('videoAssets.generate.stylePicker.loadFailed')}: {error}</p> : null}
          {!loading && !error && visibleStyles.length === 0 ? <p className="vgen-style-message">{t('videoAssets.generate.stylePicker.empty')}</p> : null}
          {!loading && !error ? visibleStyles.map((style) => (
            <button
              key={style.key}
              type="button"
              className={`vgen-style-card${style.key === selectedKey ? ' is-selected' : ''}`}
              aria-pressed={style.key === selectedKey}
              onClick={() => onSelect(style)}
            >
              <img src={style.cdnUrl} alt="" loading="lazy" />
              <span>{style.label}</span>
            </button>
          )) : null}
        </div>
      </section>
    </div>
  )
}

function FrameTile({
  asset,
  label,
  accessibleLabel,
  onClick,
}: {
  asset: VgenImageAsset | null
  label: string
  accessibleLabel: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`vgen-frame-tile${asset ? ' has-image' : ''}`}
      style={imageBackground(asset?.thumbUrl)}
      aria-label={accessibleLabel}
      onClick={onClick}
    >
      {asset ? null : <img src={generationFrameIcon} alt="" />}
      <span>{asset?.label ?? label}</span>
    </button>
  )
}

function GeneratedVideoPreview({
  src,
  poster,
  onClose,
  onApply,
}: {
  src: string
  poster?: string
  onClose: () => void
  onApply?: () => void
}): JSX.Element {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setPlaybackRate(1)
  }, [src])

  const togglePlayback = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }
  const cyclePlaybackRate = (): void => {
    const video = videoRef.current
    if (!video) return
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    video.playbackRate = next
    setPlaybackRate(next)
  }
  const openFullscreen = (): void => {
    const video = videoRef.current
    if (video?.requestFullscreen) void video.requestFullscreen()
  }

  return (
    <div className="vgen-generated-preview">
      <video
        ref={videoRef}
        data-testid="generation-preview"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={togglePlayback}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="vgen-preview-close" aria-label={t('videoAssets.generate.player.close')} onClick={onClose}>×</button>
      <div className="vgen-player-controls">
        <div className="vgen-player-row">
          <button type="button" className="vgen-player-play" aria-label={playing ? t('videoAssets.generate.player.pause') : t('videoAssets.generate.player.play')} onClick={togglePlayback}>{playing ? 'Ⅱ' : '▶'}</button>
          <span>{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span>
          <button type="button" className="vgen-player-rate" aria-label={t('videoAssets.generate.player.rate')} onClick={cyclePlaybackRate}>{playbackRate.toFixed(1)}x</button>
          <button type="button" className="vgen-player-fullscreen" aria-label={t('videoAssets.generate.player.fullscreen')} onClick={openFullscreen}>⌗</button>
        </div>
        <input
          className="vgen-player-progress"
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          aria-label={t('videoAssets.generate.player.progress')}
          style={{ '--vgen-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (videoRef.current) videoRef.current.currentTime = next
            setCurrentTime(next)
          }}
        />
        <button type="button" className="vgen-apply" disabled={!onApply} onClick={onApply}>{t('videoAssets.generate.player.apply')}</button>
      </div>
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

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
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
