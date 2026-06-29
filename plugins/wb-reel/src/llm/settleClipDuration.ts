/**
 * settleClipDuration —— 单段时长结算（P3-B，纯函数）
 *
 * 背景：P2 之后视频提示词**不含绝对秒数**（一律「镜头N」），秒数完全交给发送层。
 * 本模块就是那个「发送层」的时长结算器：把「这一镜需要多久」翻译成
 * 「模型一次能生的整数秒」，超长则切成多段（每段都已结算到合法区间）。
 *
 * 设计约束（与 plan §0.2 / P3-B 对齐）：
 *   - **宁多勿少**：ceil 到整数秒，不四舍五入抹掉动作尾巴。
 *   - **夹到合法区间** [floor, max]：floor 取模型官方区间下限，max 取单段稳定上限。
 *   - **末段不留 <floor 的尾巴**：极短尾段并入前一段，避免「1s 废段」。
 *
 * 纯函数、无副作用、不 import provider / React，可单测。
 */
import type { ModelCapability } from './modelCapabilities'

/**
 * 单段时长下限：优先用官方时长区间下限，回退 minUsefulClipSec，再回退 4s。
 */
export function clipFloorSec(cap: ModelCapability): number {
  return cap.durationRangeSec?.[0] ?? cap.minUsefulClipSec ?? 4
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * 单段时长结算：ceil 到整数秒、夹到 [floor, max]，min 不低于 floor。**宁多勿少**。
 *
 * 非法输入（NaN / ≤0）回退到 floor（保证至少出一个有意义的最短段）。
 *
 * 例（seedance-2-0，[4,15]）：
 *   - 3.2 → 4（向上 + min floor）
 *   - 5   → 5
 *   - 15.9 → 15（夹上限）
 */
export function settleClipDurationSec(neededSec: number, cap: ModelCapability): number {
  const floor = clipFloorSec(cap)
  const max = cap.maxSingleClipSec
  if (!Number.isFinite(neededSec) || neededSec <= 0) return floor
  return clamp(Math.ceil(neededSec), floor, max)
}

/**
 * 整镜（可能超 max）→ 分段秒数数组，每段已结算到 [floor, max] 整数秒。
 *
 * 策略：
 *   - 非法输入 → []
 *   - 单段可容（round(needed) ≤ max）→ [settleClipDurationSec(needed)]（含 floor 兜底）
 *   - 超长 → 最少段数 count = ceil(t/max)，均匀分配（前 remainder 段各 +1），
 *     再把任何 <floor 的末段并入前段，最后逐段夹回 max。
 *
 * 例（seedance-2-0，max=15 / floor=4）：
 *   - 30 → [15,15]；22 → [11,11]；6 → [6]；2 → [4]（floor 兜底）
 */
export function planClipSegments(neededSec: number, cap: ModelCapability): number[] {
  if (!Number.isFinite(neededSec) || neededSec <= 0) return []
  const floor = clipFloorSec(cap)
  const max = cap.maxSingleClipSec
  const t = Math.round(neededSec)

  if (t <= max) return [settleClipDurationSec(neededSec, cap)]

  const count = Math.ceil(t / max)
  const base = Math.floor(t / count)
  const remainder = t - base * count

  const segs: number[] = []
  for (let i = 0; i < count; i++) {
    segs.push(base + (i < remainder ? 1 : 0))
  }

  // 合并任何 <floor 的末段进前一段（防 "1s 尾巴"）
  while (segs.length > 1) {
    const last = segs[segs.length - 1]!
    if (last < floor) {
      segs[segs.length - 2]! += last
      segs.pop()
    } else {
      break
    }
  }

  return segs.map((s) => Math.min(s, max))
}
