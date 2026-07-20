/**
 * 最小 ZIP store 模式打包器 —— 纯浏览器原生，无第三方依赖。
 *
 * 为什么自己写：
 *   - 项目 deps 很薄，不想为"打包一次导出"引入 fflate / jszip
 *   - 剧本包内容大多是已压缩格式（png/jpg/mp4/mp3/webm），
 *     用 deflate 也挤不出多少空间，store 反而最省 CPU / 最好调试
 *   - 30 行以内的 ZIP 写入代码足够覆盖需求（Local header + Central directory + EOCD）
 *
 * 设计边界：
 *   - 只实现 ZIP 写入（writeZip）；读取在 `zipReadStore.ts` 里另写
 *   - 只支持 store（method=0），不做 deflate
 *   - 支持 UTF-8 文件名（general purpose bit 11 = 1）
 *   - 不支持 ZIP64（单文件 < 4GB、条目总数 < 65535；对剧本包完全够用）
 *   - CRC-32 按 PKWARE 标准规格（多项式 0xEDB88320）
 *
 * 规范参考：
 *   APPNOTE.TXT 6.3.3 · Section 4.4（local file header / central dir header / EOCD）
 *   https://pkwarefiles.azureedge.net/appnote/appnote-6.3.10.TXT
 */

export interface ZipEntry {
  /** 在 zip 里的路径；必须使用 `/` 分隔（不能用 `\`） */
  path: string
  /** 文件内容 */
  data: Uint8Array
  /** 修改时间（ms）；默认 Date.now() */
  mtime?: number
}

/**
 * 计算 CRC-32（PKZIP 规格）。
 *
 * 查表法：预先把 0..255 的起始 CRC 算好，主循环只做 8bit 查表。
 * 这样一份 10MB 视频大概 30-80ms，可接受；我们不用 worker。
 */
function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      }
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}
let CRC_TABLE: Uint32Array | null = null

/** MS-DOS 时间/日期格式（2 秒精度） —— ZIP 标准里的 mtime 字段。 */
function dosTimeDate(ms: number): { time: number; date: number } {
  const d = new Date(ms)
  const year = Math.max(1980, d.getFullYear())
  const date =
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  return { date: date & 0xffff, time: time & 0xffff }
}

/**
 * 把若干 {path, data} 组合成一个完整 ZIP 字节流（store 模式）。
 *
 * 返回 Blob 而不是单个 Uint8Array：
 *   - 历史上这里返回 `new Uint8Array(total)`，把整个 zip 拼到一块连续 buffer。
 *     当剧本包接近 1.5–2 GiB 时（实测约 1.94 GiB），
 *     浏览器分不出这么大一块连续堆内存 → `RangeError: Array buffer
 *     allocation failed`，导出整个失败。
 *   - 改返回 Blob：Blob 内部以"段数组"形式存放；浏览器实现允许各段独立分配
 *     甚至挂在 disk-backed cache 上，不需要单块连续内存，因此 2 GiB 的
 *     剧本包能稳定打包。
 *   - 调用方拿到 Blob 即可直接 `URL.createObjectURL` / `download`，
 *     不需要再 `new Blob([uint8.buffer])` 多复制一次。
 *
 * 内存：每条 entry 的 data（Uint8Array）在上层 resolveRef 已经驻留，本函数
 *   仅追加 30+name 字节的 local header / 46+name 字节的 central header /
 *   22 字节的 EOCD —— 都是小段，靠 Blob 段数组拼接，不再申请大 buffer。
 */
export function writeZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const encodedNames = entries.map((e) => encoder.encode(e.path))

  // 先算每条 entry 的 local header + data 大小，拿到 central directory 的 offset
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  const offsets: number[] = []
  let cursor = 0

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const name = encodedNames[i]!
    const data = entry.data
    const crc = crc32(data)
    const size = data.length
    const { time, date } = dosTimeDate(entry.mtime ?? Date.now())

    const localHeader = new Uint8Array(30 + name.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true)          // version needed
    lv.setUint16(6, 0x0800, true)      // general purpose bit 11 = UTF-8
    lv.setUint16(8, 0, true)           // compression method = store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)       // compressed size = size (store)
    lv.setUint32(22, size, true)       // uncompressed size
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)          // extra field length
    localHeader.set(name, 30)

    locals.push(localHeader)
    locals.push(data)
    offsets.push(cursor)
    cursor += localHeader.length + data.length

    const centralHeader = new Uint8Array(46 + name.length)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true)  // central directory signature
    cv.setUint16(4, 20, true)          // version made by
    cv.setUint16(6, 20, true)          // version needed
    cv.setUint16(8, 0x0800, true)      // general purpose bit 11 = UTF-8
    cv.setUint16(10, 0, true)          // compression method = store
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true)          // extra field length
    cv.setUint16(32, 0, true)          // comment length
    cv.setUint16(34, 0, true)          // disk number
    cv.setUint16(36, 0, true)          // internal file attrs
    cv.setUint32(38, 0, true)          // external file attrs
    cv.setUint32(42, offsets[i]!, true) // local header offset
    centralHeader.set(name, 46)
    centrals.push(centralHeader)
  }

  const centralStart = cursor
  const centralBytes = centrals.reduce((sum, c) => sum + c.length, 0)
  const eocdSize = 22

  // EOCD 单独成段（22 字节，无所谓分配）
  const eocd = new Uint8Array(eocdSize)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)            // EOCD signature
  ev.setUint16(4, 0, true)                     // disk number
  ev.setUint16(6, 0, true)                     // central dir start disk
  ev.setUint16(8, entries.length, true)        // records on this disk
  ev.setUint16(10, entries.length, true)       // total records
  ev.setUint32(12, centralBytes, true)         // central dir size
  ev.setUint32(16, centralStart, true)         // central dir offset
  ev.setUint16(20, 0, true)                    // comment length

  // Blob 段数组：先 locals（local header + entry data 交替），再 centrals，最后 EOCD
  // 浏览器内部不必把它们拷成单块连续内存，因此 2 GiB 包不会再撞 ArrayBuffer 上限。
  // 类型转换：BlobPart 期望 BufferSource，但当下 lib.dom.d.ts 对 Uint8Array<ArrayBufferLike>
  // 的窄化与 BufferSource 不完全兼容，运行时是合法的，编译时手动收口。
  const parts: BlobPart[] = [...locals, ...centrals, eocd] as unknown as BlobPart[]
  return new Blob(parts, { type: 'application/zip' })
}
