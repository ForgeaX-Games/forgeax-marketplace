import { describe, it, expect } from 'vitest'
import { putMedia, getAllMedia, deleteMedia, getMedia } from '../mediaIdb'

/**
 * mediaIdb —— 单测层只验证「IDB 不可用时安全降级为 no-op」这一契约。
 *
 * 为什么不测真实 IDB 读写：
 *   - happy-dom 测试环境**默认不带 IndexedDB**（只有 localStorage）
 *   - 引入 fake-indexeddb 会显著增大 CI 体积，对这个纯辅助模块不划算
 *   - 实际 IDB 行为由浏览器保证，这里只需要确保"没 IDB 也不崩"
 *
 * 如果后续要补真实 IDB 场景，可用：
 *   ```ts
 *   import 'fake-indexeddb/auto'
 *   ```
 * 并在 vitest setupFiles 里注入。
 */
describe('mediaIdb · 无 IDB 环境降级', () => {
  it('putMedia 在无 IDB 时不 throw，静默 resolve', async () => {
    await expect(
      putMedia({
        id: 'm-1',
        name: 'x.mp4',
        mimeType: 'video/mp4',
        size: 1,
        createdAt: 1,
        blob: new Blob([]),
      }),
    ).resolves.toBeUndefined()
  })

  it('getAllMedia 在无 IDB 时返回空数组（而不是 reject）', async () => {
    const list = await getAllMedia()
    expect(list).toEqual([])
  })

  it('deleteMedia 在无 IDB 时不 throw', async () => {
    await expect(deleteMedia('m-x')).resolves.toBeUndefined()
  })

  it('getMedia 在无 IDB 时返回 null（retryPersist 的兜底路径依赖这个契约）', async () => {
    await expect(getMedia('m-whatever')).resolves.toBeNull()
  })
})
