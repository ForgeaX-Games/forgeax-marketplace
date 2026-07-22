/**
 * Shared notice when a bound video resource cannot be loaded for playback.
 */
export function MissingVideoNotice({
  resourceId,
  className,
}: {
  resourceId: string
  className?: string
}): JSX.Element {
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      data-testid="missing-video-notice"
    >
      <p>无法播放视频资源</p>
      <p>
        资源 ID：
        <code>{resourceId}</code>
      </p>
      <p>请检查素材是否已上传或仍存在于视频库中。</p>
    </div>
  )
}
