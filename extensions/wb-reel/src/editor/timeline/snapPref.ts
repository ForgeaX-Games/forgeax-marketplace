/**
 * 时间轴吸附开关的持久化偏好（单一布尔）。
 *
 * 设计取舍：
 *   - 不走 zustand —— 这是编辑器 UI 的一个局部偏好，没有跨组件订阅需求
 *   - 不和 settingsStore 合并 —— 那边装的是"剧本/视频生成参数"等业务配置，
 *     跟"UI 拖拽粒度"概念上不同层；混在一起会让 settings schema 无限膨胀
 *   - 独立一个 key 便于 devtool 单独清除，也便于以后扩展为
 *     { enabled, defaultGridMs } 对象结构
 *
 * 默认值：**true**（新用户拖东西有吸附，更符合"不踩坑"期望）。
 * 读取失败 / 未知值 → 回到默认 true。
 *
 * key 命名沿用 "reel-studio.*.v1" 规范，便于以后破坏性升级时做迁移或清洗。
 */

const STORAGE_KEY = 'reel-studio.timeline.snap.v1'

const DEFAULT_ENABLED = true

/** 纯函数：解析磁盘上的原始字符串 → bool。把"持久化字符串语义"与 localStorage IO 分开，方便单测。 */
export function parseSnapPref(raw: string | null): boolean {
  if (raw === null) return DEFAULT_ENABLED
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'true' || trimmed === '1') return true
  if (trimmed === 'false' || trimmed === '0') return false
  return DEFAULT_ENABLED
}

/** 纯函数：bool → 磁盘存字符串。保持 `"true"/"false"` 可读性（便于手改 devtool）。 */
export function serializeSnapPref(enabled: boolean): string {
  return enabled ? 'true' : 'false'
}

/** 读取持久化偏好；SSR / localStorage 不可用时回落默认。 */
export function loadSnapPref(): boolean {
  if (typeof window === 'undefined') return DEFAULT_ENABLED
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return parseSnapPref(raw)
  } catch {
    return DEFAULT_ENABLED
  }
}

/** 写入偏好；失败（quota / 隐身模式）时静默，不影响 UI。 */
export function saveSnapPref(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeSnapPref(enabled))
  } catch {
    // 隐身 / 存储已满 —— 本轮会话仍按内存值工作，不致命
  }
}

export const SNAP_PREF_STORAGE_KEY = STORAGE_KEY
export const SNAP_PREF_DEFAULT = DEFAULT_ENABLED
