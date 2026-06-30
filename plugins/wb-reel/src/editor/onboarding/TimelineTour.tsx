/**
 * TimelineTour —— 时间轴编辑器的交互式分步引导（剪映式新手上手）。
 *
 * 首次打开场景编辑抽屉时由 onboardingStore.maybeAutoStart() 自动起；看完/跳过后
 * 记 localStorage 不再自动弹（loadTourSeen），但工具栏「?」可随时重开（它打开的是
 * HelpPanel 速查；本 tour 走 tourOpen）。
 *
 * 设计取舍：不做"高亮挖洞贴着具体 DOM 元素"的强耦合引导（时间轴 DOM 频繁重排，锚点
 * 易飘）。改为居中卡片 + 文案分步讲清各区域语义，稳定、可维护，信息密度也够。
 */

import { useEffect, useState } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useOnboardingStore } from './onboardingStore'

interface TourStep {
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    title: '欢迎来到时间轴剪辑台',
    body: '这里像剪映：多轨时间轴 + 上方工具栏 + 右侧后期面板。下面用 1 分钟带你认全核心操作，看完就能上手。',
  },
  {
    title: '轨道与左栏（轨道头）',
    body: '左侧固定栏是每条轨的「轨道头」：标签 + 👁 眼睛（显示/隐藏该轨）+ 🔒 锁定（锁后该轨片段不可拖动，只透传播放头）。点「轨道」按钮可统一管理显隐。',
  },
  {
    title: '选中片段 → 编辑',
    body: '在轨上点一段（镜头/字幕/花字/音频…）即选中，高亮显示。选中后用上方工具栏「剪切 / 删除」，或拖两端裁剪、拖中间移动。按住 Shift 点多段＝多选，可整批删除/微调。',
  },
  {
    title: '右侧后期面板（含变速）',
    body: '右上「后期效果」面板有转场 / 特效 / 贴纸 / 滤镜 / 调节 / 首尾动画 / 变速 / 我的。选中一个镜头，进「变速」即可设 定格(0) / 0.5× / 1× / 2× 等——变速/定格已从时间轴搬到这里。',
  },
  {
    title: '工具栏「更多 ⋯」',
    body: '工具栏保持清爽：撤销/重做、剪切、删除常驻；复制/粘贴/再制、镜头/音频左对齐、左右微调、清空时间轴都收进「更多 ⋯」弹层，不再挤成一排被裁切。',
  },
  {
    title: '播放头、标记点与快捷键',
    body: '工具栏右侧有播放头时间码与回到起点/跳到末尾。双击标尺或按 M 打一个标记点（可命名、可吸附）。常用快捷键：⌘/Ctrl+Z 撤销、Delete 删除、⌘/Ctrl+C/V/D 复制/粘贴/再制、Esc 取消选择。随时点工具栏「?」看速查。',
  },
]

export function TimelineTour() {
  injectStyleOnce('ks-timeline-tour', css)
  const tourOpen = useOnboardingStore((s) => s.tourOpen)
  const finishTour = useOnboardingStore((s) => s.finishTour)
  // 用一个受控 step：放在 store 外的局部 state 会在重开时残留，这里用 store 也行，
  // 但 step 是纯 UI 局部态，用 React 局部 state + key 重置即可。
  return tourOpen ? <TourCard onDone={finishTour} /> : null
}

function TourCard({ onDone }: { onDone: () => void }) {
  // 局部 step；组件随 tourOpen 卸载/挂载（见 TimelineTour 三元）天然重置。
  const [step, setStep] = useStepState()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDone()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS.length - 1, s + 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone, setStep])

  const cur = STEPS[step]!
  const isLast = step === STEPS.length - 1
  return (
    <div className="ks-tour-scrim" onClick={onDone} role="presentation">
      <div className="ks-tour-card" role="dialog" aria-label="时间轴引导" onClick={(e) => e.stopPropagation()}>
        <div className="ks-tour-step ks-mono">
          {step + 1} / {STEPS.length}
        </div>
        <h3 className="ks-tour-title">{cur.title}</h3>
        <p className="ks-tour-body">{cur.body}</p>
        <div className="ks-tour-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`ks-tour-dot ${i === step ? 'is-on' : ''}`} />
          ))}
        </div>
        <div className="ks-tour-actions">
          <button type="button" className="ks-tour-skip" onClick={onDone}>
            跳过，不再显示
          </button>
          <div className="ks-tour-nav">
            {step > 0 && (
              <button type="button" className="ks-tour-btn" onClick={() => setStep((s) => s - 1)}>
                上一步
              </button>
            )}
            <button
              type="button"
              className="ks-tour-btn is-primary"
              onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
            >
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 小工具：把 useState 收成稳定的 setter（避免 TourCard 内联多个 useState 噪声）。
function useStepState(): [number, (fn: (s: number) => number) => void] {
  const [step, setStep] = useState(0)
  const update = (fn: (s: number) => number): void => setStep((s) => fn(s))
  return [step, update]
}

const css = `
.ks-tour-scrim {
  position: absolute; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);
}
.ks-tour-card {
  width: min(440px, 86%);
  padding: 22px 22px 16px;
  border-radius: var(--ks-radius-lg, 14px);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  color: var(--ks-text);
}
.ks-tour-step { font-size: 10px; letter-spacing: 0.16em; color: var(--ks-text-faint); }
.ks-tour-title { margin: 6px 0 8px; font-size: 17px; font-weight: 700; }
.ks-tour-body { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ks-text-soft); }
.ks-tour-dots { display: flex; gap: 5px; margin: 16px 0 14px; }
.ks-tour-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ks-border-strong); }
.ks-tour-dot.is-on { background: var(--ks-amber); }
.ks-tour-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ks-tour-skip {
  all: unset; cursor: pointer; font-size: 11px; color: var(--ks-text-faint);
}
.ks-tour-skip:hover { color: var(--ks-text-dim); text-decoration: underline; }
.ks-tour-nav { display: flex; gap: 8px; }
.ks-tour-btn {
  all: unset; cursor: pointer; padding: 7px 16px; border-radius: var(--ks-radius-sm);
  font-size: 12px; color: var(--ks-text-soft);
  border: 1px solid var(--ks-border-soft); background: var(--ks-panel-solid);
}
.ks-tour-btn:hover { color: var(--ks-text); border-color: var(--ks-border-strong); }
.ks-tour-btn.is-primary {
  color: var(--ks-bg, #0b0b0e); background: var(--ks-amber); border-color: var(--ks-amber); font-weight: 700;
}
`
