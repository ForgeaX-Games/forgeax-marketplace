import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useMediaStore } from '../media/mediaStore'
import { createImageProvider } from '../llm'
import type { ImageClient } from '../llm/types'
import type { Branch, Scene } from '../scenario/types'
import { useCinemaHold } from './cinemaGate'
import { injectStyleOnce } from '../styles/injectStyle'
import {
  describeCondition,
  isBranchAvailable,
  type ItemState,
  type VarState,
} from './conditionEval'

/**
 * ChoiceLayer · 高级感选项层
 *
 * 视觉语言：
 *   - 全屏黑色玻璃模糊（backdrop-filter blur 18px + saturate）
 *   - 顶部"YOUR CHOICE / 你的选择"中英对照标题，下方流光金线
 *   - 横向排列大卡片（每张高约 60vh，宽自适应），1-3 张并列
 *   - 每张卡片背景 = 目标场景的 GPT-Image-2 占位图（异步加载，骨架扫光）
 *   - 卡片金色描边、四角装饰、底部双层文字 + 路径走向小箭头
 *   - hover：scale 1.02 + 金色边框增亮 + 图像下移视差
 *   - 选中态：选中后整张卡片向中心放大、其余淡出（出场动画）
 */
interface Props {
  scene: Scene
  onPick: (b: Branch) => void
  /** 运行时数值状态 —— 用于条件求值（缺省视为空，无条件分支不受影响） */
  vars?: VarState
  /** 已访问场景 id —— 用于 visited 条件 */
  visitedSceneIds?: string[]
  /** 运行时背包持有量 —— 用于 hasItem 条件 */
  ownedItems?: ItemState
}

export function ChoiceLayer({ scene, onPick, vars, visitedSceneIds, ownedItems }: Props) {
  const scenario = useScenarioStore((s) => s.scenario)
  const [picked, setPicked] = useState<string | null>(null)

  // ChoiceLayer 挂着说明玩家正在"做选择"，阻止电影模式，让 UI 常驻
  useCinemaHold(true)

  // 数值系统：按 condition 过滤 / 锁定。
  //   - 条件满足 → 正常可选
  //   - 条件不满足 + gateMode='lock' → 显示但置灰锁定（悬停看所需条件）
  //   - 条件不满足 + gateMode='hide'（默认）→ 直接不渲染
  const ctx = useMemo(
    () => ({
      vars: vars ?? {},
      visitedSceneIds: new Set(visitedSceneIds ?? []),
      ownedItems: ownedItems ?? {},
    }),
    [vars, visitedSceneIds, ownedItems],
  )
  const choices = useMemo(() => {
    return scene.branches
      .filter((b) => b.kind === 'choice')
      .map((b) => {
        const available = isBranchAvailable(b, ctx)
        const locked = !available && (b.gateMode ?? 'hide') === 'lock'
        return { branch: b, available, locked }
      })
      .filter((c) => c.available || c.locked)
  }, [scene.branches, ctx])

  function handlePick(b: Branch): void {
    if (picked) return
    setPicked(b.id)
    window.setTimeout(() => onPick(b), 520)
  }

  return (
    <div className="ks-cl">
      <div className="ks-cl-bg" />

      <header className="ks-cl-head">
        <div className="ks-cl-eyebrow">YOUR · CHOICE</div>
        <div className="ks-cl-h1 ks-cn">你的抉择</div>
        <div className="ks-cl-rule" />
      </header>

      <div
        className="ks-cl-cards"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, choices.length))}, minmax(0, 1fr))`,
        }}
      >
        {choices.map((c, i) => (
          <ChoiceCard
            key={c.branch.id}
            branch={c.branch}
            index={i}
            picked={picked}
            locked={c.locked}
            lockHint={c.locked ? describeCondition(c.branch, scenario) : ''}
            onPick={() => handlePick(c.branch)}
          />
        ))}
      </div>

    </div>
  )
}

interface CardProps {
  branch: Branch
  index: number
  picked: string | null
  locked?: boolean
  lockHint?: string
  onPick: () => void
}

function ChoiceCard({ branch, index, picked, locked, lockHint, onPick }: CardProps) {
  const targetScene = useScenarioStore(
    (s) => s.scenario.scenes[branch.targetSceneId],
  )
  const imgClient = useMemo<ImageClient>(() => createImageProvider(), [])
  const cacheRecord = useSceneImageCache((s) => s.records[branch.targetSceneId])
  const ensure = useSceneImageCache((s) => s.ensure)
  // 只抓**这个 scene 自己绑的**那条 media（不走 keyShot / shots[0]
  // 链——那些可能指向从别 scene 共享过的老素材，会糊弄玩家）
  const directMediaRef = targetScene?.media.ref
  const directMedia = useMediaStore((s) =>
    directMediaRef ? s.entries[directMediaRef] : undefined,
  )

  // 取图优先级（只认"属于这个目标 scene 自己"的素材）：
  //   1. sceneImageCache[targetSceneId] ready 的生图结果（image）
  //   2. scene.media.ref 指向的 mediaStore 条目（作者主动拖/上传给此 scene 的图或视频）
  //   3. 无 → scene.title 前两字占位
  // 视频走 <video muted preload=metadata> 抓首帧
  let artUrl: string | undefined
  let artKind: 'image' | 'video' = 'image'
  if (cacheRecord?.status === 'ready') {
    artUrl = cacheRecord.dataUrl
    artKind = 'image'
  } else if (directMedia?.url) {
    artUrl = directMedia.url
    artKind = directMedia.mimeType?.startsWith('video/') ? 'video' : 'image'
  }
  const isPending = cacheRecord?.status === 'pending'
  const isError = cacheRecord?.status === 'error'

  useEffect(() => {
    // v3.8.2 · ChoiceLayer 打开即预热候选分支视频头部
    //
    // 作者反馈：弹出选择层时卡片一片黑，需要等 Player 那边的 500ms 定时器 +
    // 整片下载才出首帧。这里独立做一次"头部 Range 预热"：
    //   - 每张卡片自己只要 3 MiB 头部（moov + 几秒画面）
    //   - <video preload="metadata"> 看到 206 Range 响应会立即触发 loadedmetadata
    //     → currentTime = 0.01 → 首帧渲染
    //   - Player 的主预拉 effect 也会干同样的事，但 ChoiceLayer 这条更快
    //     （从挂载到发 fetch 不到一帧）
    //
    // 只处理 /__reel__/assets/ URL：blob:/data: 已在本地无需预热
    if (!artUrl || !artUrl.startsWith('/__reel__/assets/')) return
    const controller = new AbortController()
    void fetch(artUrl, {
      cache: 'force-cache',
      signal: controller.signal,
      headers: { Range: 'bytes=0-3145727' },
      priority: 'high',
    }).catch(() => { /* 静默 */ })
    return () => controller.abort()
  }, [artUrl])

  useEffect(() => {
    // 已经 ready / 正在 pending / 或者已有作者上传的直绑素材 → 不重复 ensure
    // 避免每次打开选择菜单都浪费 GPT-Image-2 调用
    if (
      cacheRecord?.status === 'ready' ||
      cacheRecord?.status === 'pending' ||
      directMedia?.url
    ) {
      return
    }
    const prompt = targetScene?.media.prompt
    if (!prompt) return
    void ensure(branch.targetSceneId, prompt, imgClient)
  }, [
    branch.targetSceneId,
    targetScene?.media.prompt,
    cacheRecord?.status,
    directMedia?.url,
    ensure,
    imgClient,
  ])

  const isPicked = picked === branch.id
  const isOther = picked != null && !isPicked
  const targetTitle = targetScene?.title ?? branch.targetSceneId

  return (
    <button
      type="button"
      className={`ks-cl-card ${isPicked ? 'is-picked' : ''} ${isOther ? 'is-other' : ''} ${locked ? 'is-locked' : ''}`}
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={locked ? undefined : onPick}
      disabled={picked != null || locked}
      title={locked && lockHint ? `未解锁 · 需要 ${lockHint}` : undefined}
    >
      {locked && (
        <span className="ks-cl-lock" aria-hidden>
          <span className="ks-cl-lock-icon">🔒</span>
          {lockHint && <span className="ks-cl-lock-hint ks-cn">需要 {lockHint}</span>}
        </span>
      )}
      <span className="ks-cl-corner ks-cl-corner-tl" />
      <span className="ks-cl-corner ks-cl-corner-tr" />
      <span className="ks-cl-corner ks-cl-corner-bl" />
      <span className="ks-cl-corner ks-cl-corner-br" />

      <span className="ks-cl-art">
        {artUrl ? (
          artKind === 'video' ? (
            <video
              src={artUrl}
              muted
              preload="metadata"
              playsInline
              draggable={false}
              // 多数浏览器只在 currentTime 变动时才出帧，给个 0.01s hint
              onLoadedMetadata={(e) => {
                try { e.currentTarget.currentTime = 0.01 } catch { /* ignore */ }
              }}
            />
          ) : (
            <img src={artUrl} alt={targetTitle} draggable={false} />
          )
        ) : (
          // 真没图 —— scene.title 前两字占位，不回退到别 scene 的共享素材
          <span className="ks-cl-art-placeholder ks-cn" aria-hidden>
            {targetTitle.slice(0, 2)}
          </span>
        )}
        {isPending && (
          <span className="ks-cl-art-skel is-pending" aria-hidden>
            <span className="ks-cl-art-strip" />
          </span>
        )}
        {isError && <span className="ks-cl-art-skel is-error" aria-hidden />}
        <span className="ks-cl-art-veil" />
      </span>

      <span className="ks-cl-meta">
        <span className="ks-cl-num ks-mono">
          {String(index + 1).padStart(2, '0')} · CHOICE
        </span>
        <span className="ks-cl-label ks-cn">{branch.label ?? '——'}</span>
        <span className="ks-cl-target ks-mono">
          → {targetTitle}
        </span>
      </span>

      <span className="ks-cl-glint" />
    </button>
  )
}

const clCss = `
.ks-cl {
  position: absolute; inset: 0;
  z-index: 80;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 4vh 6vw 6vh;
  animation: ks-cl-in 360ms ease-out;
}
@keyframes ks-cl-in { from { opacity: 0; } to { opacity: 1; } }
.ks-cl-bg {
  position: absolute; inset: 0;
  /* 背后是 Player 舞台（定格的 video/图片），这层只做"哑光玻璃"不全挡。
   * 历史：曾是 rgba(2,4,8,0.82) —— 几乎全黑，玩家反馈"选择一弹出就看不到画面"。
   * 现在降到 0.38 让底层帧透出来，blur+saturate 把画面"推远"当氛围板，
   * 卡片本身有自己的对比度不怕底纹抢戏。 */
  background: rgba(2, 4, 8, 0.38);
  backdrop-filter: blur(14px) saturate(110%) brightness(0.78);
  -webkit-backdrop-filter: blur(14px) saturate(110%) brightness(0.78);
  z-index: -1;
}

/* 标题 —— 极简纯白 */
.ks-cl-head {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px;
  padding-bottom: 28px;
}
.ks-cl-eyebrow {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.5em;
  color: rgba(255, 255, 255, 0.55);
}
.ks-cl-h1 {
  font-family: var(--ks-font-cn);
  font-size: 32px;
  font-weight: 400;
  letter-spacing: 0.16em;
  color: rgba(255, 255, 255, 0.96);
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
}
.ks-cl-rule {
  width: min(360px, 50vw);
  height: 1px;
  background: rgba(255, 255, 255, 0.16);
}

/* 卡片网格 */
.ks-cl-cards {
  display: grid;
  gap: 28px;
  align-content: center;
  justify-content: center;
  align-items: stretch;
  min-height: 0;
  max-height: 100%;
}

/* 单张卡片 —— 极简，白色低透明 border，hover 略亮 */
.ks-cl-card {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: rgba(8, 10, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--ks-radius-xl);
  overflow: hidden;
  cursor: pointer;
  text-align: left;
  padding: 0;
  font-family: inherit;
  color: var(--ks-text);
  transition:
    transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 220ms ease,
    box-shadow 220ms ease,
    opacity 320ms ease,
    filter 320ms ease;
  animation: ks-cl-card-in 480ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  box-shadow:
    0 24px 48px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.02);
  height: min(70vh, 720px);
  min-width: 0;
}
@keyframes ks-cl-card-in {
  from { opacity: 0; transform: translateY(28px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ks-cl-card:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.42);
  transform: translateY(-4px) scale(1.012);
  box-shadow:
    0 32px 64px rgba(0, 0, 0, 0.65),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10);
}
.ks-cl-card:hover:not(:disabled) .ks-cl-art img,
.ks-cl-card:hover:not(:disabled) .ks-cl-art video {
  transform: scale(1.06) translateY(-1.5%);
}
.ks-cl-card:hover:not(:disabled) .ks-cl-art-veil {
  opacity: 0.55;
}
.ks-cl-card:hover:not(:disabled) .ks-cl-glint { opacity: 1; }

.ks-cl-card.is-picked {
  transform: scale(1.04);
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow:
    0 0 64px rgba(255, 255, 255, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.30);
  z-index: 2;
}
.ks-cl-card.is-other {
  opacity: 0;
  transform: scale(0.96);
  filter: blur(2px);
}

/* 角装饰 —— 取消，太花哨；保留类名但置 0 大小，
   不动 JSX 减少改动面积 */
.ks-cl-corner { display: none; }

/* 锁定（条件未满足 + gateMode='lock'）—— 置灰 + 锁标 + 所需条件提示 */
.ks-cl-card.is-locked {
  cursor: not-allowed;
  filter: grayscale(0.85) brightness(0.6);
  opacity: 0.72;
}
.ks-cl-card.is-locked:hover { transform: none; }
.ks-cl-lock {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(2, 4, 8, 0.45);
  pointer-events: none;
}
.ks-cl-lock-icon { font-size: 40px; opacity: 0.85; }
.ks-cl-lock-hint {
  font-size: 13px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 12px;
  border-radius: var(--ks-radius-pill);
}

/* 画面区 */
.ks-cl-art {
  position: relative;
  overflow: hidden;
  background: #02050a;
}
.ks-cl-art img,
.ks-cl-art video {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 800ms cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
}
/* 兜底占位：没图也没视频时，用 scene title 前两字在渐变底色上占位，
   比纯骨架空盒可读得多 */
.ks-cl-art-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(48px, 8vw, 96px);
  font-weight: 300;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.22);
  background:
    radial-gradient(120% 80% at 30% 20%, rgba(255,255,255,0.06) 0%, transparent 60%),
    linear-gradient(135deg, #0a0d18 0%, #1a1020 60%, #060207 100%);
  user-select: none;
}
.ks-cl-art-veil {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgba(2, 4, 8, 0.95) 100%);
  opacity: 0.85;
  transition: opacity 320ms ease;
  pointer-events: none;
}
.ks-cl-art-skel {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(45deg, transparent 0 16px, rgba(255,255,255,0.02) 16px 17px),
    radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.025), transparent 70%);
  display: block;
  overflow: hidden;
}
.ks-cl-art-skel.is-pending {
  background-image:
    repeating-linear-gradient(45deg, transparent 0 16px, rgba(125,211,252,0.06) 16px 17px),
    radial-gradient(ellipse at 50% 50%, rgba(125,211,252,0.08), transparent 70%);
}
.ks-cl-art-skel.is-error {
  background-image:
    repeating-linear-gradient(45deg, transparent 0 16px, rgba(251,113,133,0.05) 16px 17px),
    radial-gradient(ellipse at 50% 50%, rgba(251,113,133,0.08), transparent 70%);
}
.ks-cl-art-strip {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent, rgba(255,255,255,0.06), transparent);
  animation: ks-cl-strip 2.4s ease-in-out infinite;
}
@keyframes ks-cl-strip {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

/* 玻璃高光（hover 时一道斜光扫过） */
.ks-cl-glint {
  position: absolute; inset: 0;
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(255, 255, 255, 0.05) 48%,
    rgba(255, 255, 255, 0.18) 50%,
    rgba(255, 255, 255, 0.05) 52%,
    transparent 70%
  );
  transform: translateX(-100%);
  transition: transform 720ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease;
  pointer-events: none;
  opacity: 0;
  z-index: 5;
}
.ks-cl-card:hover:not(:disabled) .ks-cl-glint {
  transform: translateX(100%);
}

/* 卡片底部信息 —— 极简白色文字 */
.ks-cl-meta {
  position: relative;
  z-index: 3;
  padding: 22px 26px 24px;
  display: flex; flex-direction: column;
  gap: 8px;
  background:
    linear-gradient(180deg, transparent, rgba(2, 4, 8, 0.85)),
    rgba(8, 10, 16, 0.5);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.ks-cl-num {
  font-size: 9.5px;
  letter-spacing: 0.42em;
  color: rgba(255, 255, 255, 0.55);
}
.ks-cl-label {
  font-family: var(--ks-font-cn);
  font-size: 22px;
  font-weight: 400;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.96);
  letter-spacing: 0.04em;
}
.ks-cl-target {
  font-size: 9.5px;
  letter-spacing: 0.22em;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
}
`
injectStyleOnce('choice-layer', clCss)
