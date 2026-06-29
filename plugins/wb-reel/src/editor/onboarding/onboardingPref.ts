/**
 * onboardingPref —— 新手引导偏好的 localStorage 持久化（仿 snapPref / trackVisibility 范式）。
 *
 * 只存一件事：用户是否已看过（或主动跳过）时间轴交互式引导。看过即不再自动弹，
 * 但「?」帮助按钮随时可手动重开。
 */

const TOUR_SEEN_KEY = 'reel-studio.onboarding.timeline.v1'

export function loadTourSeen(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveTourSeen(seen: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (seen) localStorage.setItem(TOUR_SEEN_KEY, '1')
    else localStorage.removeItem(TOUR_SEEN_KEY)
  } catch {
    /* 配额满等忽略 */
  }
}
