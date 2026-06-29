import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportScenarioPackage, defaultPkgFilename } from '../exportScenarioPackage'
import { useMediaStore } from '../../../media/mediaStore'
import { useAssetStore } from '../../../media/assetStore'
import type { Scenario } from '../../types'

/**
 * 端到端 export 集成测试。
 *
 * 覆盖场景：
 *   1) data URL + mediaId + 外链 + 本地 /__reel__/assets 四种 ref 形态混用
 *   2) 同一张图被 3 个字段引用 → 包里只存 1 份（hash 去重）
 *   3) 外链 CORS 失败 → 保留原 URL、进 externalRefs、不中断导出
 *   4) fetch 失败的非外链（mediaId 没命中）→ 记录到 warnings，不改写
 *   5) manifest.stats 的计数（totalCells/packedBlobs/externalKept/failedCells）正确
 *   6) 产出 zip 可被 parseZip 解析出 manifest.json / scenario.json / assets/*
 */

function readU32(buf: Uint8Array, off: number): number {
  return (
    buf[off]! |
    (buf[off + 1]! << 8) |
    (buf[off + 2]! << 16) |
    (buf[off + 3]! << 24)
  ) >>> 0
}
function readU16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8)
}

/** 参考 zipStore.test.ts 里的 parseZip —— 只为本测拷一份，减少耦合 */
function parseZip(bytes: Uint8Array): Map<string, Uint8Array> {
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('no EOCD')
  const totalRecords = readU16(bytes, eocdOffset + 10)
  const cdOffset = readU32(bytes, eocdOffset + 16)
  const out = new Map<string, Uint8Array>()
  let p = cdOffset
  for (let i = 0; i < totalRecords; i++) {
    const compressedSize = readU32(bytes, p + 20)
    const nameLen = readU16(bytes, p + 28)
    const extraLen = readU16(bytes, p + 30)
    const commentLen = readU16(bytes, p + 32)
    const localOffset = readU32(bytes, p + 42)
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen))
    const lhNameLen = readU16(bytes, localOffset + 26)
    const lhExtraLen = readU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
    out.set(name, bytes.slice(dataStart, dataStart + compressedSize))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/**
 * 把 ExportResult.blob 抽成 Map<path,bytes>。
 * writeZip 现在返回 Blob（避免大包时单 buffer 分配崩），测试都走这条路径。
 */
async function parseZipFromBlob(blob: Blob): Promise<Map<string, Uint8Array>> {
  return parseZip(new Uint8Array(await blob.arrayBuffer()))
}

/** 同一张 1×1 透明 PNG 的 base64 */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const MP4_SIGNATURE_MOCK = new Uint8Array([
  // 最简化的假 mp4 头，仅用于测试字节回读
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
])

function makeScenario(): Scenario {
  return {
    id: 'sc-xx',
    title: '书生误闯女儿国',
    synopsis: '一个测试剧本',
    rootSceneId: 's1',
    defaultCharMs: 40,
    schemaVersion: 3,
    scenes: {
      s1: {
        id: 's1',
        title: '开场',
        media: { kind: 'IMAGE_PROMPT', ref: PNG_1X1 },
        durationMs: 3000,
        dialogue: [],
        branches: [],
        sceneImages: [
          PNG_1X1, // 同一张
          'm-img-from-store', // mediaStore 里存了同样的 PNG → hash 应去重
          '/__reel__/assets/asset-a', // 本地资产
        ],
        sceneVideos: ['https://cors-fail.example.com/video.mp4'], // 外链抓不到
      },
    },
    characters: {
      c1: {
        id: 'c1',
        name: '书生',
        prompt: '',
        refImageId: 'm-missing-no-such-id', // mediaStore 里没有 → warnings
      },
    },
  }
}

describe('exportScenarioPackage · 端到端', () => {
  beforeEach(() => {
    // 注入 mediaStore 条目：'m-img-from-store' → 同一张 PNG_1X1
    useMediaStore.setState({
      entries: {
        'm-img-from-store': {
          id: 'm-img-from-store',
          name: 'a.png',
          mimeType: 'image/png',
          size: 68,
          url: PNG_1X1,
          createdAt: 0,
          persistState: 'saved',
        },
      },
    })
    // 让 assetStore 看上去"已 load"，但 records 空 —— 于是 mediaId 反查也没戏，
    // 对应用户侧"历史剧本的 asset 还在磁盘，mediaStore 空"以外的极端 case：
    // 资产 manifest 也拉不到。这里就是这种情况的最小复现。
    useAssetStore.setState({ records: [], loaded: true, loading: false, error: null })

    // mock fetch 针对三种目标：
    //   · /__reel__/assets/asset-a         → 返回同一张 PNG
    //   · https://cors-fail.example.com/*  → reject（模拟 CORS）
    const pngBytes = Uint8Array.from(
      atob(PNG_1X1.split(',')[1]!),
      (c) => c.charCodeAt(0),
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : (input as URL).toString()
        if (url.startsWith('/__reel__/assets/asset-a')) {
          return new Response(pngBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        }
        if (url.startsWith('/__reel__/assets/asset-b')) {
          return new Response(MP4_SIGNATURE_MOCK, {
            status: 200,
            headers: { 'content-type': 'video/mp4' },
          })
        }
        if (url.startsWith('https://cors-fail.example.com')) {
          throw new Error('CORS blocked')
        }
        throw new Error(`unmocked fetch: ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useMediaStore.setState({ entries: {} })
  })

  it('产出合法 zip，且包含 manifest.json / scenario.json', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    const files = await parseZipFromBlob(result.blob)
    expect(files.has('manifest.json')).toBe(true)
    expect(files.has('scenario.json')).toBe(true)
  })

  it('同一张图被多字段引用时只存一份（按 SHA-256 去重）', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    // 在 makeScenario / mock fetch 里，同一张 PNG_1X1 通过以下 4 条路径进入：
    //   1) scene.media.ref = PNG_1X1
    //   2) sceneImages[0]  = PNG_1X1
    //   3) sceneImages[1]  = 'm-img-from-store'（mediaStore entry.url = PNG_1X1）
    //   4) sceneImages[2]  = '/__reel__/assets/asset-a'（mock fetch 返回同一张 PNG）
    // 4 个 cell 指向同一内容哈希 → manifest 只记 1 份文件，refs 数组长度 = 4
    const png = result.manifest.files.find((f) => f.mimeType === 'image/png')!
    expect(png).toBeDefined()
    expect(png.refs.length).toBe(4)
  })

  it('外链抓不到时进入 externalRefs，scenario 里保留原 URL（不改写）', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })

    const files = await parseZipFromBlob(result.blob)
    const scenarioJson = JSON.parse(
      new TextDecoder().decode(files.get('scenario.json')!),
    ) as Scenario
    // 外链不改写
    expect(scenarioJson.scenes.s1!.sceneVideos).toEqual([
      'https://cors-fail.example.com/video.mp4',
    ])
    // manifest.externalRefs 记录它
    expect(result.manifest.externalRefs).toHaveLength(1)
    expect(result.manifest.externalRefs[0]!.url).toBe(
      'https://cors-fail.example.com/video.mp4',
    )
    expect(result.manifest.externalRefs[0]!.refs).toContain(
      'scene/s1/sceneVideos/0',
    )
  })

  it('mediaStore/assetStore 都没有的 mediaId 进 missingRefs（数据已丢失）', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    expect(result.manifest.stats.missingCells).toBeGreaterThanOrEqual(1)
    expect(result.manifest.stats.failedCells).toBe(0)
    // warnings 用"素材已丢失"文案、manifest.missingRefs 有对应 label
    expect(
      result.warnings.some(
        (w) => w.includes('素材已丢失') && w.includes('character/c1/refImage'),
      ),
    ).toBe(true)
    expect(result.manifest.missingRefs.length).toBeGreaterThanOrEqual(1)
    const mr = result.manifest.missingRefs.find(
      (r) => r.ref === 'm-missing-no-such-id',
    )
    expect(mr).toBeDefined()
    expect(mr!.refs).toContain('character/c1/refImage')
    expect(mr!.reason).toMatch(/mediaStore nor assetStore/)
  })

  it('scenario.json 里的 ref 已替换为 pkg:<hash>（对成功抓到的字段）', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    const files = await parseZipFromBlob(result.blob)
    const scenarioJson = JSON.parse(
      new TextDecoder().decode(files.get('scenario.json')!),
    ) as Scenario
    expect(scenarioJson.scenes.s1!.media.ref).toMatch(/^pkg:[0-9a-f]{16}$/)
    expect(scenarioJson.scenes.s1!.sceneImages![0]!).toMatch(/^pkg:[0-9a-f]{16}$/)
    expect(scenarioJson.scenes.s1!.sceneImages![2]!).toMatch(/^pkg:[0-9a-f]{16}$/)
  })

  it('manifest.files[*].path 实际存在于 zip，且字节数与 manifest.bytes 一致', async () => {
    const sc = makeScenario()
    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    const files = await parseZipFromBlob(result.blob)
    for (const f of result.manifest.files) {
      const body = files.get(f.path)
      expect(body).toBeDefined()
      expect(body!.length).toBe(f.bytes)
    }
  })

  it('进度回调按 collect → resolve* → pack → done 顺序触发', async () => {
    const sc = makeScenario()
    const phases: string[] = []
    await exportScenarioPackage(sc, {
      now: 1700000000000,
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase)
      },
    })
    expect(phases[0]).toBe('collect')
    expect(phases).toContain('resolve')
    expect(phases).toContain('pack')
    expect(phases[phases.length - 1]).toBe('done')
  })

  it('mediaStore 空但 assetStore 有 meta.mediaId 资产时，兜底反查成功（历史剧本导出场景）', async () => {
    // 复现你的真实故障：从「历史 ▾」里对一个非活跃剧本点 📦，
    // mediaStore 没 hydrate 过这个剧本 → 每个 mediaId 都走 asset 兜底。
    const pngBytes = Uint8Array.from(
      atob(PNG_1X1.split(',')[1]!),
      (c) => c.charCodeAt(0),
    )
    // 清空 mediaStore —— 模拟"不是活跃剧本"
    useMediaStore.setState({ entries: {} })
    useAssetStore.setState({
      loaded: true,
      loading: false,
      error: null,
      records: [
        {
          id: 'asset-histo-1',
          kind: 'image',
          filename: 'histo.png',
          mimeType: 'image/png',
          bytes: pngBytes.length,
          createdAt: 100,
          meta: {
            mediaId: 'm-histo',
            scenarioId: 'sc-histo',
            promptKind: 'scene',
          },
        },
      ],
    })

    // 重设 fetch mock：这次只给 /__reel__/assets/asset-histo-1 一条通路
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : (input as URL).toString()
        if (url.includes('asset-histo-1')) {
          return new Response(pngBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        }
        throw new Error(`unmocked fetch: ${url}`)
      }),
    )

    const sc: Scenario = {
      id: 'sc-histo',
      title: '历史剧本',
      rootSceneId: 's1',
      defaultCharMs: 40,
      schemaVersion: 3,
      scenes: {
        s1: {
          id: 's1',
          title: '开场',
          media: { kind: 'IMAGE_PROMPT', ref: 'm-histo' },
          durationMs: 3000,
          dialogue: [],
          branches: [],
        },
      },
    }

    const result = await exportScenarioPackage(sc, { now: 1700000000000 })
    expect(result.manifest.stats.failedCells).toBe(0)
    expect(result.manifest.stats.packedBlobs).toBe(1)
    expect(result.manifest.files[0]!.refs).toContain('scene/s1/media')
  })

  it('Web Crypto 不可用时（非 Secure Context），回退 FNV-1a 仍然成功打包', async () => {
    // 复现 http://...:15175 非 Secure Context 的报错：
    //   TypeError: Cannot read properties of undefined (reading 'digest')
    // 产线故障现场就是这种 —— 把 subtle 临时移掉，确保 fallback 也能过。
    const originalCrypto = globalThis.crypto
    const patchedCrypto = Object.create(null, {
      getRandomValues: {
        value: (originalCrypto as Crypto).getRandomValues?.bind(originalCrypto),
        enumerable: true,
      },
      // 故意省略 subtle —— 与非 Secure Context 行为一致
    })
    Object.defineProperty(globalThis, 'crypto', {
      value: patchedCrypto,
      configurable: true,
    })

    try {
      const sc = makeScenario()
      const result = await exportScenarioPackage(sc, { now: 1700000000000 })
      // 至少一份 blob 打进了包（PNG）—— 就证明 fallback 哈希链路通畅
      expect(result.manifest.stats.packedBlobs).toBeGreaterThanOrEqual(1)
      const png = result.manifest.files.find((f) => f.mimeType === 'image/png')!
      expect(png).toBeDefined()
      // 16 字符小写 hex，与 SHA-256 前缀产物格式一致
      expect(png.ref).toMatch(/^pkg:[0-9a-f]{16}$/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      })
    }
  })
})

describe('exportScenarioPackage · playback 模式（所见即所得）', () => {
  beforeEach(() => {
    useMediaStore.setState({
      entries: {
        'm-main-video': {
          id: 'm-main-video',
          name: 'main.png',
          mimeType: 'image/png',
          size: 68,
          url: PNG_1X1,
          createdAt: 0,
          persistState: 'saved',
        },
        'm-bgm': {
          id: 'm-bgm',
          name: 'bgm.png',
          mimeType: 'image/png',
          size: 68,
          url: PNG_1X1,
          createdAt: 0,
          persistState: 'saved',
        },
        'm-character-ref': {
          id: 'm-character-ref',
          name: 'char.png',
          mimeType: 'image/png',
          size: 68,
          url: PNG_1X1,
          createdAt: 0,
          persistState: 'saved',
        },
        'm-shot-key': {
          id: 'm-shot-key',
          name: 'shot.png',
          mimeType: 'image/png',
          size: 68,
          url: PNG_1X1,
          createdAt: 0,
          persistState: 'saved',
        },
      },
    })
    useAssetStore.setState({ records: [], loaded: true, loading: false, error: null })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unexpected fetch in playback test')
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useMediaStore.setState({ entries: {} })
  })

  function makePlaybackScenario(): Scenario {
    return {
      id: 'sc-pb',
      title: 'playback test',
      rootSceneId: 's1',
      defaultCharMs: 40,
      schemaVersion: 3,
      scenes: {
        s1: {
          id: 's1',
          title: '可达',
          media: { kind: 'VIDEO', ref: 'm-main-video' },
          durationMs: 3000,
          dialogue: [],
          branches: [],
          shots: [
            {
              id: 'sh1',
              order: 0,
              framing: 'medium',
              prompt: '',
              keyframeMediaRef: 'm-shot-key',
            },
          ],
          sceneImages: ['m-shot-key'],
          sceneVideos: ['m-shot-key'],
          audio: [
            {
              id: 'a1',
              role: 'bgm',
              ref: 'm-bgm',
              startMs: 0,
              durationMs: 3000,
            },
          ],
        },
        orphan: {
          id: 'orphan',
          title: '孤岛',
          media: { kind: 'IMAGE_PROMPT', ref: 'm-character-ref' },
          durationMs: 500,
          dialogue: [],
          branches: [],
        },
      },
      characters: {
        c1: {
          id: 'c1',
          name: '角色',
          prompt: '',
          refImageId: 'm-character-ref',
        },
      },
    }
  }

  it('mode=playback：只扫 scene.media + audio；角色/分镜/孤岛不进扫描', async () => {
    const sc = makePlaybackScenario()
    const result = await exportScenarioPackage(sc, {
      mode: 'playback',
      now: 1700000000000,
    })
    expect(result.manifest.mode).toBe('playback')
    // s1.media + s1.audio[0].ref → 两个 cell 都指 PNG_1X1 → 去重后只有 1 份 blob
    expect(result.manifest.stats.packedBlobs).toBe(1)
    expect(result.manifest.stats.totalCells).toBe(2)
    expect(result.manifest.includedScenes).toEqual(['s1'])
    expect(result.manifest.droppedScenes).toEqual(['orphan'])
    const files = await parseZipFromBlob(result.blob)
    const scenarioJson = JSON.parse(
      new TextDecoder().decode(files.get('scenario.json')!),
    ) as Scenario
    expect(Object.keys(scenarioJson.scenes)).toEqual(['s1'])
    expect(scenarioJson.scenes.s1!.shots).toBeUndefined()
    expect(scenarioJson.scenes.s1!.sceneImages).toBeUndefined()
    expect(scenarioJson.scenes.s1!.sceneVideos).toBeUndefined()
    expect(scenarioJson.characters).toBeUndefined()
    expect(scenarioJson.scenes.s1!.audio?.[0]?.ref).toMatch(/^pkg:[0-9a-f]{16}$/)
    expect(scenarioJson.scenes.s1!.media.ref).toMatch(/^pkg:[0-9a-f]{16}$/)
  })

  it('includeSubtitles=false 时 scenario.json 里 dialogue[] 被清空', async () => {
    const sc = makePlaybackScenario()
    sc.scenes.s1!.dialogue = [
      { id: 'd1', role: 'narration', text: 'hi', startMs: 0 },
    ]
    const result = await exportScenarioPackage(sc, {
      mode: 'playback',
      includeSubtitles: false,
      now: 1700000000000,
    })
    const files = await parseZipFromBlob(result.blob)
    const scenarioJson = JSON.parse(
      new TextDecoder().decode(files.get('scenario.json')!),
    ) as Scenario
    expect(scenarioJson.scenes.s1!.dialogue).toEqual([])
  })

  it('mode=full（默认）行为不变：角色 refImageId、分镜、sceneImages 都参与扫描', async () => {
    const sc = makePlaybackScenario()
    const result = await exportScenarioPackage(sc, {
      now: 1700000000000,
    })
    // full 下 totalCells 显著大于 playback 的 2
    expect(result.manifest.stats.totalCells).toBeGreaterThan(2)
    expect(result.manifest.includedScenes).toBeUndefined()
  })
})

describe('defaultPkgFilename', () => {
  it('含中文标题 + 时间戳，非法字符被替换为下划线', () => {
    const name = defaultPkgFilename('书生/误闯*女儿国', 1700000000000)
    expect(name).toMatch(/^书生_误闯_女儿国-\d{4}-\d{2}-\d{2}-\d{4}\.reelpkg$/)
  })
  it('空标题回退到 scenario', () => {
    const name = defaultPkgFilename('', 1700000000000)
    expect(name.startsWith('scenario-')).toBe(true)
  })
})
