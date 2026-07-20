import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetScenarioDiskForTest,
  loadDbFromDisk,
  probeDiskAvailable,
  saveDbToDisk,
} from '../scenarioDiskStore'
import type { PersistedDb } from '../scenarioPersist'

/**
 * 磁盘镜像层的"契约"测试。
 *
 * 重点：绝不抛；失败一律静默降级（探测返回 false / load 返回 null /
 * save 返回 false），让上层 boot 能走 localStorage 兜底路径。
 */

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const sampleDb: PersistedDb = {
  version: 1,
  activeId: 'scn-1',
  items: [
    {
      id: 'scn-1',
      title: 'test',
      createdAt: 1,
      updatedAt: 2,
      scenario: {} as never,
    },
  ],
}

describe('scenarioDiskStore', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    __resetScenarioDiskForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetScenarioDiskForTest()
  })

  describe('probeDiskAvailable', () => {
    it('插件 200 且 body 含 db → 可用', async () => {
      fetchMock.mockResolvedValueOnce(jsonRes({ db: sampleDb }))
      expect(await probeDiskAvailable()).toBe(true)
    })

    it('插件 404 → 不可用', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
      expect(await probeDiskAvailable()).toBe(false)
    })

    it('网络报错 → 不可用（绝不抛）', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom'))
      expect(await probeDiskAvailable()).toBe(false)
    })

    it('body 缺 db 字段 → 视为不可用', async () => {
      fetchMock.mockResolvedValueOnce(jsonRes({}))
      expect(await probeDiskAvailable()).toBe(false)
    })

    it('结果缓存 —— 第二次调用不再发请求', async () => {
      fetchMock.mockResolvedValueOnce(jsonRes({ db: sampleDb }))
      await probeDiskAvailable()
      await probeDiskAvailable()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('loadDbFromDisk', () => {
    it('正常返回 db', async () => {
      fetchMock.mockResolvedValueOnce(jsonRes({ db: sampleDb }))
      const db = await loadDbFromDisk()
      expect(db).toEqual(sampleDb)
    })

    it('非 2xx → null', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
      expect(await loadDbFromDisk()).toBeNull()
    })

    it('网络错误 → null（不抛）', async () => {
      fetchMock.mockRejectedValueOnce(new Error('net'))
      expect(await loadDbFromDisk()).toBeNull()
    })

    it('body 缺 db → null', async () => {
      fetchMock.mockResolvedValueOnce(jsonRes({ other: 1 }))
      expect(await loadDbFromDisk()).toBeNull()
    })
  })

  describe('saveDbToDisk', () => {
    it('PUT 200 → true，payload 包装为 { db }', async () => {
      fetchMock.mockImplementationOnce(
        (url: string, init: { method?: string; body?: string }) => {
          expect(url).toBe('/__reel__/scenarios')
          expect(init.method).toBe('PUT')
          const parsed = JSON.parse(init.body ?? '{}') as { db: PersistedDb }
          expect(parsed.db).toEqual(sampleDb)
          return Promise.resolve(jsonRes({ ok: true }))
        },
      )
      expect(await saveDbToDisk(sampleDb)).toBe(true)
    })

    it('413 / 其他错误 → false', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 413 }))
      expect(await saveDbToDisk(sampleDb)).toBe(false)
    })

    it('抛错 → false（上层不应被阻断）', async () => {
      fetchMock.mockRejectedValueOnce(new Error('down'))
      expect(await saveDbToDisk(sampleDb)).toBe(false)
    })
  })
})
