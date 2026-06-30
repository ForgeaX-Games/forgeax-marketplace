/**
 * GenRequestDialog —— 「这次到底发给模型什么」请求详情弹窗。
 *
 * 作者诉求（2026-06）：「智能体生成节点视频几乎全失败，我需要知道你发给视频模型
 * 的都是什么、上传了哪些图、提示词是什么。」队列里每条 job 在发请求前都已落 job.request
 * 快照（成功/失败都有），这里把它完整、可选中、可复制地摊开：
 *   · endpoint / 关键参数（mode/ratio/resolution/seconds/generateAudio/model…）
 *   · 完整提示词（可复制）
 *   · 上传的参考素材缩略图（首帧/尾帧/参考图/参考视频/参考音频，标注角色）
 *   · 失败时附完整错误（可复制）
 * 刷新接盘的失败项里被裁掉的 data: 缩略图会显示占位提示，但 prompt/参数/角色仍在。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../styles/injectStyle'
import { useMediaStore } from '../media/mediaStore'
import type { GenJob, GenRequestRef } from './generationQueueStore'

const ROLE_LABEL: Record<GenRequestRef['role'], string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考图',
  reference_video: '参考视频',
  reference_audio: '参考音频',
}

async function copyText(text: string, onOk: () => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    onOk()
  } catch {
    /* 剪贴板不可用时静默——文字本身可手动选中 */
  }
}

function RefThumb({ r }: { r: GenRequestRef }): JSX.Element {
  // 优先用 url；缺失（刷新后被裁）时据 mediaId 从 mediaStore 重新解析出可显示的缩略图。
  const fromMedia = useMediaStore((s) => (r.mediaId ? s.entries[r.mediaId]?.url : undefined))
  const url = r.url || fromMedia
  const badge = <span className="ks-grd-ref-role ks-mono">{ROLE_LABEL[r.role]}</span>
  if (!url) {
    return (
      <div className="ks-grd-ref is-empty">
        {badge}
        <div className="ks-grd-ref-empty ks-cn">
          {r.label ? r.label : '刷新后缩略图不可用'}
        </div>
      </div>
    )
  }
  let media: JSX.Element
  if (r.role === 'reference_audio') {
    media = <audio className="ks-grd-ref-audio" controls src={url} />
  } else if (r.role === 'reference_video') {
    media = <video className="ks-grd-ref-media" controls muted playsInline src={url} />
  } else {
    media = <img className="ks-grd-ref-media" src={url} alt={r.label ?? r.role} />
  }
  return (
    <a className="ks-grd-ref" href={url} target="_blank" rel="noreferrer" title="点开看原图/原素材">
      {badge}
      {media}
      {r.label ? <div className="ks-grd-ref-label ks-cn">{r.label}</div> : null}
    </a>
  )
}

export function GenRequestDialog({
  job,
  onClose,
}: {
  job: GenJob
  onClose: () => void
}): JSX.Element {
  injectStyleOnce('ks-gen-request-dialog', css)
  const [copied, setCopied] = useState<'prompt' | 'error' | null>(null)
  const req = job.request

  return createPortal(
    <div className="ks-grd-backdrop" onClick={onClose}>
      <div className="ks-grd-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ks-grd-head">
          <div className="ks-grd-title ks-cn" title={job.label}>
            {job.label}
          </div>
          <span className={`ks-grd-status is-${job.status} ks-mono`}>{job.status}</span>
          <button type="button" className="ks-grd-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>

        {req ? (
          <div className="ks-grd-body">
            {req.endpoint ? (
              <div className="ks-grd-endpoint ks-mono">→ {req.endpoint}</div>
            ) : null}

            {/* 参数 */}
            <section className="ks-grd-sec">
              <h4 className="ks-grd-h ks-cn">参数</h4>
              <div className="ks-grd-params">
                {Object.entries(req.params).map(([k, v]) => (
                  <span key={k} className="ks-grd-chip ks-mono">
                    <b>{k}</b>
                    {String(v)}
                  </span>
                ))}
              </div>
            </section>

            {/* 提示词 */}
            <section className="ks-grd-sec">
              <div className="ks-grd-h-row">
                <h4 className="ks-grd-h ks-cn">提示词</h4>
                <button
                  type="button"
                  className="ks-grd-copy ks-mono"
                  onClick={() => void copyText(req.prompt, () => setCopied('prompt'))}
                >
                  {copied === 'prompt' ? '已复制' : '复制'}
                </button>
              </div>
              <pre className="ks-grd-prompt ks-cn">{req.prompt}</pre>
            </section>

            {/* 上传的参考素材 */}
            <section className="ks-grd-sec">
              <h4 className="ks-grd-h ks-cn">
                上传的参考素材 · {req.refs.length} 项
              </h4>
              {req.refs.length === 0 ? (
                <div className="ks-grd-empty ks-cn">（纯文生视频，未上传任何参考素材）</div>
              ) : (
                <div className="ks-grd-refs">
                  {req.refs.map((r, i) => (
                    <RefThumb key={`${r.role}-${i}`} r={r} />
                  ))}
                </div>
              )}
            </section>

            {/* 失败错误 */}
            {job.status === 'failed' && job.error ? (
              <section className="ks-grd-sec">
                <div className="ks-grd-h-row">
                  <h4 className="ks-grd-h is-err ks-cn">失败原因</h4>
                  <button
                    type="button"
                    className="ks-grd-copy ks-mono"
                    onClick={() => void copyText(job.error ?? '', () => setCopied('error'))}
                  >
                    {copied === 'error' ? '已复制' : '复制'}
                  </button>
                </div>
                <pre className="ks-grd-err ks-cn">{job.error}</pre>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="ks-grd-body">
            <div className="ks-grd-empty ks-cn">
              这条任务还没有记录请求快照
              {job.status === 'queued' ? '（排队中，开始生成后才会记录）' : ''}。
            </div>
            {job.status === 'failed' && job.error ? (
              <pre className="ks-grd-err ks-cn">{job.error}</pre>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

const css = `
.ks-grd-backdrop {
  position: fixed; inset: 0; z-index: 4000;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; padding: 32px;
}
.ks-grd-panel {
  width: min(760px, 100%); max-height: min(82vh, 900px);
  display: flex; flex-direction: column;
  background: var(--ks-surface, #14161a);
  border: 1px solid var(--ks-border, rgba(255,255,255,0.12));
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5);
}
.ks-grd-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--ks-border, rgba(255,255,255,0.1));
}
.ks-grd-title { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 600;
  color: var(--ks-text, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ks-grd-status { flex: 0 0 auto; font-size: 10.5px; padding: 2px 8px; border-radius: 999px;
  background: rgba(255,255,255,0.08); color: var(--ks-text-faint, rgba(255,255,255,0.6)); }
.ks-grd-status.is-failed { background: rgba(255,107,107,0.16); color: #ff8a8a; }
.ks-grd-status.is-done { background: rgba(77,210,194,0.16); color: #4dd2c2; }
.ks-grd-status.is-running { background: rgba(212,255,72,0.16); color: #d4ff48; }
.ks-grd-close { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--ks-border, rgba(255,255,255,0.12)); background: transparent;
  color: var(--ks-text-faint, rgba(255,255,255,0.6)); cursor: pointer; font-size: 13px; }
.ks-grd-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
.ks-grd-body { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 16px; }
.ks-grd-endpoint { font-size: 11.5px; color: var(--ks-amber, #d4ff48); }
.ks-grd-sec { display: flex; flex-direction: column; gap: 8px; }
.ks-grd-h { margin: 0; font-size: 12px; color: var(--ks-text-faint, rgba(255,255,255,0.55));
  letter-spacing: .04em; }
.ks-grd-h.is-err { color: #ff8a8a; }
.ks-grd-h-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ks-grd-copy { font-size: 10.5px; padding: 2px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--ks-border, rgba(255,255,255,0.16));
  background: rgba(255,255,255,0.05); color: var(--ks-text, #fff); }
.ks-grd-copy:hover { background: rgba(255,255,255,0.12); }
.ks-grd-params { display: flex; flex-wrap: wrap; gap: 6px; }
.ks-grd-chip { font-size: 10.5px; padding: 3px 8px; border-radius: 6px;
  background: rgba(255,255,255,0.06); color: var(--ks-text, #e8e8e8); display: inline-flex; gap: 6px; }
.ks-grd-chip b { color: var(--ks-text-faint, rgba(255,255,255,0.5)); font-weight: 600; }
.ks-grd-prompt, .ks-grd-err {
  margin: 0; padding: 10px 12px; border-radius: 8px;
  background: rgba(0,0,0,0.28); border: 1px solid var(--ks-border, rgba(255,255,255,0.08));
  font-size: 12px; line-height: 1.6; color: var(--ks-text, #e8e8e8);
  white-space: pre-wrap; word-break: break-word; user-select: text;
  max-height: 240px; overflow: auto;
}
.ks-grd-err { color: #ffb3b3; background: rgba(255,107,107,0.08); border-color: rgba(255,107,107,0.25); }
.ks-grd-empty { font-size: 12px; color: var(--ks-text-faint, rgba(255,255,255,0.45)); }
.ks-grd-refs { display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: 10px; }
.ks-grd-ref { position: relative; display: block; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--ks-border, rgba(255,255,255,0.1)); background: rgba(0,0,0,0.25);
  text-decoration: none; }
.ks-grd-ref.is-empty { min-height: 90px; display: flex; align-items: center; justify-content: center; }
.ks-grd-ref-role { position: absolute; top: 4px; left: 4px; z-index: 2;
  font-size: 9.5px; padding: 1px 6px; border-radius: 999px;
  background: rgba(0,0,0,0.62); color: #fff; }
.ks-grd-ref-media { display: block; width: 100%; height: 116px; object-fit: cover; }
.ks-grd-ref-audio { display: block; width: 100%; margin-top: 22px; }
.ks-grd-ref-label { padding: 4px 6px; font-size: 10px; color: var(--ks-text-faint, rgba(255,255,255,0.6));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ks-grd-ref-empty { font-size: 10.5px; color: var(--ks-text-faint, rgba(255,255,255,0.4)); padding: 0 8px; text-align: center; }
`
