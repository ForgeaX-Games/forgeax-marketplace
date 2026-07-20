/**
 * 视频元数据 probe —— 给一个 URL（blob: / /__reel__/assets/...），返回 ms 时长。
 *
 * TimelineDock 列表里的 <video preload="metadata"> 在首次渲染时**不一定**及时
 * 完成 loadedmetadata（尤其是大量视频同时渲染 + 页面还没滚到 item 在视区时），
 * 拖起瞬间闭包读到的 duration 可能是 0。为了稳妥，drop 一刻再异步 probe 一次。
 *
 * 实现：创建一个离屏 HTMLVideoElement，加载 URL，loadedmetadata 后取 duration，
 *   2 秒超时保底（避免坏链接永远吊住）。
 *
 * 为什么单独放一个文件：
 *   - 让 Timeline.tsx 的 onTrackDrop 只调一个纯 helper，测试只 mock 这个函数即可
 *   - 本函数依赖 DOM，所以单独放、单独 skip 于 node 环境（happy-dom 下 video.duration 为 NaN，跑不起来）
 */

const PROBE_TIMEOUT_MS = 2000

export async function probeVideoDurationMs(url: string): Promise<number> {
  if (!url) return 0
  if (typeof document === 'undefined') return 0

  return new Promise<number>((resolve) => {
    const v = document.createElement('video')
    let done = false
    function finish(ms: number): void {
      if (done) return
      done = true
      v.removeAttribute('src')
      try {
        v.load()
      } catch {
        /* best-effort cleanup */
      }
      resolve(ms)
    }
    const timer = setTimeout(() => finish(0), PROBE_TIMEOUT_MS)
    v.preload = 'metadata'
    v.muted = true
    v.addEventListener('loadedmetadata', () => {
      clearTimeout(timer)
      const dur = v.duration
      if (Number.isFinite(dur) && dur > 0) {
        finish(Math.round(dur * 1000))
      } else {
        finish(0)
      }
    })
    v.addEventListener('error', () => {
      clearTimeout(timer)
      finish(0)
    })
    v.src = url
  })
}
