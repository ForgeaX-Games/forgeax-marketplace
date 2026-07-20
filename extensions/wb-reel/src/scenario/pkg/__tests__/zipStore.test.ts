import { describe, expect, it } from 'vitest'
import { writeZip } from '../zipStore'

/**
 * 最小 ZIP 写入器测试。
 *
 * 我们不引入 jszip / fflate 做交叉验证（会给项目加依赖）；改用两种稳健断言：
 *   1) 字节级 —— 签名、EOCD 字段、local header 数量
 *   2) 解析级 —— 自己走一遍 Central Directory，从中拿到每条 entry 的 name/size/offset
 *      回头读 local header 的 filename 和 data 核对
 *
 * 覆盖的边界：
 *   · 空 zip（entries=[]）→ 只有 EOCD
 *   · 单文件 ASCII 名
 *   · UTF-8 中文文件名（bit 11 flag）
 *   · 二进制 bytes（含 0x00 / 非 ASCII）
 *   · 多 entry 时 local header offset 单调递增
 */

function readU16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8)
}
function readU32(buf: Uint8Array, off: number): number {
  return (
    buf[off]! |
    (buf[off + 1]! << 8) |
    (buf[off + 2]! << 16) |
    (buf[off + 3]! << 24)
  ) >>> 0
}

interface ParsedZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  /** 从 local header 里直接读出来的 file data（store 模式下 = 原始字节） */
  body: Uint8Array
}

/**
 * 手写一个最小 ZIP 读取器（只解析 store 模式 + EOCD + Central Directory）。
 * 目的是让本文件的断言完全自洽，不依赖第三方 ZIP 库。
 */
function parseZip(bytes: Uint8Array): {
  entries: ParsedZipEntry[]
  eocdOffset: number
} {
  // 从末尾倒着找 EOCD 签名 0x06054b50
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found')

  const totalRecords = readU16(bytes, eocdOffset + 10)
  const cdSize = readU32(bytes, eocdOffset + 12)
  const cdOffset = readU32(bytes, eocdOffset + 16)

  const entries: ParsedZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < totalRecords; i++) {
    if (readU32(bytes, p) !== 0x02014b50) throw new Error('bad central signature')
    const compressedSize = readU32(bytes, p + 20)
    const uncompressedSize = readU32(bytes, p + 24)
    const nameLen = readU16(bytes, p + 28)
    const extraLen = readU16(bytes, p + 30)
    const commentLen = readU16(bytes, p + 32)
    const localOffset = readU32(bytes, p + 42)
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen)
    const name = new TextDecoder('utf-8').decode(nameBytes)

    // 跳到 local header 读 body —— store 模式 body 在 local header 之后
    if (readU32(bytes, localOffset) !== 0x04034b50) {
      throw new Error('bad local signature')
    }
    const lhNameLen = readU16(bytes, localOffset + 26)
    const lhExtraLen = readU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
    const body = bytes.slice(dataStart, dataStart + compressedSize)

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      localOffset,
      body,
    })

    p += 46 + nameLen + extraLen + commentLen
  }

  // 自洽：central dir size 字段应该和我们走到的位置吻合
  expect(p - cdOffset).toBe(cdSize)

  return { entries, eocdOffset }
}

/**
 * 测试小工具：writeZip 现在返回 Blob（避免大包时 Uint8Array 单 buffer 分配崩溃），
 * 所有断言走 Uint8Array 视角，所以这里同步把 Blob 抽成字节再交给后续 parseZip。
 */
async function asBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('writeZip · 最小 ZIP 写入器', () => {
  it('空 entries → 只有 EOCD（22 字节）', async () => {
    const z = await asBytes(writeZip([]))
    expect(z.length).toBe(22)
    expect(readU32(z, 0)).toBe(0x06054b50)
  })

  it('单文件 ASCII：name / body 回读一致', async () => {
    const body = new TextEncoder().encode('hello, 世界\n')
    const z = await asBytes(writeZip([{ path: 'readme.txt', data: body }]))
    const { entries } = parseZip(z)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('readme.txt')
    expect(Array.from(entries[0]!.body)).toEqual(Array.from(body))
  })

  it('UTF-8 中文文件名 + 非 ASCII 内容', async () => {
    const body = new TextEncoder().encode('场景 1 的关键帧')
    const z = await asBytes(
      writeZip([{ path: 'assets/书生误闯女儿国/001.txt', data: body }]),
    )
    const { entries } = parseZip(z)
    expect(entries[0]!.name).toBe('assets/书生误闯女儿国/001.txt')
    expect(new TextDecoder().decode(entries[0]!.body)).toBe('场景 1 的关键帧')
  })

  it('二进制字节：含 0x00 / 0xFF 的 blob 原样回读', async () => {
    const body = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80])
    const z = await asBytes(writeZip([{ path: 'bin.raw', data: body }]))
    const { entries } = parseZip(z)
    expect(Array.from(entries[0]!.body)).toEqual([0x00, 0x01, 0xff, 0x7f, 0x80])
  })

  it('多 entry：local offset 单调递增；name/body 一一对应', async () => {
    const entries = [
      { path: 'a.txt', data: new Uint8Array([1, 2, 3]) },
      { path: 'b.txt', data: new Uint8Array([4, 5, 6, 7]) },
      { path: 'sub/c.txt', data: new Uint8Array([8]) },
    ]
    const z = await asBytes(writeZip(entries))
    const parsed = parseZip(z)
    expect(parsed.entries.map((e) => e.name)).toEqual([
      'a.txt',
      'b.txt',
      'sub/c.txt',
    ])
    for (let i = 1; i < parsed.entries.length; i++) {
      expect(parsed.entries[i]!.localOffset).toBeGreaterThan(
        parsed.entries[i - 1]!.localOffset,
      )
    }
    expect(Array.from(parsed.entries[2]!.body)).toEqual([8])
  })

  it('固定 mtime → 每次写盘字节级一致（便于分发和校验）', async () => {
    const body = new TextEncoder().encode('same')
    const a = await asBytes(
      writeZip([{ path: 'x.txt', data: body, mtime: 1700000000000 }]),
    )
    const b = await asBytes(
      writeZip([{ path: 'x.txt', data: body, mtime: 1700000000000 }]),
    )
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('Blob 类型为 application/zip', async () => {
    const z = writeZip([])
    expect(z.type).toBe('application/zip')
  })
})
