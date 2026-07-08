import type { Scene } from '../scenario/types'
import { deriveSubtitleView } from './subtitleSelect'
import { hasTextStyle, resolveTextCss } from '../editor/textStyle'
import { SUBTITLE_DEFAULT_XY } from '../scenario/textStylePresets'
import { injectStyleOnce } from '../styles/injectStyle'

interface Props {
  scene: Scene
  elapsed: number
}

/**
 * Subtitle —— 电影字幕风格台词层。
 *
 * 设计原则：
 *   - 容器 left:8% right:8% 锚定，尺寸永远不变
 *   - 白字薄黑描边（电影院字幕），旁白/对白字号随视口缩放（clamp 18-40px）
 *     1080p ≈ 32px，4K ≈ 40px；4K 作者反馈过小 → 由固定 22px 改为 vw 缩放
 *   - 旁白/对白通过"字体 + 色阶"区分，不通过字号
 *       对白：苹方 sans
 *       旁白：楷体 STKaiti/KaiTi fallback
 *   - 整行**一次性淡入居中**，不再逐字打字机
 *
 * 2026-04 历程：
 *   v1 左对齐 + 打字机 → 作者不满"靠左"
 *   v2 居中 + grid ghost 占位 + 打字机 → 作者反馈"别逐字弹出了，就直接居中显示就行"
 *   v3（当前）居中一次性淡入 —— 最简单、最电影字幕、无位移
 */
export function DialogueBox({ scene, elapsed }: Props) {
  const view = deriveSubtitleView(scene.dialogue, elapsed)
  const active = view.line

  if (!active) return null

  // 双路径：无自定义样式且无自定义位置 → 走历史 CSS 底栏（存量像素级一致，零回归）；
  // 一旦作者应用了预设样式 / 拖过位置 → 走可定位 + 内联样式的自由层。
  const styled = hasTextStyle(active.style) || active.x != null || active.y != null

  if (!styled) {
    return (
      <div
        className={`ks-sub ${view.isNarration ? 'is-narration' : 'is-spoken'}`}
        role="status"
        aria-live="polite"
        // key: 不同台词间触发 fade-in 动画重放（同一条切换进/出时也能看到轻微淡入）
        key={active.id}
      >
        <div className="ks-sub-line">
          {view.speaker && <span className="ks-sub-speaker">{view.speaker}：</span>}
          <span className="ks-sub-text">{active.text}</span>
        </div>
      </div>
    )
  }

  const x = active.x ?? SUBTITLE_DEFAULT_XY.x
  const y = active.y ?? SUBTITLE_DEFAULT_XY.y
  return (
    <div className="ks-sub-free" role="status" aria-live="polite">
      <div
        className={`ks-sub-free-item ${view.isNarration ? 'is-narration' : 'is-spoken'}`}
        key={active.id}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, ...resolveTextCss(active.style ?? {}) }}
      >
        {view.speaker && <span className="ks-sub-speaker">{view.speaker}：</span>}
        <span className="ks-sub-text">{active.text}</span>
      </div>
    </div>
  )
}

const subtitleCss = `
/* ────────────────────────────────────────────────────────────────
 * 字幕"固定栏" —— 电影院风格：容器位置永远不变，整行一次性淡入居中。
 *
 * 历史失败点：
 *   - justify-content: center + max-width: 78ch → 字数变 = 容器宽度变
 *   - 旁白 19px / 对白 22px → 字号切换造成整行上下跳
 *   - 打字机揭字时居中基点随文字宽度漂移
 *
 * 当前：
 *   - 容器 left:8% right:8% 定位
 *   - 整行水平居中，文字整句同时出现 —— 作者"别逐字弹出"
 *   - 旁白 / 对白字号一致（clamp 18-40px，随视口缩放；4K 必要），字体 + 色阶区分
 * ──────────────────────────────────────────────────────────────── */
.ks-sub {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 8%;
  z-index: 20;
  display: flex;
  justify-content: center;
  pointer-events: none;
  animation: ks-sub-in 260ms ease-out;
}
@keyframes ks-sub-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ks-sub-line {
  max-width: 84%;
  text-align: center;
  font-family: var(--ks-font-cn);
  /* 字号随视口缩放：
   *   1vw 在 1280px 屏 ≈ 12.8px，4K (3840px) ≈ 38.4px
   *   clamp 兜底：最小 18px（手机/小窗），理想 1.65vw（4K 上 ≈ 32px），最大 40px
   * 4K 作者反馈字太小 —— 之前固定 22px 在 4K 上只占屏宽 0.57%，按 1.65vw 对 4K ≈ 32px 观感接近电影院字幕比例。 */
  font-size: clamp(18px, 1.65vw, 40px);
  line-height: 1.55;
  color: #ffffff;
  text-shadow:
    0 0 1px rgba(0,0,0,0.95),
    1px 0 0 rgba(0,0,0,0.85),
    -1px 0 0 rgba(0,0,0,0.85),
    0 1px 0 rgba(0,0,0,0.85),
    0 -1px 0 rgba(0,0,0,0.85),
    0 2px 6px rgba(0,0,0,0.55);
  letter-spacing: 0.02em;
  word-break: break-word;
}
/* 旁白 —— 楷体（STKaiti/KaiTi/楷体 fallback 链）；不用 italic（中文字体会渲染成伪斜不高级） */
.ks-sub.is-narration .ks-sub-line {
  font-family: 'STKaiti', 'KaiTi', '楷体', 'FZKai-Z03',
               var(--ks-font-cn), serif;
  color: rgba(255, 250, 238, 0.92);
  font-weight: 300;
  letter-spacing: 0.04em;
}
.ks-sub-speaker {
  color: rgba(255, 244, 220, 1);
  font-weight: 500;
  margin-right: 4px;
}
/* 小屏兜底：低于 720px 明确锁 18px，避免 vw 在竖屏手机上继续缩 */
@media (max-width: 720px) {
  .ks-sub-line { font-size: 18px; }
  .ks-sub.is-narration .ks-sub-line { font-size: 18px; }
}

/* ────────────────────────────────────────────────────────────────
 * 自由定位字幕层 —— 作者应用了预设样式 / 拖过位置的字幕走这里。
 * 满屏 container（container-type:size）让 fontSizePct 的 cqh 相对整幅画面解析，
 * 与花字 / 预览一致。未被 style 显式设定的视觉项回落到本层的 CSS 基线。
 * ──────────────────────────────────────────────────────────────── */
.ks-sub-free {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  container-type: size;
  overflow: hidden;
}
.ks-sub-free-item {
  position: absolute;
  transform: translate(-50%, -50%);
  max-width: 84%;
  text-align: center;
  font-family: var(--ks-font-cn);
  font-size: clamp(18px, 1.65vw, 40px);
  line-height: 1.55;
  color: #ffffff;
  letter-spacing: 0.02em;
  word-break: break-word;
  text-shadow:
    0 0 1px rgba(0,0,0,0.95),
    1px 0 0 rgba(0,0,0,0.85),
    -1px 0 0 rgba(0,0,0,0.85),
    0 1px 0 rgba(0,0,0,0.85),
    0 -1px 0 rgba(0,0,0,0.85),
    0 2px 6px rgba(0,0,0,0.55);
  animation: ks-sub-in 260ms ease-out;
}
`
injectStyleOnce('subtitle', subtitleCss)
