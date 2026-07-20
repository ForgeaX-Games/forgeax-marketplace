// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationQueue } from '../generationQueueStore'
import { useSettingsStore } from '../../scenario/settingsStore'

interface Deferred {
  promise: Promise<string>
  resolve: (v: string) => void
  reject: (e: unknown) => void
}
function defer(): Deferred {
  let resolve!: (v: string) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function runningCount(): number {
  return Object.values(useGenerationQueue.getState().jobs).filter(
    (j) => j.status === 'running',
  ).length
}

describe('generationQueueStore', () => {
  beforeEach(() => {
    // 清空队列 & 复位并发
    useGenerationQueue.setState({ jobs: {}, order: [], paused: false })
    useSettingsStore.getState().setGenConcurrency({ image: 2, video: 2, audio: 2 })
  })

  it('遵守分池并发上限（image=2 时最多 2 个同时 running）', async () => {
    const defs = [defer(), defer(), defer(), defer()]
    useGenerationQueue.getState().enqueueMany(
      defs.map((d, i) => ({
        kind: 'image' as const,
        label: `img-${i}`,
        run: () => d.promise,
      })),
    )
    await flush()
    expect(runningCount()).toBe(2)

    // 完成一个 → 下一个补位
    defs[0]!.resolve('m0')
    await flush()
    expect(runningCount()).toBe(2)

    defs[1]!.resolve('m1')
    defs[2]!.resolve('m2')
    defs[3]!.resolve('m3')
    await flush()
    const done = Object.values(useGenerationQueue.getState().jobs).filter(
      (j) => j.status === 'done',
    )
    expect(done).toHaveLength(4)
  })

  it('不同池不互相占用名额（image 满载不挡 video）', async () => {
    const img = [defer(), defer(), defer()]
    const vid = [defer()]
    const q = useGenerationQueue.getState()
    q.enqueueMany(img.map((d, i) => ({ kind: 'image' as const, label: `i${i}`, run: () => d.promise })))
    q.enqueueMany(vid.map((d, i) => ({ kind: 'video' as const, label: `v${i}`, run: () => d.promise })))
    await flush()
    // image 2 running（第三个排队）+ video 1 running
    expect(runningCount()).toBe(3)
  })

  it('成功后回调 onDone 带 mediaId', async () => {
    const d = defer()
    let got: string | undefined = 'unset'
    useGenerationQueue.getState().enqueue({
      kind: 'audio',
      label: 'a',
      run: () => d.promise,
      onDone: (id) => {
        got = id
      },
    })
    await flush()
    d.resolve('media-xyz')
    await flush()
    expect(got).toBe('media-xyz')
  })

  it('暂停后不再启动新 job；继续后恢复', async () => {
    const defs = [defer(), defer(), defer()]
    const q = useGenerationQueue.getState()
    q.pause()
    q.enqueueMany(defs.map((d, i) => ({ kind: 'image' as const, label: `i${i}`, run: () => d.promise })))
    await flush()
    expect(runningCount()).toBe(0)
    useGenerationQueue.getState().resume()
    await flush()
    expect(runningCount()).toBe(2)
  })

  it('取消排队中的 job 直接出队；失败/取消可重试', async () => {
    const d = defer()
    const id = useGenerationQueue.getState().enqueue({
      kind: 'video',
      label: 'v',
      run: () => d.promise,
    })
    await flush()
    expect(useGenerationQueue.getState().jobs[id]?.status).toBe('running')
    // 取消 running → cancelled，结果丢弃
    useGenerationQueue.getState().cancel(id)
    d.resolve('late')
    await flush()
    expect(useGenerationQueue.getState().jobs[id]?.status).toBe('cancelled')
    // 重试 → 脱离 cancelled，重新进入调度
    useGenerationQueue.getState().retry(id)
    await flush()
    expect(['queued', 'running', 'done']).toContain(useGenerationQueue.getState().jobs[id]?.status)
  })
})
