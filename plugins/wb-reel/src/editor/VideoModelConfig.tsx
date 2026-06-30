import { useState } from 'react'
import { useSettingsStore } from '../scenario/settingsStore'
import { createVideoProvider } from '../llm'
import { maskSecret } from '../scenario/sanitize'
import type { VideoConfig } from '../scenario/types'
import {
  VIDEO_SIZE_CHOICES,
  DEFAULT_VIDEO_SIZE,
  toDisplayLabel,
} from '../llm/seedanceResolution'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 视频模型设置 —— 即梦 seedance 2.0 / Sora-like / 等
 *
 * 默认 endpoint 是火山引擎方舟（ark.cn-beijing.volces.com/api/v3），
 * 默认 model 是 doubao-seedance-2-0-260128（R2V 多模态参考）。
 *
 * 安全模型：
 *   - apiKey / apiBase 仅存在 localStorage（key=`reel-studio.settings.v1`），
 *     **永不**进入剧本 JSON、不会随导出/分享外传
 *   - scenarioStore.setVideoConfig 用白名单只接收 model/duration/size 等
 *     公共字段；任何把 apiKey patch 到 scenario 的尝试都会被剥离
 *   - 输入框为 type=password；屏显时只显示掩码尾段
 *   - 一键「清除 KEY」按钮支持紧急撤离
 *
 * 健康探针：
 *   - 调用 createVideoProvider(cfg).ping()
 *   - 仅校验 key/base 形态；不真正下任务（避免烧 quota）
 */
export function VideoModelConfig() {
  const cfg = useSettingsStore((s) => s.videoConfig)
  const setVideoConfig = useSettingsStore((s) => s.setVideoConfig)
  const [pingState, setPingState] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function clearKey(): void {
    if (!cfg.apiKey) return
    const ok = window.confirm(
      '清除本机已保存的视频模型 API Key？\n（剧本 JSON 中不存在这条 key，仅清本地浏览器存储）',
    )
    if (!ok) return
    setVideoConfig({ apiKey: '' })
  }

  async function probe(): Promise<void> {
    setPingState({ kind: 'pending' })
    try {
      const r = await createVideoProvider(cfg).ping()
      if (r.ok) setPingState({ kind: 'ok' })
      else setPingState({ kind: 'error', message: r.error ?? 'unknown' })
    } catch (e) {
      setPingState({ kind: 'error', message: (e as Error).message })
    }
  }

  return (
    <div className="ks-vmc">
      <Field label="服务商">
        <select
          value={cfg.provider}
          onChange={(e) =>
            setVideoConfig({ provider: e.target.value as VideoConfig['provider'] })
          }
        >
          <option value="seedance">即梦 seedance（火山引擎）</option>
          <option value="jimeng">即梦 jimeng（兼容 seedance API）</option>
          <option value="mock">Mock（占位，不下任务）</option>
        </select>
      </Field>
      <Field label="API Key">
        <input
          type="password"
          value={cfg.apiKey ?? ''}
          placeholder="sk-... 或火山引擎 access key"
          onChange={(e) => setVideoConfig({ apiKey: e.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field label="API Base">
        <input
          type="text"
          value={cfg.apiBase ?? ''}
          placeholder="https://ark.cn-beijing.volces.com/api/v3"
          onChange={(e) => setVideoConfig({ apiBase: e.target.value })}
        />
      </Field>
      <Field label="Model / Endpoint">
        <input
          type="text"
          value={cfg.model ?? ''}
          placeholder="doubao-seedance-2-0-260128  或  ep-xxxxxxxxxxxxx-xxxxx"
          onChange={(e) => setVideoConfig({ model: e.target.value })}
        />
      </Field>
      <div className="ks-vmc-hint ks-mono">
        档位（1080p/720p/480p）由此字段决定：公共 model id 走共享池，
        endpoint id（<code>ep-xxx</code>）走你自己的推理接入点；1080p 通常要求自建 endpoint。
      </div>
      <div className="ks-vmc-row">
        <Field label="时长 (秒)" inline>
          <select
            value={cfg.durationSec ?? 5}
            onChange={(e) => setVideoConfig({ durationSec: Number(e.target.value) })}
          >
            <option value={5}>5s</option>
            <option value={10}>10s</option>
          </select>
        </Field>
        <Field label="比例" inline>
          <select
            value={cfg.size ?? DEFAULT_VIDEO_SIZE}
            onChange={(e) =>
              setVideoConfig({ size: e.target.value as VideoConfig['size'] })
            }
          >
            {VIDEO_SIZE_CHOICES.map((s) => (
              <option key={s} value={s}>
                {toDisplayLabel(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ks-vmc-row">
        <Field label="自带音轨" inline>
          <select
            value={(cfg.generateAudio ?? true) ? 'true' : 'false'}
            onChange={(e) =>
              setVideoConfig({ generateAudio: e.target.value === 'true' })
            }
          >
            <option value="true">开 · Seedance 自出 BGM</option>
            <option value="false">关 · 纯视觉，后期自己叠音轨</option>
          </select>
        </Field>
        <Field label="水印" inline>
          <select
            value={(cfg.watermark ?? false) ? 'true' : 'false'}
            onChange={(e) =>
              setVideoConfig({ watermark: e.target.value === 'true' })
            }
          >
            <option value="false">关（默认）</option>
            <option value="true">开 · 加 Seedance 水印</option>
          </select>
        </Field>
      </div>

      <div className="ks-vmc-actions">
        <button
          type="button"
          onClick={probe}
          disabled={pingState.kind === 'pending'}
        >
          {pingState.kind === 'pending' ? '校验中…' : '校验配置'}
        </button>
        <button
          type="button"
          className="ks-vmc-danger"
          onClick={clearKey}
          disabled={!cfg.apiKey}
          title="清除本机 localStorage 中的 API Key"
        >
          清除 KEY
        </button>
        {pingState.kind === 'ok' && (
          <span className="ks-vmc-ok ks-mono">✓ key/base 形态正确</span>
        )}
        {pingState.kind === 'error' && (
          <span className="ks-vmc-err ks-mono">✗ {pingState.message}</span>
        )}
      </div>

      <div className="ks-vmc-secbox ks-mono">
        <div className="ks-vmc-secline">
          <span className="ks-vmc-seclock">🛡</span>
          <span>
            <b>本机存储 · 不外传</b>：API Key 仅写入此浏览器的 localStorage，
            <u>不会</u>进入剧本 JSON、git diff、导出包或分享链接。
          </span>
        </div>
        <div className="ks-vmc-secline ks-faint">
          当前 KEY · {maskSecret(cfg.apiKey)}
        </div>
      </div>

    </div>
  )
}

function Field({
  label,
  children,
  inline,
}: {
  label: string
  children: React.ReactNode
  inline?: boolean
}) {
  return (
    <div className={`ks-vmc-field ${inline ? 'is-inline' : ''}`}>
      <label className="ks-vmc-field-label ks-mono">{label}</label>
      <div className="ks-vmc-field-input">{children}</div>
    </div>
  )
}

const vmcCss = `
.ks-vmc { display: flex; flex-direction: column; gap: 6px; }
.ks-vmc-field {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.ks-vmc-field.is-inline { grid-template-columns: 60px minmax(0, 1fr); }
.ks-vmc-field-label {
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-dim);
}
.ks-vmc-field-input { display: flex; }
.ks-vmc-field-input > * { width: 100%; font-size: 11.5px; padding: 5px 8px; }
.ks-vmc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ks-vmc-actions {
  display: flex; align-items: center; gap: 8px;
  padding-top: 4px;
}
.ks-vmc-actions button {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.18em;
  padding: 6px 12px;
  background: rgba(125, 211, 252, 0.06);
  border-color: rgba(125, 211, 252, 0.3);
  color: var(--ks-cyan);
}
.ks-vmc-danger {
  background: rgba(251, 113, 133, 0.05) !important;
  border-color: rgba(251, 113, 133, 0.3) !important;
  color: var(--ks-rose) !important;
}
.ks-vmc-danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ks-vmc-ok { font-size: 9.5px; color: var(--ks-mint); letter-spacing: 0.16em; }
.ks-vmc-hint {
  font-size: 9.5px;
  line-height: 1.6;
  letter-spacing: 0.04em;
  color: var(--ks-text-dim);
  padding: 4px 6px;
  margin: -2px 0 2px 0;
  border-left: 2px solid rgba(125, 211, 252, 0.25);
  background: rgba(125, 211, 252, 0.03);
}
.ks-vmc-hint code {
  color: var(--ks-cyan);
  background: rgba(125, 211, 252, 0.08);
  padding: 0 4px;
  border-radius: 2px;
}
.ks-vmc-err {
  font-size: 9.5px;
  color: var(--ks-rose);
  letter-spacing: 0.04em;
  word-break: break-all;
  flex: 1;
}
.ks-vmc-secbox {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(110, 231, 183, 0.22);
  background:
    radial-gradient(ellipse at 0% 0%, rgba(110, 231, 183, 0.05), transparent 60%),
    rgba(0,0,0,0.35);
  border-radius: 4px;
  display: flex; flex-direction: column; gap: 4px;
  font-size: 10.5px;
  line-height: 1.6;
  letter-spacing: 0.04em;
  color: var(--ks-text-soft);
}
.ks-vmc-secline { display: flex; gap: 8px; align-items: flex-start; }
.ks-vmc-secline b { color: var(--ks-mint); font-weight: 500; }
.ks-vmc-secline u { color: var(--ks-amber-glow); text-decoration: none; border-bottom: 1px dashed; }
.ks-vmc-seclock { font-size: 12px; line-height: 1.3; }
`
injectStyleOnce('video-model-config', vmcCss)
